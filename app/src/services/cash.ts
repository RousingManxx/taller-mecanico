import type { CashSession, ISODate, LedgerEntry, LedgerKind } from '../domain/types'
import { audit, fail, getSettings, load, need, once, requirePositive, stamp, today, trim, tx, uid, type Ctx } from './core'

export async function currentSession(ctx: Ctx): Promise<CashSession | undefined> {
  return (await ctx.db.cashSessions.where('status').equals('abierta').first()) ?? undefined
}

type LedgerInput = Omit<LedgerEntry, 'id' | 'orgId' | 'at' | 'userId' | 'account' | 'sessionId' | 'date'> & { date?: ISODate }
/**
 * Único punto por el que se registra dinero (cobros, pagos, aportaciones…). Todo movimiento en efectivo exige una
 * sesión de caja abierta y queda ligado a ella. Debe invocarse dentro de `tx`.
 */
export async function recordLedger(ctx: Ctx, e: LedgerInput): Promise<LedgerEntry> {
  requirePositive(e.amountCents, 'El importe')
  if (!Number.isInteger(e.amountCents)) fail('El importe debe estar en centavos enteros.')
  const s = await getSettings(ctx)
  const method = s.paymentMethods.find((m) => m.id === e.methodId)
  if (!method) return fail('El método de pago no existe.')
  let sessionId: string | undefined
  if (method.account === 'caja') {
    const sess = await currentSession(ctx)
    if (!sess) return fail('Abre la caja antes de registrar movimientos en efectivo.')
    sessionId = sess.id
  }
  const entry: LedgerEntry = { ...e, id: uid(), orgId: ctx.orgId, date: e.date ?? today(ctx), at: stamp(ctx), userId: ctx.user.id, account: method.account, sessionId }
  await ctx.db.ledger.add(entry)
  return entry
}

export async function sessionExpected(ctx: Ctx, sessionId: string): Promise<number> {
  const s = await load(ctx, ctx.db.cashSessions, sessionId, 'La sesión de caja')
  const entries = (await ctx.db.ledger.where('sessionId').equals(sessionId).toArray()).filter((l) => l.account === 'caja')
  return s.openingCents + entries.reduce((a, l) => a + (l.direction === 'in' ? l.amountCents : -l.amountCents), 0)
}

export async function openSession(ctx: Ctx, openingCents: number): Promise<CashSession> {
  need(ctx, 'caja.operar')
  if (!(Number.isInteger(openingCents) && openingCents >= 0)) fail('El saldo inicial no es válido.')
  return tx(ctx, async () => {
    if (await currentSession(ctx)) fail('Ya hay una caja abierta. Ciérrala antes de abrir otra.')
    const c: CashSession = { id: uid(), orgId: ctx.orgId, status: 'abierta', openedAt: stamp(ctx), openedBy: ctx.user.id, openingCents, note: '' }
    await ctx.db.cashSessions.add(c)
    await audit(ctx, 'caja.apertura', 'caja', c.id, { after: { openingCents } })
    return c
  })
}

/** Cierre: compara el efectivo contado con el esperado y conserva la diferencia; una diferencia exige explicación. */
export async function closeSession(ctx: Ctx, countedCents: number, note: string): Promise<CashSession> {
  need(ctx, 'caja.cerrar')
  if (!(Number.isInteger(countedCents) && countedCents >= 0)) fail('El efectivo contado no es válido.')
  return tx(ctx, async () => {
    const sess = await currentSession(ctx)
    if (!sess) return fail('No hay una caja abierta.')
    const expected = await sessionExpected(ctx, sess.id)
    const diff = countedCents - expected
    if (diff !== 0 && !trim(note)) fail('Hay una diferencia de efectivo: explica el motivo para poder cerrar.')
    const closed: CashSession = { ...sess, status: 'cerrada', closedAt: stamp(ctx), closedBy: ctx.user.id, expectedCents: expected, countedCents, differenceCents: diff, note: trim(note), authorizedBy: diff !== 0 ? ctx.user.id : undefined }
    await ctx.db.cashSessions.put(closed)
    await audit(ctx, 'caja.cierre', 'caja', sess.id, { after: { expected, countedCents, diff }, reason: trim(note) || undefined })
    return closed
  })
}

export interface CashMoveInput { kind: Extract<LedgerKind, 'aportacion_dueno' | 'retiro_dueno' | 'prestamo_recibido' | 'pago_prestamo' | 'otro_ingreso' | 'otro_egreso'>; amountCents: number; methodId: string; note: string; reference?: string }
const IN_KINDS: LedgerKind[] = ['aportacion_dueno', 'prestamo_recibido', 'otro_ingreso']
/** Movimientos no operativos: aportaciones, retiros, préstamos. No son ventas ni gastos. */
export async function addCashMovement(ctx: Ctx, i: CashMoveInput, opKey?: string): Promise<LedgerEntry> {
  need(ctx, 'caja.operar')
  if (!trim(i.note)) fail('Describe el concepto del movimiento.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'caja_mov', async () => {
      const e = await recordLedger(ctx, { kind: i.kind, direction: IN_KINDS.includes(i.kind) ? 'in' : 'out', amountCents: i.amountCents, methodId: i.methodId, reference: trim(i.reference), note: trim(i.note), opKey })
      await audit(ctx, 'caja.movimiento', 'caja', e.id, { after: { kind: i.kind, amountCents: i.amountCents, methodId: i.methodId } })
      return e
    }, (id) => ctx.db.ledger.get(id) as Promise<LedgerEntry>)
    return value
  })
}

/** Transferencia entre caja (efectivo) y banco: dos movimientos enlazados que no afectan ventas ni utilidad. */
export async function transferBetweenAccounts(ctx: Ctx, from: 'caja' | 'banco', amountCents: number, note: string, opKey?: string): Promise<void> {
  need(ctx, 'caja.operar')
  await tx(ctx, async () => {
    if (opKey && (await ctx.db.ops.get(opKey))) return
    const s = await getSettings(ctx)
    const src = s.paymentMethods.find((m) => m.account === from), dst = s.paymentMethods.find((m) => m.account !== from)
    if (!src || !dst) return fail('Configura métodos de pago de caja y banco para transferir.')
    const ref = uid()
    await recordLedger(ctx, { kind: 'transferencia_salida', direction: 'out', amountCents, methodId: src.id, reference: ref, note: trim(note) || 'Transferencia' })
    await recordLedger(ctx, { kind: 'transferencia_entrada', direction: 'in', amountCents, methodId: dst.id, reference: ref, note: trim(note) || 'Transferencia' })
    if (opKey) await ctx.db.ops.put({ key: opKey, orgId: ctx.orgId, kind: 'transferencia', resultId: ref, at: stamp(ctx) })
    await audit(ctx, 'caja.transferencia', 'caja', ref, { after: { from, amountCents } })
  })
}
