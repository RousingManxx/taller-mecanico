/* Utilidades puras de la interfaz de clientes, vehículos, agenda y cotizaciones (sin React). */
import { diffDays, localDate } from '../../domain/dates'
import { saleBalance, saleNetOfReturns, saleReturnsTotal } from '../../domain/finance'
import { currentVersion, quoteSummary } from '../../domain/quotes'
import type { AppointmentStatus, Appointment, LedgerEntry, QuoteStatus, Quotation, Sale, Settings, WorkItem, WorkOrder } from '../../domain/types'
import { fmtDate, type Data } from '../data'

export const norm = (s: string | number | undefined | null): string => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
export const digits = (s: string): string => s.replace(/\D/g, '')

/** Enlaces de contacto. No se envía nada: solo abren la app del dispositivo. */
export const telHref = (phone: string): string | null => { const d = digits(phone); return d.length >= 7 ? `tel:${d}` : null }
export const waHref = (phone: string): string | null => { const d = digits(phone); return d.length >= 10 ? `https://wa.me/52${d.slice(-10)}` : null }
export const mailHref = (email: string): string | null => (email.trim() ? `mailto:${email.trim()}` : null)

/* ───────── Zona horaria del taller ───────── */
function wallClock(d: Date, tz: string): number {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
}
/** Fecha 'YYYY-MM-DD' y hora 'HH:mm' (hora del taller) → ISO UTC. */
export function zonedToISO(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number), [hh, mm] = time.split(':').map(Number)
  const asUtc = Date.UTC(y, m - 1, d, hh, mm)
  let guess = asUtc - (wallClock(new Date(asUtc), tz) - asUtc)
  guess = asUtc - (wallClock(new Date(guess), tz) - guess)
  return new Date(guess).toISOString()
}
export function isoToZoned(iso: string, tz: string): { date: string; time: string } {
  const d = new Date(iso)
  return { date: localDate(d, tz), time: new Intl.DateTimeFormat('es-MX', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d) }
}
export const timeOf = (iso: string, tz: string): string => isoToZoned(iso, tz).time
export const dayOf = (iso: string, tz: string): string => localDate(new Date(iso), tz)
/** Fecha de negocio → Date al mediodía local (para formatear sin saltos de día). */
export const noon = (s: string): Date => new Date(s + 'T12:00:00')
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
export const fmtLong = (s: string): string => noon(s).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/* ───────── Agenda ───────── */
export const APPT_LABEL: Record<AppointmentStatus, string> = {
  solicitada: 'Solicitada', confirmada: 'Confirmada', en_recepcion: 'En recepción', convertida: 'Convertida en orden', completada: 'Completada', cancelada: 'Cancelada', no_asistio: 'No asistió',
}
export const APPT_TONE: Record<AppointmentStatus, '' | 'ok' | 'warn' | 'bad' | 'info'> = {
  solicitada: 'warn', confirmada: 'info', en_recepcion: 'info', convertida: 'ok', completada: 'ok', cancelada: '', no_asistio: 'bad',
}
/** Citas por atender (aún no se convierten ni se cierran). */
export const APPT_PENDING: AppointmentStatus[] = ['solicitada', 'confirmada', 'en_recepcion']
/** Citas que ocupan al mecánico (el servicio rechaza dobles asignaciones entre estas). */
export const APPT_BUSY: AppointmentStatus[] = ['solicitada', 'confirmada', 'en_recepcion', 'convertida']
export const apptEnd = (a: Pick<Appointment, 'start' | 'durationMin'>): number => new Date(a.start).getTime() + a.durationMin * 60000
export function apptFlags(a: Appointment, today: string, tz: string, now = Date.now()): { today: boolean; overdue: boolean } {
  return { today: dayOf(a.start, tz) === today, overdue: APPT_PENDING.includes(a.status) && apptEnd(a) < now }
}
export function findClash(list: readonly Appointment[], c: { id?: string; mechanicId?: string; start: string; durationMin: number; status: AppointmentStatus }): Appointment | undefined {
  if (!c.mechanicId || !APPT_BUSY.includes(c.status)) return undefined
  const s = new Date(c.start).getTime(), e = s + c.durationMin * 60000
  return list.find((a) => a.id !== c.id && a.mechanicId === c.mechanicId && APPT_BUSY.includes(a.status) && new Date(a.start).getTime() < e && apptEnd(a) > s)
}

/* ───────── Cotizaciones ───────── */
export const QUOTE_ORDER: QuoteStatus[] = ['borrador', 'enviada', 'vista', 'aprobada', 'rechazada', 'vencida', 'convertida']
export const QUOTE_TONE: Record<QuoteStatus, '' | 'ok' | 'warn' | 'bad' | 'info'> = { borrador: '', enviada: 'info', vista: 'info', aprobada: 'ok', rechazada: 'bad', vencida: 'warn', convertida: 'ok' }
/** Estado que se muestra: una cotización sin respuesta cuya vigencia pasó se ve como vencida aunque aún no se haya persistido. */
export const effStatus = (q: Quotation, today: string): QuoteStatus => (['borrador', 'enviada', 'vista'].includes(q.status) && q.validUntil < today ? 'vencida' : q.status)
export const quoteTotals = (q: Quotation, s: Pick<Settings, 'pricesIncludeTax'>) => quoteSummary(currentVersion(q).items, s)

/* ───────── Dinero por cliente ───────── */
export interface LedgerIndex { bySale: Map<string, LedgerEntry[]>; byOrder: Map<string, LedgerEntry[]> }
const isCustomerCash = (l: LedgerEntry) => l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente'
export function indexLedger(ledger: readonly LedgerEntry[]): LedgerIndex {
  const bySale = new Map<string, LedgerEntry[]>(), byOrder = new Map<string, LedgerEntry[]>()
  for (const l of ledger) {
    if (!isCustomerCash(l)) continue
    if (l.saleId) bySale.set(l.saleId, [...(bySale.get(l.saleId) ?? []), l])
    else if (l.workOrderId) byOrder.set(l.workOrderId, [...(byOrder.get(l.workOrderId) ?? []), l])
  }
  return { bySale, byOrder }
}
/** Saldo de una venta con `saleBalance` usando solo los movimientos que le corresponden (evita recorrer todo el libro por venta). */
export const entriesOf = (s: Sale, idx: LedgerIndex): LedgerEntry[] => [...(idx.bySale.get(s.id) ?? []), ...(s.workOrderId ? idx.byOrder.get(s.workOrderId) ?? [] : [])]
export const balanceOf = (s: Sale, idx: LedgerIndex): number => saleBalance(s, entriesOf(s, idx))

export interface CustomerAgg { visits: number; lastVisit?: string; balanceCents: number; vehicles: number }
/** Totales por cliente para la lista: visitas (órdenes entregadas), saldo pendiente actual y vehículos. */
export function aggregateCustomers(d: Data): Map<string, CustomerAgg> {
  const tz = d.settings.timezone
  const m = new Map<string, CustomerAgg>()
  const get = (id: string) => { let a = m.get(id); if (!a) { a = { visits: 0, balanceCents: 0, vehicles: 0 }; m.set(id, a) } return a }
  for (const o of d.orders) if (o.status === 'entregada') { const a = get(o.customerId); a.visits++; const day = localDate(new Date(o.deliveredAt ?? o.receivedAt), tz); if (!a.lastVisit || day > a.lastVisit) a.lastVisit = day }
  for (const v of d.vehicles) if (v.active) get(v.customerId).vehicles++
  if (d.can('ventas.ver')) {
    const idx = indexLedger(d.ledger)
    for (const s of d.sales) if (s.customerId && s.status === 'emitida') { const b = balanceOf(s, idx); if (b > 0) get(s.customerId).balanceCents += b }
  }
  return m
}

/** Cobros y reembolsos de un cliente: los que llevan su id, los de sus ventas y los anticipos de sus órdenes. */
export function customerLedger(d: Data, customerId: string): LedgerEntry[] {
  const saleIds = new Set(d.sales.filter((s) => s.customerId === customerId).map((s) => s.id)), orderIds = new Set(d.orders.filter((o) => o.customerId === customerId).map((o) => o.id))
  return d.ledger.filter((l) => isCustomerCash(l) && (l.customerId === customerId || (l.saleId && saleIds.has(l.saleId)) || (!l.saleId && l.workOrderId && orderIds.has(l.workOrderId)))).sort((a, b) => b.at.localeCompare(a.at))
}

export interface CustomerStats {
  sales: Sale[]; boughtCents: number; paidCents: number; balanceCents: number; visits: number; lastVisit?: string
  avgTicketNetCents: number | null; netSalesCents: number
}
export function customerStats(d: Data, customerId: string): CustomerStats {
  const idx = indexLedger(d.ledger)
  const sales = d.sales.filter((s) => s.customerId === customerId && s.status === 'emitida')
  const saleIds = new Set(sales.map((s) => s.id)), orderIds = new Set(d.orders.filter((o) => o.customerId === customerId).map((o) => o.id))
  let paid = 0
  for (const l of d.ledger) {
    if (!isCustomerCash(l)) continue
    if (l.customerId === customerId || (l.saleId && saleIds.has(l.saleId)) || (!l.saleId && l.workOrderId && orderIds.has(l.workOrderId))) paid += l.direction === 'in' ? l.amountCents : -l.amountCents
  }
  const bought = sales.reduce((a, s) => a + s.totalCents - saleReturnsTotal(s), 0)
  const net = sales.reduce((a, s) => a + saleNetOfReturns(s), 0)
  let balance = 0
  for (const s of sales) { const b = balanceOf(s, idx); if (b > 0) balance += b }
  const delivered = d.orders.filter((o) => o.customerId === customerId && o.status === 'entregada')
  let last: string | undefined
  for (const o of delivered) { const day = localDate(new Date(o.deliveredAt ?? o.receivedAt), d.settings.timezone); if (!last || day > last) last = day }
  return { sales, boughtCents: bought, paidCents: paid, balanceCents: balance, visits: delivered.length, lastVisit: last, avgTicketNetCents: sales.length ? Math.round(net / sales.length) : null, netSalesCents: net }
}

/* ───────── Historial del vehículo ───────── */
export const isInstalledPart = (i: WorkItem) => i.type === 'refaccion' && (i.consumedQty > 0 || i.status === 'ejecutado')
export const isDoneService = (i: WorkItem) => i.status === 'ejecutado' && (i.type === 'servicio' || i.type === 'externo')
export const visitDay = (o: WorkOrder, tz: string) => localDate(new Date(o.deliveredAt ?? o.receivedAt), tz)

export interface Recurrence { kind: 'refaccion' | 'servicio'; label: string; times: number; orderIds: string[]; detail: string }
/** Posibles recurrencias: misma refacción instalada ≥ 2 veces, o el mismo servicio repetido con menos de 90 días entre una visita y la siguiente. */
export function detectRecurrences(orders: readonly WorkOrder[], tz: string): Recurrence[] {
  const live = orders.filter((o) => o.status !== 'cancelada').sort((a, b) => visitDay(a, tz).localeCompare(visitDay(b, tz)))
  const parts = new Map<string, { label: string; ids: string[]; dates: string[] }>()
  const svcs = new Map<string, { label: string; visits: { id: string; day: string }[] }>()
  for (const o of live) {
    const day = visitDay(o, tz)
    const seenP = new Set<string>(), seenS = new Set<string>()
    for (const i of o.items) {
      if (isInstalledPart(i)) {
        const k = i.refId ?? norm(i.description)
        if (seenP.has(k)) continue
        seenP.add(k)
        const e = parts.get(k) ?? { label: i.description, ids: [], dates: [] }
        e.ids.push(o.id); e.dates.push(day); parts.set(k, e)
      } else if (isDoneService(i)) {
        const k = i.refId ?? norm(i.description)
        if (seenS.has(k)) continue
        seenS.add(k)
        const e = svcs.get(k) ?? { label: i.description, visits: [] }
        e.visits.push({ id: o.id, day }); svcs.set(k, e)
      }
    }
  }
  const out: Recurrence[] = []
  for (const e of parts.values()) if (e.ids.length >= 2) out.push({ kind: 'refaccion', label: e.label, times: e.ids.length, orderIds: e.ids, detail: `Refacción instalada ${e.ids.length} veces (${e.dates.map((d) => fmtDate(d)).join(', ')}).` })
  for (const e of svcs.values()) {
    const close = new Set<string>()
    let minGap = Infinity
    for (let i = 1; i < e.visits.length; i++) {
      const gap = diffDays(e.visits[i - 1].day, e.visits[i].day)
      if (gap < 90) { close.add(e.visits[i - 1].id); close.add(e.visits[i].id); minGap = Math.min(minGap, gap) }
    }
    if (close.size) out.push({ kind: 'servicio', label: e.label, times: close.size, orderIds: [...close], detail: `Servicio repetido en ${close.size} visitas; dos de ellas con solo ${minGap} día${minGap === 1 ? '' : 's'} de diferencia.` })
  }
  return out
}

export interface InstalledPart { key: string; label: string; qty: number; times: number; last: string; unit: string }
export function installedParts(orders: readonly WorkOrder[], tz: string): InstalledPart[] {
  const m = new Map<string, InstalledPart>()
  for (const o of orders) {
    if (o.status === 'cancelada') continue
    const day = visitDay(o, tz)
    for (const i of o.items) {
      if (!isInstalledPart(i)) continue
      const k = i.refId ?? norm(i.description)
      const e = m.get(k) ?? { key: k, label: i.description, qty: 0, times: 0, last: day, unit: i.unit }
      e.qty += i.consumedQty > 0 ? i.consumedQty : i.qty; e.times++
      if (day > e.last) e.last = day
      m.set(k, e)
    }
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last))
}

/** Garantía aplicable: fecha de entrega + días de garantía configurados. */
export function warrantyInfo(o: WorkOrder, s: Pick<Settings, 'warrantyDays' | 'timezone'>, today: string): { until: string; active: boolean } | null {
  if (o.status !== 'entregada' || !o.deliveredAt || !(s.warrantyDays > 0)) return null
  const d = new Date(o.deliveredAt); d.setUTCDate(d.getUTCDate() + s.warrantyDays)
  const until = localDate(d, s.timezone)
  return { until, active: today <= until }
}
