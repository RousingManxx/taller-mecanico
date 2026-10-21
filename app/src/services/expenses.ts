import { addDays, addMonths, endOfMonth } from '../domain/dates'
import { expenseBalance, expensePaid, expenseTotal } from '../domain/finance'
import type { Expense, ISODate, LedgerEntry, RecurringExpense } from '../domain/types'
import { audit, fail, getSettings, load, need, once, requireNonNegative, requirePositive, requireText, stamp, today, trim, tx, uid, type Ctx } from './core'
import { recordLedger } from './cash'

export interface ExpenseInput { id?: string; concept: string; categoryId: string; date?: ISODate; amountCents: number; taxCents?: number; supplierId?: string; dueDate?: ISODate; costCenter?: string; notes?: string }
async function checkCategory(ctx: Ctx, categoryId: string) {
  const s = await getSettings(ctx)
  if (!s.expenseCategories.some((c) => c.id === categoryId)) fail('La categoría del gasto no existe.')
}
async function ledgerOfExpense(ctx: Ctx, id: string): Promise<LedgerEntry[]> { return ctx.db.ledger.where('expenseId').equals(id).toArray() }

/** `amountCents` es el costo reconocido (sin IVA acreditable); `taxCents` es el IVA, que no es costo pero sí se paga. */
export async function saveExpense(ctx: Ctx, i: ExpenseInput, payNow?: { methodId: string; reference?: string }, opKey?: string): Promise<Expense> {
  need(ctx, 'gastos.editar')
  const concept = requireText(i.concept, 'El concepto')
  requirePositive(i.amountCents, 'El importe'); requireNonNegative(i.taxCents ?? 0, 'El impuesto')
  if (!Number.isInteger(i.amountCents) || !Number.isInteger(i.taxCents ?? 0)) fail('Los importes deben estar en centavos enteros.')
  return tx(ctx, async () => {
    await checkCategory(ctx, i.categoryId)
    if (i.supplierId) await load(ctx, ctx.db.suppliers, i.supplierId, 'El proveedor')
    const { value } = await once(ctx, opKey, 'gasto', async () => {
      const at = stamp(ctx), date = i.date ?? today(ctx)
      const cur = i.id ? await load(ctx, ctx.db.expenses, i.id, 'El gasto') : null
      if (cur?.cancelled) fail('El gasto está cancelado y no se puede modificar.')
      if (i.dueDate && i.dueDate < date) fail('El vencimiento no puede ser anterior a la fecha del gasto.')
      const e: Expense = {
        id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, concept, categoryId: i.categoryId, date, amountCents: i.amountCents, taxCents: i.taxCents ?? 0,
        supplierId: i.supplierId || undefined, dueDate: i.dueDate, costCenter: trim(i.costCenter), notes: trim(i.notes), recurringId: cur?.recurringId, recurringKey: cur?.recurringKey, attachmentIds: cur?.attachmentIds ?? [],
      }
      if (cur) {
        const paid = expensePaid(cur, await ledgerOfExpense(ctx, cur.id))
        if (paid > expenseTotal(e)) fail('El nuevo importe es menor que lo ya pagado de este gasto.')
        await audit(ctx, 'gasto.modificado', 'gasto', cur.id, { before: { concept: cur.concept, amountCents: cur.amountCents, taxCents: cur.taxCents, categoryId: cur.categoryId, date: cur.date }, after: { concept, amountCents: e.amountCents, taxCents: e.taxCents, categoryId: e.categoryId, date } })
      } else await audit(ctx, 'gasto.creado', 'gasto', e.id, { after: { concept, amountCents: e.amountCents, categoryId: e.categoryId } })
      await ctx.db.expenses.put(e)
      if (payNow && !cur) await recordLedger(ctx, { kind: 'pago_gasto', direction: 'out', amountCents: expenseTotal(e), methodId: payNow.methodId, reference: trim(payNow.reference), note: concept, expenseId: e.id, supplierId: e.supplierId, date })
      return e
    }, (id) => ctx.db.expenses.get(id) as Promise<Expense>)
    return value
  })
}

export async function payExpense(ctx: Ctx, expenseId: string, amountCents: number, methodId: string, o: { reference?: string; date?: ISODate } = {}, opKey?: string): Promise<LedgerEntry> {
  need(ctx, 'gastos.editar')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'pago_gasto', async () => {
      const e = await load(ctx, ctx.db.expenses, expenseId, 'El gasto')
      if (e.cancelled) fail('El gasto está cancelado.')
      const bal = expenseBalance(e, await ledgerOfExpense(ctx, e.id))
      if (amountCents > bal) fail(`El pago supera el saldo pendiente del gasto (${(bal / 100).toFixed(2)}).`)
      const l = await recordLedger(ctx, { kind: 'pago_gasto', direction: 'out', amountCents, methodId, reference: trim(o.reference), note: e.concept, expenseId: e.id, supplierId: e.supplierId, date: o.date, opKey })
      await audit(ctx, 'gasto.pagado', 'gasto', e.id, { after: { amountCents, methodId } })
      return l
    }, (id) => ctx.db.ledger.get(id) as Promise<LedgerEntry>)
    return value
  })
}

export async function cancelExpense(ctx: Ctx, id: string, reason: string): Promise<void> {
  need(ctx, 'gastos.editar')
  if (!trim(reason)) fail('Indica el motivo de la cancelación.')
  await tx(ctx, async () => {
    const e = await load(ctx, ctx.db.expenses, id, 'El gasto')
    if (expensePaid(e, await ledgerOfExpense(ctx, id)) > 0) fail('El gasto ya tiene pagos registrados; no se puede cancelar sin conservar el movimiento de dinero.')
    await ctx.db.expenses.put({ ...e, cancelled: true, updatedAt: stamp(ctx) })
    await audit(ctx, 'gasto.cancelado', 'gasto', id, { before: { amountCents: e.amountCents }, reason: trim(reason) })
  })
}

/* ───────── Gastos recurrentes ───────── */
export type RecurringInput = Omit<RecurringExpense, 'orgId' | 'createdAt' | 'updatedAt' | 'id'> & { id?: string }
export async function saveRecurring(ctx: Ctx, i: RecurringInput): Promise<RecurringExpense> {
  need(ctx, 'gastos.editar')
  requireText(i.concept, 'El concepto'); requirePositive(i.amountCents, 'El importe')
  if (!(i.dayOfMonth >= 1 && i.dayOfMonth <= 31)) fail('El día del mes debe estar entre 1 y 31.')
  return tx(ctx, async () => {
    await checkCategory(ctx, i.categoryId)
    const at = stamp(ctx), cur = i.id ? await load(ctx, ctx.db.recurring, i.id, 'El gasto recurrente') : null
    const r: RecurringExpense = { ...i, id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at }
    await ctx.db.recurring.put(r)
    await audit(ctx, cur ? 'gasto_recurrente.modificado' : 'gasto_recurrente.creado', 'gasto_recurrente', r.id, { after: { concept: r.concept, amountCents: r.amountCents } })
    return r
  })
}

function dueDates(r: RecurringExpense, upTo: ISODate): { key: string; date: ISODate }[] {
  const out: { key: string; date: ISODate }[] = []
  if (r.frequency === 'semanal') { for (let d = r.startDate; d <= upTo; d = addDays(d, 7)) out.push({ key: `${r.id}:${d}`, date: d }); return out }
  for (let m = r.startDate.slice(0, 7) + '-01'; m <= upTo; m = addMonths(m, 1)) {
    const last = +endOfMonth(m).slice(8), day = Math.min(r.dayOfMonth, last)
    const date = `${m.slice(0, 8)}${String(day).padStart(2, '0')}`
    if (date >= r.startDate && date <= upTo) out.push({ key: `${r.id}:${m.slice(0, 7)}`, date })
  }
  return out
}
/** Genera los gastos vencidos de las plantillas activas. Idempotente: cada periodo se crea una sola vez. */
export async function generateRecurring(ctx: Ctx, upTo?: ISODate): Promise<number> {
  need(ctx, 'gastos.editar')
  return tx(ctx, async () => {
    const limit = upTo ?? today(ctx)
    let n = 0
    for (const r of await ctx.db.recurring.toArray()) {
      if (!r.active) continue
      for (const d of dueDates(r, limit)) {
        if (await ctx.db.expenses.where('recurringKey').equals(d.key).count()) continue
        const at = stamp(ctx)
        await ctx.db.expenses.add({ id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, concept: r.concept, categoryId: r.categoryId, date: d.date, amountCents: r.amountCents, taxCents: r.taxCents, supplierId: r.supplierId, costCenter: r.costCenter, notes: 'Generado desde gasto recurrente', recurringId: r.id, recurringKey: d.key, attachmentIds: [] })
        n++
      }
    }
    if (n) await audit(ctx, 'gasto_recurrente.generado', 'gasto_recurrente', '', { after: { creados: n, hasta: limit } })
    return n
  })
}

/** Previsión (estimación, no gasto real): lo que generarán las plantillas activas en los próximos meses. */
export function forecastRecurring(templates: readonly RecurringExpense[], from: ISODate, months: number): { month: string; cents: number }[] {
  const out: { month: string; cents: number }[] = []
  for (let k = 0; k < months; k++) {
    const m = addMonths(from.slice(0, 7) + '-01', k)
    const to = endOfMonth(m)
    let cents = 0
    for (const r of templates) if (r.active) for (const d of dueDates(r, to)) if (d.date.slice(0, 7) === m.slice(0, 7) && d.date > from) cents += r.amountCents + r.taxCents
    out.push({ month: m.slice(0, 7), cents })
  }
  return out
}
