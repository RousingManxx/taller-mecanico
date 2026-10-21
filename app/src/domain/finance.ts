import { addDays, bucketFor, bucketKey, bucketKeys, diffDays, inRange, type Bucket, type Range } from './dates'
import { breakEven, type BreakEvenResult } from './pricing'
import { marginPct } from './pricing'
import { round } from './money'
import type { Balance } from './inventory'
import type {
  Expense, ExpenseCategory, ItemType, LedgerEntry, OverheadMethod, PurchaseReceipt, Sale, SaleItem, Settings,
} from './types'

/* ───────────────────────── Saldos de documentos ───────────────────────── */

/** Total devuelto (nota de crédito) de una venta, con impuestos. */
export const saleReturnsTotal = (s: Sale): number => s.returns.reduce((a, r) => a + r.netCents + r.taxCents, 0)
export const saleReturnsNet = (s: Sale): number => s.returns.reduce((a, r) => a + r.netCents, 0)
export const saleNetOfReturns = (s: Sale): number => s.netCents - saleReturnsNet(s)

/** Cobros netos (cobros − reembolsos) aplicados a una venta o a su orden (anticipos). */
export function salePaid(s: Sale, ledger: readonly LedgerEntry[]): number {
  let paid = 0
  for (const l of ledger) {
    if (l.kind !== 'cobro_cliente' && l.kind !== 'reembolso_cliente') continue
    if (l.saleId === s.id || (!l.saleId && s.workOrderId && l.workOrderId === s.workOrderId)) paid += l.direction === 'in' ? l.amountCents : -l.amountCents
  }
  return paid
}
/** Saldo por cobrar: total facturado − devoluciones − cobros netos. Una venta cancelada no genera saldo. */
export function saleBalance(s: Sale, ledger: readonly LedgerEntry[]): number {
  if (s.status === 'cancelada') return 0
  return s.totalCents - saleReturnsTotal(s) - salePaid(s, ledger)
}
export type PayStatus = 'pagada' | 'parcial' | 'pendiente' | 'cancelada' | 'sin_importe'
export function payStatus(s: Sale, ledger: readonly LedgerEntry[]): PayStatus {
  if (s.status === 'cancelada') return 'cancelada'
  const due = s.totalCents - saleReturnsTotal(s)
  if (due <= 0) return 'sin_importe'
  const paid = salePaid(s, ledger)
  return paid <= 0 ? 'pendiente' : paid >= due ? 'pagada' : 'parcial'
}
export const PAY_LABEL: Record<PayStatus, string> = { pagada: 'Pagada', parcial: 'Pago parcial', pendiente: 'Pendiente', cancelada: 'Cancelada', sin_importe: 'Sin importe' }

export function receiptPaid(r: PurchaseReceipt, ledger: readonly LedgerEntry[]): number {
  let paid = 0
  for (const l of ledger) {
    if (l.kind !== 'pago_proveedor' && l.kind !== 'reembolso_proveedor') continue
    for (const a of l.allocations ?? []) if (a.receiptId === r.id) paid += l.direction === 'out' ? a.amountCents : -a.amountCents
  }
  return paid
}
export const receiptBalance = (r: PurchaseReceipt, ledger: readonly LedgerEntry[]): number => r.totalCents - receiptPaid(r, ledger)

/** Cuánto de un gasto ya se pagó (sin contar reembolsos de gasto). */
export function expensePaid(e: Expense, ledger: readonly LedgerEntry[]): number {
  let p = 0
  for (const l of ledger) if (l.expenseId === e.id && l.kind === 'pago_gasto') p += l.direction === 'out' ? l.amountCents : -l.amountCents
  return p
}
export const expenseTotal = (e: Expense): number => e.amountCents + e.taxCents
export const expenseBalance = (e: Expense, ledger: readonly LedgerEntry[]): number => (e.cancelled ? 0 : expenseTotal(e) - expensePaid(e, ledger))

export type AgingBucket = 'no_vencido' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_mas'
export const AGING_LABEL: Record<AgingBucket, string> = { no_vencido: 'No vencido', d1_30: '1–30 días', d31_60: '31–60 días', d61_90: '61–90 días', d90_mas: 'Más de 90 días' }
export const AGING_ORDER: AgingBucket[] = ['no_vencido', 'd1_30', 'd31_60', 'd61_90', 'd90_mas']
export function agingBucket(dueDate: string, asOf: string): { bucket: AgingBucket; daysLate: number } {
  const late = diffDays(dueDate, asOf)
  if (late <= 0) return { bucket: 'no_vencido', daysLate: 0 }
  return { bucket: late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90_mas', daysLate: late }
}
export interface DueRow { id: string; docId: string; party: string; partyId: string; folio: string; date: string; dueDate: string; totalCents: number; paidCents: number; balanceCents: number; bucket: AgingBucket; daysLate: number }

export function receivables(sales: readonly Sale[], ledger: readonly LedgerEntry[], asOf: string): DueRow[] {
  const rows: DueRow[] = []
  for (const s of sales) {
    if (s.status === 'cancelada') continue
    const bal = saleBalance(s, ledger)
    if (bal <= 0) continue
    const total = s.totalCents - saleReturnsTotal(s)
    rows.push({ id: s.id, docId: s.id, party: s.customerName, partyId: s.customerId ?? '', folio: s.folio, date: s.date, dueDate: s.dueDate, totalCents: total, paidCents: total - bal, balanceCents: bal, ...agingBucket(s.dueDate, asOf) })
  }
  return rows.sort((a, b) => b.daysLate - a.daysLate || a.dueDate.localeCompare(b.dueDate))
}
export function payables(receipts: readonly PurchaseReceipt[], expenses: readonly Expense[], ledger: readonly LedgerEntry[], supplierName: (id?: string) => string, asOf: string): (DueRow & { kind: 'compra' | 'gasto' })[] {
  const rows: (DueRow & { kind: 'compra' | 'gasto' })[] = []
  for (const r of receipts) {
    const bal = receiptBalance(r, ledger)
    if (bal > 0) rows.push({ kind: 'compra', id: r.id, docId: r.id, party: supplierName(r.supplierId), partyId: r.supplierId, folio: r.folio, date: r.date, dueDate: r.dueDate, totalCents: r.totalCents, paidCents: r.totalCents - bal, balanceCents: bal, ...agingBucket(r.dueDate, asOf) })
  }
  for (const e of expenses) {
    const bal = expenseBalance(e, ledger)
    if (bal > 0) { const due = e.dueDate ?? e.date; rows.push({ kind: 'gasto', id: e.id, docId: e.id, party: e.supplierId ? supplierName(e.supplierId) : e.concept, partyId: e.supplierId ?? '', folio: e.concept, date: e.date, dueDate: due, totalCents: expenseTotal(e), paidCents: expenseTotal(e) - bal, balanceCents: bal, ...agingBucket(due, asOf) }) }
  }
  return rows.sort((a, b) => b.daysLate - a.daysLate || a.dueDate.localeCompare(b.dueDate))
}
export function agingTotals(rows: readonly { bucket: AgingBucket; balanceCents: number }[]): Record<AgingBucket, number> {
  const t: Record<AgingBucket, number> = { no_vencido: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 }
  for (const r of rows) t[r.bucket] += r.balanceCents
  return t
}

/* ───────────────────────── Estado de resultados gerencial ───────────────────────── */

export interface IncomeStatement {
  range: Range
  /** Ventas netas (antes de impuestos) menos devoluciones. */
  netSalesCents: number; grossSalesCents: number; returnsCents: number; taxCents: number; salesCount: number
  salesByType: Record<ItemType, number>
  cogs: { partsCents: number; consumablesCents: number; externalCents: number; laborCents: number; otherCents: number; totalCents: number }
  grossProfitCents: number; grossMarginPct: number | null
  opex: { byCategory: { categoryId: string; name: string; cents: number }[]; totalCents: number }
  /** Nómina de mecánicos registrada (mano_obra_directa): ya está en el costo laboral imputado, no se resta dos veces. */
  directPayrollCents: number
  /** Parte de la nómina de mecánicos no absorbida por horas facturadas (capacidad ociosa). Sí se resta. */
  idleLaborCents: number
  operatingProfitCents: number; operatingMarginPct: number | null
  /** Partidas con costo estimado (no observado) dentro del periodo. */
  estimatedCostLines: number; estimatedCostCents: number
  warnings: string[]
}

const zeroTypes = (): Record<ItemType, number> => ({ servicio: 0, refaccion: 0, consumible: 0, externo: 0, otro: 0 })

/** Una devolución reduce ventas y costo en la fecha de la devolución; la venta se reconoce en su fecha de emisión. */
export function incomeStatement(sales: readonly Sale[], expenses: readonly Expense[], cats: readonly ExpenseCategory[], r: Range): IncomeStatement {
  const salesByType = zeroTypes()
  let gross = 0, returns = 0, tax = 0, count = 0, parts = 0, cons = 0, ext = 0, labor = 0, other = 0, estLines = 0, estCents = 0
  for (const s of sales) {
    if (s.status === 'cancelada') continue
    if (inRange(s.date, r)) {
      count++; gross += s.netCents; tax += s.taxCents; other += s.otherCostCents
      for (const i of s.items) {
        salesByType[i.type] += i.netCents
        if (i.type === 'refaccion') parts += i.costCents
        else if (i.type === 'consumible' || i.type === 'otro') cons += i.costCents
        else if (i.type === 'externo') ext += i.costCents
        else labor += i.costCents
        if (i.costEstimated) { estLines++; estCents += i.costCents }
      }
    }
    for (const rt of s.returns) {
      if (!inRange(rt.date, r)) continue
      returns += rt.netCents; tax -= rt.taxCents
      const it = s.items.find((x) => x.id === rt.itemId)
      const rec = rt.costRecoveredCents
      if (it?.type === 'refaccion') parts -= rec; else if (it?.type === 'consumible' || it?.type === 'otro') cons -= rec
      salesByType[it?.type ?? 'otro'] -= rt.netCents
    }
  }
  const cogsTotal = parts + cons + ext + labor + other
  const net = gross - returns
  const grossProfit = net - cogsTotal
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const byCat = new Map<string, number>()
  let payroll = 0
  for (const e of expenses) {
    if (e.cancelled || !inRange(e.date, r)) continue
    const c = catMap.get(e.categoryId)
    if (c?.kind === 'mano_obra_directa') { payroll += e.amountCents; continue }
    byCat.set(e.categoryId, (byCat.get(e.categoryId) ?? 0) + e.amountCents)
  }
  const idle = Math.max(0, payroll - labor)
  const opexRows = [...byCat].map(([categoryId, cents]) => ({ categoryId, name: catMap.get(categoryId)?.name ?? 'Sin categoría', cents })).sort((a, b) => b.cents - a.cents)
  const opexTotal = opexRows.reduce((a, x) => a + x.cents, 0) + idle
  const op = grossProfit - opexTotal
  const warnings: string[] = []
  if (estLines) warnings.push(`${estLines} partida(s) usan un costo estimado (no observado) por ${(estCents / 100).toFixed(2)} MXN.`)
  if (payroll > 0 && labor > payroll) warnings.push('La mano de obra imputada supera la nómina de mecánicos registrada: revisa costos laborales o gastos de nómina.')
  if (payroll === 0 && labor > 0) warnings.push('No hay nómina de mecánicos registrada en el periodo; el costo laboral es solo el imputado por horas trabajadas.')
  return {
    range: r, netSalesCents: net, grossSalesCents: gross, returnsCents: returns, taxCents: tax, salesCount: count, salesByType,
    cogs: { partsCents: parts, consumablesCents: cons, externalCents: ext, laborCents: labor, otherCents: other, totalCents: cogsTotal },
    grossProfitCents: grossProfit, grossMarginPct: marginPct(net, cogsTotal),
    opex: { byCategory: opexRows, totalCents: opexTotal }, directPayrollCents: payroll, idleLaborCents: idle,
    operatingProfitCents: op, operatingMarginPct: marginPct(net, cogsTotal + opexTotal),
    estimatedCostLines: estLines, estimatedCostCents: estCents, warnings,
  }
}

/* ───────────────────────── Flujo de efectivo ───────────────────────── */

export interface CashFlow {
  range: Range
  inflows: { kind: string; cents: number }[]; outflows: { kind: string; cents: number }[]
  inCents: number; outCents: number; netCents: number
  /** Cobros por clientes: dinero recibido, distinto de ventas. */
  collectedCents: number
  byAccount: { caja: number; banco: number }
  /** Entradas/salidas ajenas a la operación (aportaciones, préstamos, retiros) */
  nonOperatingNetCents: number
}
export const NON_OPERATING: string[] = ['aportacion_dueno', 'retiro_dueno', 'prestamo_recibido', 'pago_prestamo', 'transferencia_entrada', 'transferencia_salida']
export const LEDGER_LABEL: Record<string, string> = {
  cobro_cliente: 'Cobros de clientes', reembolso_cliente: 'Reembolsos a clientes', pago_gasto: 'Pago de gastos', pago_proveedor: 'Pagos a proveedores',
  aportacion_dueno: 'Aportación del propietario', retiro_dueno: 'Retiro del propietario', prestamo_recibido: 'Préstamo recibido', pago_prestamo: 'Pago de préstamo',
  transferencia_entrada: 'Transferencia (entrada)', transferencia_salida: 'Transferencia (salida)', reembolso_proveedor: 'Reembolso de proveedor', otro_ingreso: 'Otro ingreso', otro_egreso: 'Otro egreso',
}
export function cashFlow(ledger: readonly LedgerEntry[], r: Range): CashFlow {
  const i = new Map<string, number>(), o = new Map<string, number>()
  const acc = { caja: 0, banco: 0 }
  let nonOp = 0
  for (const l of ledger) {
    if (!inRange(l.date, r)) continue
    const m = l.direction === 'in' ? i : o
    m.set(l.kind, (m.get(l.kind) ?? 0) + l.amountCents)
    const sign = l.direction === 'in' ? 1 : -1
    acc[l.account] += sign * l.amountCents
    if (NON_OPERATING.includes(l.kind) && !l.kind.startsWith('transferencia')) nonOp += sign * l.amountCents
  }
  const arr = (m: Map<string, number>) => [...m].map(([kind, cents]) => ({ kind, cents })).sort((a, b) => b.cents - a.cents)
  const inC = [...i.values()].reduce((a, b) => a + b, 0), outC = [...o.values()].reduce((a, b) => a + b, 0)
  return { range: r, inflows: arr(i), outflows: arr(o), inCents: inC, outCents: outC, netCents: inC - outC, collectedCents: (i.get('cobro_cliente') ?? 0) - (o.get('reembolso_cliente') ?? 0), byAccount: acc, nonOperatingNetCents: nonOp }
}

/* ───────────────────────── Series y comparativas ───────────────────────── */

export interface SeriesPoint { key: string; label: string; salesCents: number; costCents: number; grossCents: number; collectedCents: number; expensesCents: number }
export function series(sales: readonly Sale[], ledger: readonly LedgerEntry[], expenses: readonly Expense[], cats: readonly ExpenseCategory[], r: Range, bucket: Bucket = bucketFor(r)): SeriesPoint[] {
  const keys = bucketKeys(r, bucket)
  const pts = new Map<string, SeriesPoint>(keys.map((k) => [k, { key: k, label: labelFor(k, bucket), salesCents: 0, costCents: 0, grossCents: 0, collectedCents: 0, expensesCents: 0 }]))
  const get = (d: string) => pts.get(bucketKey(d, bucket))
  for (const s of sales) {
    if (s.status === 'cancelada') continue
    if (inRange(s.date, r)) { const p = get(s.date); if (p) { p.salesCents += s.netCents; p.costCents += s.costCents } }
    for (const rt of s.returns) if (inRange(rt.date, r)) { const p = get(rt.date); if (p) { p.salesCents -= rt.netCents; p.costCents -= rt.costRecoveredCents } }
  }
  for (const l of ledger) if (inRange(l.date, r) && (l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente')) { const p = get(l.date); if (p) p.collectedCents += l.direction === 'in' ? l.amountCents : -l.amountCents }
  const dc = new Set(cats.filter((c) => c.kind === 'mano_obra_directa').map((c) => c.id))
  for (const e of expenses) if (!e.cancelled && !dc.has(e.categoryId) && inRange(e.date, r)) { const p = get(e.date); if (p) p.expensesCents += e.amountCents }
  for (const p of pts.values()) p.grossCents = p.salesCents - p.costCents
  return keys.map((k) => pts.get(k)!)
}
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export function labelFor(k: string, b: Bucket): string {
  const m = MONTHS[+k.slice(5, 7) - 1]
  return b === 'mes' ? `${m} ${k.slice(2, 4)}` : `${+k.slice(8, 10)} ${m}`
}

export interface Delta { abs: number; pct: number | null }
/** Variación respecto al periodo anterior; sin base de comparación (anterior = 0) no se inventa un porcentaje. */
export function delta(cur: number, prev: number): Delta { return { abs: cur - prev, pct: prev === 0 ? null : ((cur - prev) / Math.abs(prev)) * 100 } }

/* ───────────────────────── Rentabilidad por dimensión ───────────────────────── */

export interface ProfitRow { key: string; label: string; netCents: number; costCents: number; profitCents: number; marginPct: number | null; qty: number; count: number; estimated: boolean }
function accumulate(rows: Map<string, ProfitRow>, key: string, label: string, net: number, cost: number, qty: number, est: boolean) {
  const r = rows.get(key) ?? { key, label, netCents: 0, costCents: 0, profitCents: 0, marginPct: null, qty: 0, count: 0, estimated: false }
  r.netCents += net; r.costCents += cost; r.qty += qty; r.count++; r.estimated ||= est
  rows.set(key, r)
}
const finish = (m: Map<string, ProfitRow>): ProfitRow[] => [...m.values()].map((r) => ({ ...r, profitCents: r.netCents - r.costCents, marginPct: marginPct(r.netCents, r.costCents) }))

export function profitBy(sales: readonly Sale[], r: Range, dim: 'producto' | 'servicio' | 'categoria' | 'mecanico' | 'tipo', ctx: { productCategory: (id?: string) => string; serviceCategory: (id?: string) => string; employeeName: (id?: string) => string }): ProfitRow[] {
  const m = new Map<string, ProfitRow>()
  for (const s of sales) {
    if (s.status === 'cancelada' || !inRange(s.date, r)) continue
    for (const i of s.items) {
      const retNet = s.returns.filter((x) => x.itemId === i.id).reduce((a, x) => a + x.netCents, 0)
      const retCost = s.returns.filter((x) => x.itemId === i.id).reduce((a, x) => a + x.costRecoveredCents, 0)
      const retQty = s.returns.filter((x) => x.itemId === i.id).reduce((a, x) => a + x.qty, 0)
      const net = i.netCents - retNet, cost = i.costCents - retCost, qty = i.qty - retQty
      if (dim === 'producto' && i.type !== 'servicio' && i.refId) accumulate(m, i.refId, i.description, net, cost, qty, i.costEstimated)
      else if (dim === 'servicio' && i.type === 'servicio') accumulate(m, i.refId ?? i.description, i.description, net, cost, qty, i.costEstimated)
      else if (dim === 'categoria') { const c = i.type === 'servicio' ? 'Servicio · ' + ctx.serviceCategory(i.refId) : (i.refId ? ctx.productCategory(i.refId) : 'Otros'); accumulate(m, c, c, net, cost, qty, i.costEstimated) }
      else if (dim === 'mecanico' && i.type === 'servicio') { const k = i.mechanicId ?? '—'; accumulate(m, k, ctx.employeeName(i.mechanicId), net, cost, i.hours, i.costEstimated) }
      else if (dim === 'tipo') accumulate(m, i.type, i.type, net, cost, qty, i.costEstimated)
    }
  }
  return finish(m)
}

/** Ventas con pérdida: venta cuyo costo directo supera su venta neta. */
export const lossSales = (sales: readonly Sale[], r: Range): Sale[] => sales.filter((s) => s.status === 'emitida' && inRange(s.date, r) && s.costCents > s.netCents)

/* ───────────────────────── Costos indirectos ───────────────────────── */

export const OVERHEAD_LABEL: Record<OverheadMethod, string> = {
  ninguno: 'Sin asignación (solo análisis global)', porcentaje_ventas: 'Por porcentaje de ventas', hora_productiva: 'Por hora productiva', por_orden: 'Por orden de trabajo (partes iguales)',
}
export const OVERHEAD_HELP: Record<OverheadMethod, string> = {
  ninguno: 'Los gastos indirectos se mantienen a nivel global y se restan en el resultado operativo.',
  porcentaje_ventas: 'Cada orden absorbe una parte del fondo de indirectos proporcional a su venta neta.',
  hora_productiva: 'Cada orden absorbe una parte proporcional a las horas de mano de obra que consumió.',
  por_orden: 'Cada orden absorbe la misma cantidad; el fondo se divide entre el número de órdenes del periodo.',
}
/**
 * Asigna el fondo de indirectos a las ventas del periodo. La asignación es ANALÍTICA: el resultado operativo global
 * ya resta el fondo completo una sola vez; la suma de lo asignado nunca supera el fondo (se reparte, no se duplica).
 */
export function allocateOverhead(poolCents: number, method: OverheadMethod, sales: readonly Sale[]): Map<string, number> {
  const out = new Map<string, number>()
  const live = sales.filter((s) => s.status === 'emitida')
  if (method === 'ninguno' || poolCents <= 0 || live.length === 0) return out
  const driver = (s: Sale) => method === 'porcentaje_ventas' ? Math.max(s.netCents, 0) : method === 'hora_productiva' ? s.laborHours : 1
  const total = live.reduce((a, s) => a + driver(s), 0)
  if (total <= 0) return out
  let assigned = 0
  live.forEach((s, idx) => {
    const share = idx === live.length - 1 ? poolCents - assigned : round((poolCents * driver(s)) / total)
    out.set(s.id, share); assigned += share
  })
  return out
}
export function overheadPool(expenses: readonly Expense[], cats: readonly ExpenseCategory[], r: Range): number {
  const c = new Map(cats.map((x) => [x.id, x]))
  return expenses.filter((e) => !e.cancelled && inRange(e.date, r) && c.get(e.categoryId)?.kind === 'operativo' && c.get(e.categoryId)?.allocate).reduce((a, e) => a + e.amountCents, 0)
}

/* ───────────────────────── Inventario, equilibrio, margen mínimo ───────────────────────── */

export const inventoryValue = (balances: readonly (Balance & { productId: string })[]): number => balances.reduce((a, b) => a + b.valueCents, 0)

/** Costos fijos y variables del periodo para el punto de equilibrio. Mano de obra: fija si hay nómina registrada; variable si solo hay costo imputado. */
export function breakEvenFromStatement(st: IncomeStatement): BreakEvenResult & { fixedCostsCents: number; variableCostPct: number } {
  const variableCents = st.cogs.partsCents + st.cogs.consumablesCents + st.cogs.externalCents + st.cogs.otherCents + (st.directPayrollCents > 0 ? 0 : st.cogs.laborCents)
  const fixed = st.opex.totalCents - st.idleLaborCents + st.directPayrollCents
  const varPct = st.netSalesCents > 0 ? (variableCents / st.netSalesCents) * 100 : 0
  const be = breakEven({ fixedCostsCents: fixed, variableCostPct: varPct, actualSalesCents: st.netSalesCents })
  return { ...be, fixedCostsCents: fixed, variableCostPct: varPct }
}

/** Cuentas por cobrar a una fecha de corte: ventas hasta esa fecha menos devoluciones y cobros hasta esa fecha. */
export function receivablesAt(sales: readonly Sale[], ledger: readonly LedgerEntry[], date: string): number {
  let total = 0
  for (const s of sales) {
    if (s.status === 'cancelada' || s.date > date) continue
    let bal = s.totalCents - s.returns.filter((r) => r.date <= date).reduce((a, r) => a + r.netCents + r.taxCents, 0)
    for (const l of ledger) {
      if (l.date > date || (l.kind !== 'cobro_cliente' && l.kind !== 'reembolso_cliente')) continue
      if (l.saleId === s.id || (!l.saleId && s.workOrderId && l.workOrderId === s.workOrderId)) bal -= l.direction === 'in' ? l.amountCents : -l.amountCents
    }
    if (bal > 0) total += bal
  }
  return total
}
/** Valor del inventario a una fecha: suma acumulada de los movimientos (con signo) hasta esa fecha. */
export const inventoryValueAt = (movements: readonly { date: string; totalCostCents: number }[], date: string): number => movements.reduce((a, m) => (m.date <= date ? a + m.totalCostCents : a), 0)

export const itemMargin = (i: Pick<SaleItem, 'netCents' | 'costCents'>): number | null => marginPct(i.netCents, i.costCents)
export const daysBack = (today: string, n: number): string => addDays(today, -n)
export type { Settings }
