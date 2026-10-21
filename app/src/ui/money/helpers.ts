import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import type { PayStatus } from '../../domain/finance'
import { periodRange, startOfMonth, type Period, type Range } from '../../domain/dates'
import type { CashSession, LedgerEntry, PaymentMethod } from '../../domain/types'
import { fmtDate, type Data } from '../data'
import { useCtx } from '../session'

/** Importe en pesos con dos decimales, para CSV. */
export const pesosStr = (c: number): string => (c / 100).toFixed(2)

export const PAY_TONE: Record<PayStatus, '' | 'ok' | 'warn' | 'bad' | 'info'> = { pagada: 'ok', parcial: 'info', pendiente: 'warn', cancelada: '', sin_importe: '' }

/* ───────── Caja ───────── */
export const openSessionOf = (d: Pick<Data, 'cashSessions'>): CashSession | undefined => d.cashSessions.find((s) => s.status === 'abierta')
/** Efectivo esperado en vivo: apertura + movimientos en efectivo ligados a la sesión. */
export function sessionExpectedLive(s: CashSession, ledger: readonly LedgerEntry[]): number {
  let t = s.openingCents
  for (const l of ledger) if (l.sessionId === s.id && l.account === 'caja') t += l.direction === 'in' ? l.amountCents : -l.amountCents
  return t
}
/** Último efectivo contado al cerrar una caja (saldo inicial sugerido). */
export function lastCounted(d: Pick<Data, 'cashSessions'>): number {
  const closed = d.cashSessions.filter((s) => s.status === 'cerrada' && s.closedAt).sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
  return closed[0]?.countedCents ?? 0
}
export const methodOf = (d: Pick<Data, 'settings'>, id: string): PaymentMethod | undefined => d.settings.paymentMethods.find((m) => m.id === id)
export const isCashMethod = (d: Pick<Data, 'settings'>, id: string): boolean => methodOf(d, id)?.account === 'caja'
export const methodName = (d: Pick<Data, 'settings'>, id: string): string => methodOf(d, id)?.name ?? id

/** Nombres de usuario por id (la tabla de usuarios no viaja en `data`). */
export function useUserNames(): (id?: string) => string {
  const ctx = useCtx()
  const users = useLiveQuery(() => ctx.db.users.toArray(), [ctx.db])
  const m = useMemo(() => new Map((users ?? []).map((u) => [u.id, u.name])), [users])
  return (id) => (id ? m.get(id) ?? '—' : '—')
}

/* ───────── Periodos ───────── */
export type Per = Period | 'todo'
export interface PerState { p: Per; from: string; to: string }
export const initPer = (p: Per, today: string): PerState => ({ p, from: startOfMonth(today), to: today })
export function rangeOf(s: PerState, today: string): Range {
  if (s.p === 'todo') return { from: '2000-01-01', to: '2999-12-31' }
  if (s.p === 'custom') return s.from <= s.to ? { from: s.from, to: s.to } : { from: s.to, to: s.from }
  return periodRange(s.p, today)
}
export const rangeText = (s: PerState, r: Range): string => (s.p === 'todo' ? 'Todo el historial' : r.from === r.to ? fmtDate(r.from) : `${fmtDate(r.from)} al ${fmtDate(r.to)}`)

/* ───────── Contacto y origen ───────── */
export const digits = (s: string): string => s.replace(/\D/g, '')
/** Enlace de WhatsApp (México: 10 dígitos → lada 52). */
export function waLink(phone: string, text: string): string | null {
  let d = digits(phone)
  if (d.length === 10) d = '52' + d
  return d.length >= 11 ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null
}
export const telLink = (phone: string): string | null => (digits(phone).length >= 8 ? `tel:${digits(phone)}` : null)

/** Origen de un movimiento de dinero: texto y, si existe, ruta. */
export function ledgerOrigin(l: LedgerEntry, d: Data): { label: string; to?: string } | null {
  if (l.saleId) { const s = d.sales.find((x) => x.id === l.saleId); return { label: s ? `Venta ${s.folio}` : 'Venta', to: `/ventas/${l.saleId}` } }
  if (l.workOrderId) { const o = d.orderMap.get(l.workOrderId); return { label: o ? `Anticipo de ${o.folio}` : 'Anticipo de orden', to: `/ordenes/${l.workOrderId}` } }
  if (l.expenseId) { const e = d.expenses.find((x) => x.id === l.expenseId); return { label: e ? `Gasto: ${e.concept}` : 'Gasto', to: '/gastos?t=gastos' } }
  if (l.kind === 'pago_proveedor' || l.kind === 'reembolso_proveedor') return { label: `Proveedor: ${d.supMap.get(l.supplierId ?? '')?.name ?? '—'}`, to: '/compras?t=recepciones' }
  return null
}
