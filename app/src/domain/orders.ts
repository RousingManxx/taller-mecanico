import { lineAmounts, sumLines } from './lines'
import { marginPct } from './pricing'
import type { ItemStatus, ItemType, OrderStatus, Settings, WorkItem, WorkOrder } from './types'

export const STATUS_LABEL: Record<OrderStatus, string> = {
  borrador: 'Borrador', pendiente_autorizacion: 'Pendiente de autorización', autorizada: 'Autorizada', espera_diagnostico: 'En espera de diagnóstico',
  en_diagnostico: 'En diagnóstico', esperando_refacciones: 'Esperando refacciones', en_reparacion: 'En reparación', en_pruebas: 'En pruebas',
  lista_entrega: 'Lista para entrega', entregada: 'Entregada', cancelada: 'Cancelada',
}
export const STATUS_ORDER: OrderStatus[] = ['borrador', 'espera_diagnostico', 'en_diagnostico', 'pendiente_autorizacion', 'autorizada', 'esperando_refacciones', 'en_reparacion', 'en_pruebas', 'lista_entrega', 'entregada', 'cancelada']
export const OPEN_STATUSES: OrderStatus[] = STATUS_ORDER.filter((s) => s !== 'entregada' && s !== 'cancelada')
export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = { sugerido: 'Sugerido', cotizado: 'Cotizado', autorizado: 'Autorizado', ejecutado: 'Ejecutado', rechazado: 'Rechazado' }
export const ITEM_TYPE_LABEL: Record<ItemType, string> = { servicio: 'Mano de obra', refaccion: 'Refacción', consumible: 'Consumible', externo: 'Servicio externo', otro: 'Otro cargo' }

const T: Record<OrderStatus, OrderStatus[]> = {
  borrador: ['espera_diagnostico', 'en_diagnostico', 'pendiente_autorizacion', 'autorizada', 'cancelada'],
  espera_diagnostico: ['en_diagnostico', 'pendiente_autorizacion', 'cancelada'],
  en_diagnostico: ['pendiente_autorizacion', 'autorizada', 'cancelada'],
  pendiente_autorizacion: ['autorizada', 'en_diagnostico', 'cancelada'],
  autorizada: ['esperando_refacciones', 'en_reparacion', 'en_diagnostico', 'cancelada'],
  esperando_refacciones: ['en_reparacion', 'autorizada', 'cancelada'],
  en_reparacion: ['esperando_refacciones', 'en_pruebas', 'lista_entrega', 'cancelada'],
  en_pruebas: ['en_reparacion', 'lista_entrega', 'cancelada'],
  lista_entrega: ['en_reparacion', 'en_pruebas', 'entregada', 'cancelada'],
  entregada: [],
  cancelada: [],
}
export const nextStatuses = (s: OrderStatus): OrderStatus[] => T[s]

export const isExecutable = (i: WorkItem) => i.status === 'autorizado' || i.status === 'ejecutado'
/** Partidas que cuentan para el cobro: autorizadas o ejecutadas (las sugeridas/cotizadas/rechazadas no). */
export const billableItems = (o: Pick<WorkOrder, 'items'>) => o.items.filter(isExecutable)
export const pendingMandatory = (o: Pick<WorkOrder, 'items'>) => o.items.filter((i) => i.status === 'autorizado')

export interface Guard { ok: boolean; reason?: string }
/** Requisitos para que una orden avance a un estado. La validación real se repite en el servicio. */
export function canTransition(o: WorkOrder, to: OrderStatus): Guard {
  if (!T[o.status].includes(to)) return { ok: false, reason: `No se puede pasar de «${STATUS_LABEL[o.status]}» a «${STATUS_LABEL[to]}».` }
  const hasAuth = o.items.some(isExecutable)
  if (['autorizada', 'esperando_refacciones', 'en_reparacion', 'en_pruebas', 'lista_entrega', 'entregada'].includes(to) && !o.isWarranty && !hasAuth)
    return { ok: false, reason: 'Autoriza al menos una partida antes de avanzar.' }
  if (to === 'en_reparacion' && !o.mechanicId) return { ok: false, reason: 'Asigna un mecánico antes de iniciar la reparación.' }
  if (to === 'lista_entrega' || to === 'entregada') {
    const pending = pendingMandatory(o)
    if (pending.length) return { ok: false, reason: `Quedan ${pending.length} trabajo(s) autorizado(s) sin ejecutar: ${pending.slice(0, 3).map((i) => i.description).join(', ')}.` }
  }
  if (to === 'pendiente_autorizacion' && o.items.length === 0) return { ok: false, reason: 'Agrega al menos una partida para pedir autorización.' }
  return { ok: true }
}

export interface OrderTotals {
  netCents: number; taxCents: number; totalCents: number
  byType: Record<ItemType, number>
  /** Total de lo sugerido/cotizado aún sin autorizar (no se cobra). */
  pendingApprovalCents: number
}
export function orderTotals(o: Pick<WorkOrder, 'items'>, s: Pick<Settings, 'pricesIncludeTax'>): OrderTotals {
  const byType: Record<ItemType, number> = { servicio: 0, refaccion: 0, consumible: 0, externo: 0, otro: 0 }
  const amounts = billableItems(o).map((i) => { const a = lineAmounts(i, s.pricesIncludeTax); byType[i.type] += a.netCents; return a })
  const t = sumLines(amounts)
  const pend = sumLines(o.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado').map((i) => lineAmounts(i, s.pricesIncludeTax)))
  return { ...t, byType, pendingApprovalCents: pend.totalCents }
}

export interface OrderEconomics {
  netCents: number; partsCostCents: number; externalCostCents: number; consumableCostCents: number; laborCostCents: number
  directCostCents: number; profitCents: number; marginPct: number | null
  /** true si falta información (p. ej. sin tiempos registrados) o si la orden sigue abierta. */
  provisional: boolean; missing: string[]
}
/** Resultado económico de la orden con datos observados; cuando faltan tiempos reales se avisa en lugar de inventar un costo. */
export function orderEconomics(o: WorkOrder, s: Pick<Settings, 'pricesIncludeTax'>, laborCostCents: number, estimatedLaborCents = 0): OrderEconomics {
  const t = orderTotals(o, s)
  const cost = (ty: ItemType) => billableItems(o).filter((i) => i.type === ty).reduce((a, i) => a + i.costCents, 0)
  const missing: string[] = []
  const hasService = billableItems(o).some((i) => i.type === 'servicio' && i.stdHours > 0)
  let labor = laborCostCents
  if (labor === 0 && hasService) { labor = estimatedLaborCents; missing.push(estimatedLaborCents > 0 ? 'Sin tiempos reales: la mano de obra usa el tiempo estándar (estimado).' : 'Sin tiempos ni costo laboral: la mano de obra aparece en cero.') }
  const unexecuted = o.items.filter((i) => i.status === 'autorizado').length
  if (unexecuted) missing.push(`${unexecuted} partida(s) autorizada(s) aún sin ejecutar.`)
  const parts = cost('refaccion'), ext = cost('externo'), cons = cost('consumible') + cost('otro')
  const direct = parts + ext + cons + labor
  return {
    netCents: t.netCents, partsCostCents: parts, externalCostCents: ext, consumableCostCents: cons, laborCostCents: labor,
    directCostCents: direct, profitCents: t.netCents - direct, marginPct: marginPct(t.netCents, direct),
    provisional: o.status !== 'entregada' || missing.length > 0, missing,
  }
}

/* ───────── Tiempos y mano de obra de la orden ───────── */
import { hourlyLaborCost, minutesBetween } from './labor'
import type { Employee } from './types'

export interface TimeSummary {
  workMinutes: number; waitMinutes: number
  /** Tiempo transcurrido desde la recepción (no son horas de mano de obra). */
  elapsedMinutes: number
  laborCostCents: number
  byEmployee: { employeeId: string; minutes: number; costCents: number }[]
}
/** Suma tramos cerrados y abiertos (hasta `nowIso`). Un mecánico solo puede tener un tramo de trabajo abierto, por lo que las horas no se duplican. */
export function timeSummary(o: Pick<WorkOrder, 'timeEntries' | 'receivedAt' | 'deliveredAt' | 'status'>, nowIso: string): TimeSummary {
  let work = 0, wait = 0, cost = 0
  const by = new Map<string, { minutes: number; costCents: number }>()
  for (const t of o.timeEntries) {
    const mins = t.endAt ? t.minutes : minutesBetween(t.startAt, nowIso)
    if (t.kind === 'espera') { wait += mins; continue }
    const c = t.endAt ? t.costCents : Math.round((mins / 60) * t.hourlyCostCents)
    work += mins; cost += c
    const cur = by.get(t.employeeId) ?? { minutes: 0, costCents: 0 }
    by.set(t.employeeId, { minutes: cur.minutes + mins, costCents: cur.costCents + c })
  }
  const end = o.deliveredAt ?? nowIso
  return { workMinutes: work, waitMinutes: wait, elapsedMinutes: minutesBetween(o.receivedAt, end), laborCostCents: cost, byEmployee: [...by].map(([employeeId, v]) => ({ employeeId, ...v })) }
}
/** Costo estimado de mano de obra con el tiempo estándar de las partidas de servicio autorizadas (solo si no hay tiempos reales). */
export function estimatedLabor(o: Pick<WorkOrder, 'items' | 'mechanicId'>, employees: readonly Employee[], s: Parameters<typeof hourlyLaborCost>[1]): number {
  const hours = billableItems(o).filter((i) => i.type === 'servicio').reduce((a, i) => a + i.stdHours * i.qty, 0)
  const emp = employees.find((e) => e.id === o.mechanicId)
  const hourly = emp ? hourlyLaborCost(emp, s) : 0
  return Math.round(hours * hourly)
}
