import { useEffect, useState } from 'react'
import { avgCost } from '../../domain/inventory'
import type { Authorization, Employee, ItemStatus, LedgerEntry, OrderStatus, Product, Sale, WorkItem, WorkOrder } from '../../domain/types'
import { fmtDate, fmtDateTime, fmtHours, type Data } from '../data'

export type Tone = '' | 'ok' | 'warn' | 'bad' | 'info'

/** Texto sin acentos y en minúsculas, para búsquedas. */
export const norm = (s: string | number | undefined | null): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const STATUS_TONE: Record<OrderStatus, Tone> = {
  borrador: '', espera_diagnostico: '', en_diagnostico: 'info', pendiente_autorizacion: 'warn', autorizada: 'info', esperando_refacciones: 'warn',
  en_reparacion: 'info', en_pruebas: 'info', lista_entrega: 'ok', entregada: 'ok', cancelada: 'bad',
}
export const ITEM_TONE: Record<ItemStatus, Tone> = { sugerido: '', cotizado: 'warn', autorizado: 'info', ejecutado: 'ok', rechazado: 'bad' }
export const PRIORITY_LABEL: Record<WorkOrder['priority'], string> = { baja: 'Baja', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }
export const PRIORITY_TONE: Record<WorkOrder['priority'], Tone> = { baja: '', normal: '', alta: 'warn', urgente: 'bad' }
export const PRIORITY_RANK: Record<WorkOrder['priority'], number> = { urgente: 3, alta: 2, normal: 1, baja: 0 }
export const VIA_LABEL: Record<Authorization['via'], string> = { presencial: 'Presencial', telefono: 'Teléfono', whatsapp: 'WhatsApp', firma: 'Firma', otro: 'Otro' }
export const FUEL_LEVELS = ['Reserva', '1/4', '1/2', '3/4', 'Lleno']
/** Estados en los que el servicio permite registrar tiempo de trabajo. */
export const WORK_STATUSES: OrderStatus[] = ['en_diagnostico', 'autorizada', 'en_reparacion', 'en_pruebas']

export const isClosed = (o: Pick<WorkOrder, 'status'>) => o.status === 'entregada' || o.status === 'cancelada'
export const isTrackable = (i: WorkItem) => i.type === 'refaccion' || i.type === 'consumible'
export const remainingQty = (i: WorkItem) => Math.max(0, Math.round((i.qty - i.consumedQty) * 1000) / 1000)

/** Reloj que se actualiza cada `ms` milisegundos mientras `enabled`. */
export function useNow(ms = 1000, enabled = true): number {
  const [n, setN] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setN(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, enabled])
  return n
}

export const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`
}
/** Duración legible en días/horas/minutos. */
export const fmtSpan = (min: number): string => {
  if (min >= 1440) { const d = Math.floor(min / 1440), h = Math.floor((min % 1440) / 60); return `${d} d ${h} h` }
  return fmtHours(min)
}
/** Horas decimales con dos decimales ("1.50 h"). */
export const fmtDecHours = (min: number): string => `${(min / 60).toFixed(2)} h`

const minutesSince = (iso: string, nowMs: number) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000))
/** Tiempo en taller: desde la recepción hasta la entrega (o hasta ahora si sigue abierta). Canceladas: no aplica. */
export function minutesInShop(o: WorkOrder, nowMs: number): number | null {
  if (o.status === 'cancelada') return null
  if (o.deliveredAt) return Math.max(0, Math.round((new Date(o.deliveredAt).getTime() - new Date(o.receivedAt).getTime()) / 60000))
  return minutesSince(o.receivedAt, nowMs)
}

const dateOnly = (p: string) => p.length === 10
/** Fecha promesa: texto y si está vencida (solo cuenta en órdenes abiertas). */
export function promiseInfo(o: WorkOrder, nowMs: number, today: string): { text: string; overdue: boolean } | null {
  if (!o.promisedAt) return null
  const overdue = !isClosed(o) && (dateOnly(o.promisedAt) ? o.promisedAt < today : new Date(o.promisedAt).getTime() < nowMs)
  return { text: dateOnly(o.promisedAt) ? fmtDate(o.promisedAt) : fmtDateTime(o.promisedAt), overdue }
}
/** Valor de <input type="datetime-local"> a partir de la fecha promesa guardada. */
export const promisedToInput = (p?: string): string => {
  if (!p) return ''
  const d = new Date(dateOnly(p) ? p + 'T12:00:00' : p)
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}
export const inputToIso = (v: string): string | undefined => (v ? new Date(v).toISOString() : undefined)

export const mechanicsOf = (d: Data): Employee[] => d.employees.filter((e) => e.isMechanic && e.active)
export const mechanicName = (d: Data, id?: string): string => (id ? d.empMap.get(id)?.name ?? '—' : 'Sin asignar')

const PAY_KINDS = ['cobro_cliente', 'reembolso_cliente']
export const saleOfOrder = (d: Data, o: WorkOrder): Sale | undefined => (o.saleId ? d.sales.find((s) => s.id === o.saleId) : undefined)
/** Cobros netos (cobros − reembolsos) de la orden que aún no están ligados a una venta (anticipos). */
export function advancesOf(ledger: readonly LedgerEntry[], orderId: string): number {
  let t = 0
  for (const l of ledger) if (PAY_KINDS.includes(l.kind) && l.workOrderId === orderId && !l.saleId) t += l.direction === 'in' ? l.amountCents : -l.amountCents
  return t
}
/** Cobros y reembolsos que pertenecen a la orden o a su venta, del más reciente al más antiguo. */
export function paymentsOf(d: Data, o: WorkOrder): LedgerEntry[] {
  return d.ledger.filter((l) => PAY_KINDS.includes(l.kind) && (l.workOrderId === o.id || (!!o.saleId && l.saleId === o.saleId))).sort((a, b) => b.at.localeCompare(a.at))
}

export const stockQty = (d: Data, productId?: string): number => (productId ? d.stock.get(productId)?.qty ?? 0 : 0)
/** Costo unitario vigente (centavos, decimal): promedio de existencias o, sin existencias, último costo de compra. 0 = sin dato. */
export function unitCostOf(d: Data, p: Pick<Product, 'id' | 'lastPurchaseCost'>): number {
  const b = d.stock.get(p.id)
  const a = b ? avgCost(b) : 0
  return a > 0 ? a : p.lastPurchaseCost ?? 0
}

export const openWorkEntries = (o: WorkOrder) => o.timeEntries.filter((t) => !t.endAt && t.kind === 'trabajo')

/** Abre el flujo de impresión de un documento (otra persona construye la pantalla). */
export const printHref = (kind: 'orden' | 'recepcion' | 'autorizacion' | 'entrega' | 'garantia', orderId: string, authId?: string) =>
  `#/imprimir/${kind}/${orderId}${authId ? `?auth=${authId}` : ''}`
