import { bucketFor, bucketKey, inRange, type Range } from './dates'
import {
  agingTotals, AGING_LABEL, AGING_ORDER, allocateOverhead, breakEvenFromStatement, cashFlow, incomeStatement, inventoryValue, LEDGER_LABEL, lossSales, overheadPool, payables, profitBy, receivables, saleBalance, series,
} from './finance'
import { marginPct, markupPct } from './pricing'
import { priceAlert, taxRateOf } from './alerts'
import { billableItems } from './orders'
import type {
  Customer, Employee, Expense, InventoryBalance, InventoryMovement, LedgerEntry, Product, PurchaseReceipt, Sale, ServiceDef, Settings, Supplier, Vehicle, WorkOrder,
} from './types'

export interface ReportData {
  sales: Sale[]; expenses: Expense[]; ledger: LedgerEntry[]; receipts: PurchaseReceipt[]; products: Product[]; balances: InventoryBalance[]
  movements: InventoryMovement[]; orders: WorkOrder[]; customers: Customer[]; vehicles: Vehicle[]; employees: Employee[]; suppliers: Supplier[]; services: ServiceDef[]; settings: Settings
}
export type ColKind = 'text' | 'money' | 'num' | 'pct' | 'date'
export interface Col { key: string; label: string; kind: ColKind }
export type Cell = string | number | null
export interface ReportResult {
  id: string; title: string; definition: string; source: string; range: Range | null; filters: string[]; generatedAt: string
  warnings: string[]; columns: Col[]; rows: Cell[][]; totals?: Cell[]
  /** Informe que expone costos o márgenes: requiere permiso de costos. */
  sensitive: boolean
}
export interface ReportDef { id: string; title: string; group: string; ranged: boolean; sensitive: boolean; description: string; run: (d: ReportData, r: Range, now: string) => ReportResult }

const c = (key: string, label: string, kind: ColKind = 'text'): Col => ({ key, label, kind })
const sum = (rows: Cell[][], i: number) => rows.reduce((a, r) => a + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0)

function mk(id: string, title: string, definition: string, source: string, r: Range | null, columns: Col[], rows: Cell[][], now: string, o: Partial<ReportResult> = {}): ReportResult {
  return { id, title, definition, source, range: r, filters: [], generatedAt: now, warnings: [], columns, rows, sensitive: false, ...o }
}
const pname = (d: ReportData) => (id?: string) => d.products.find((p) => p.id === id)?.category ?? 'Otros'
const sname = (d: ReportData) => (id?: string) => d.services.find((s) => s.id === id)?.category ?? 'Otros'
const ename = (d: ReportData) => (id?: string) => d.employees.find((e) => e.id === id)?.name ?? 'Sin asignar'
const cats = (d: ReportData) => d.settings.expenseCategories
const warnEst = (st: { estimatedCostLines: number }) => (st.estimatedCostLines ? [`${st.estimatedCostLines} partida(s) con costo estimado (sin tiempos reales).`] : [])
const SRC_SALES = 'Ventas emitidas (partidas con costo congelado al emitir), devoluciones y gastos registrados.'

export const REPORTS: ReportDef[] = [
  {
    id: 'ventas_periodo', title: 'Ventas por periodo', group: 'Ventas', ranged: true, sensitive: true, description: 'Ventas netas, costo y utilidad por día/semana/mes.',
    run: (d, r, now) => {
      const pts = series(d.sales, d.ledger, d.expenses, cats(d), r)
      const rows = pts.map((p) => [p.label, p.salesCents, p.costCents, p.grossCents, marginPct(p.salesCents, p.costCents)] as Cell[])
      const st = incomeStatement(d.sales, d.expenses, cats(d), r)
      return mk('ventas_periodo', 'Ventas por periodo', 'Venta neta = antes de impuestos, menos devoluciones. Costo = costo directo congelado de cada partida.', SRC_SALES, r,
        [c('p', 'Periodo'), c('v', 'Ventas netas', 'money'), c('c', 'Costo directo', 'money'), c('u', 'Utilidad bruta', 'money'), c('m', 'Margen bruto', 'pct')], rows, now, { totals: ['Total', st.netSalesCents, st.cogs.totalCents, st.grossProfitCents, st.grossMarginPct], warnings: warnEst(st), sensitive: true })
    },
  },
  {
    id: 'ventas_servicio', title: 'Ventas por tipo de servicio', group: 'Ventas', ranged: true, sensitive: false, description: 'Ventas netas por servicio de mano de obra.',
    run: (d, r, now) => {
      const rows = profitBy(d.sales, r, 'servicio', { productCategory: pname(d), serviceCategory: sname(d), employeeName: ename(d) }).sort((a, b) => b.netCents - a.netCents).map((x) => [x.label, x.qty, x.netCents] as Cell[])
      return mk('ventas_servicio', 'Ventas por tipo de servicio', 'Venta neta de partidas de mano de obra, menos devoluciones.', 'Partidas de servicio de ventas emitidas.', r, [c('s', 'Servicio'), c('q', 'Cantidad', 'num'), c('v', 'Ventas netas', 'money')], rows, now, { totals: ['Total', sum(rows, 1), sum(rows, 2)] })
    },
  },
  {
    id: 'rent_orden', title: 'Rentabilidad por orden de trabajo', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Venta, costo, utilidad y margen de cada orden.',
    run: (d, r, now) => {
      const live = d.sales.filter((s) => s.status === 'emitida' && inRange(s.date, r))
      const pool = overheadPool(d.expenses, cats(d), r), alloc = allocateOverhead(pool, d.settings.overheadMethod, live)
      const rows = live.map((s) => {
        const est = s.items.some((i) => i.costEstimated)
        const ind = alloc.get(s.id) ?? 0
        return [s.folio + (est ? ' *' : ''), s.customerName, s.date, s.netCents, s.costCents, s.netCents - s.costCents, marginPct(s.netCents, s.costCents), ind, s.netCents - s.costCents - ind] as Cell[]
      })
      return mk('rent_orden', 'Rentabilidad por orden de trabajo', 'Utilidad = venta neta − costo directo. Los indirectos son una asignación analítica (método configurado); el resultado operativo global resta el fondo una sola vez.', SRC_SALES, r,
        [c('f', 'Folio'), c('c', 'Cliente'), c('d', 'Fecha', 'date'), c('v', 'Venta neta', 'money'), c('k', 'Costo directo', 'money'), c('u', 'Utilidad bruta', 'money'), c('m', 'Margen', 'pct'), c('i', 'Indirectos asignados', 'money'), c('r', 'Después de indirectos', 'money')], rows, now,
        { totals: ['Total', '', '', sum(rows, 3), sum(rows, 4), sum(rows, 5), marginPct(sum(rows, 3), sum(rows, 4)), sum(rows, 7), sum(rows, 8)], warnings: ['* contiene partidas con costo estimado (no observado).'].filter(() => rows.some((x) => String(x[0]).endsWith('*'))), sensitive: true, filters: [`Indirectos: ${d.settings.overheadMethod}`] })
    },
  },
  {
    id: 'rent_refaccion', title: 'Rentabilidad por refacción', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Unidades, venta, costo, utilidad, margen y markup por producto.',
    run: (d, r, now) => {
      const rows = profitBy(d.sales, r, 'producto', { productCategory: pname(d), serviceCategory: sname(d), employeeName: ename(d) }).sort((a, b) => b.profitCents - a.profitCents).map((x) => [x.label, x.qty, x.netCents, x.costCents, x.profitCents, x.marginPct, markupPct(x.netCents, x.costCents)] as Cell[])
      return mk('rent_refaccion', 'Rentabilidad por refacción', 'Margen = utilidad ÷ venta neta; markup = utilidad ÷ costo. Costo = costo de salida real de inventario.', 'Partidas de producto de ventas emitidas.', r,
        [c('p', 'Producto'), c('q', 'Cantidad', 'num'), c('v', 'Venta neta', 'money'), c('k', 'Costo', 'money'), c('u', 'Utilidad', 'money'), c('m', 'Margen', 'pct'), c('mk', 'Markup', 'pct')], rows, now, { totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), marginPct(sum(rows, 2), sum(rows, 3)), markupPct(sum(rows, 2), sum(rows, 3))], sensitive: true })
    },
  },
  {
    id: 'rent_categoria', title: 'Rentabilidad por categoría', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Margen por categoría de refacción o servicio.',
    run: (d, r, now) => {
      const rows = profitBy(d.sales, r, 'categoria', { productCategory: pname(d), serviceCategory: sname(d), employeeName: ename(d) }).sort((a, b) => b.profitCents - a.profitCents).map((x) => [x.label, x.netCents, x.costCents, x.profitCents, x.marginPct] as Cell[])
      return mk('rent_categoria', 'Rentabilidad por categoría', 'Agrupa partidas vendidas por categoría del catálogo.', 'Ventas emitidas + catálogo.', r, [c('k', 'Categoría'), c('v', 'Venta neta', 'money'), c('c', 'Costo', 'money'), c('u', 'Utilidad', 'money'), c('m', 'Margen', 'pct')], rows, now, { totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), marginPct(sum(rows, 1), sum(rows, 2))], sensitive: true })
    },
  },
  {
    id: 'rent_mecanico', title: 'Rentabilidad por mecánico', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Mano de obra vendida y su costo por mecánico.',
    run: (d, r, now) => {
      const rows = profitBy(d.sales, r, 'mecanico', { productCategory: pname(d), serviceCategory: sname(d), employeeName: ename(d) }).sort((a, b) => b.netCents - a.netCents).map((x) => [x.label, x.qty, x.netCents, x.costCents, x.profitCents, x.marginPct] as Cell[])
      return mk('rent_mecanico', 'Rentabilidad por mecánico', 'Ventas de mano de obra asociadas al mecánico asignado. Ventas atribuidas ≠ beneficio generado por la persona: depende del tipo de servicio y de la calidad.', 'Partidas de servicio de ventas emitidas.', r,
        [c('m', 'Mecánico'), c('h', 'Horas', 'num'), c('v', 'Mano de obra vendida', 'money'), c('c', 'Costo laboral', 'money'), c('u', 'Utilidad', 'money'), c('p', 'Margen', 'pct')], rows, now, { sensitive: true })
    },
  },
  {
    id: 'utilidad_bruta', title: 'Utilidad bruta por periodo', group: 'Ventas', ranged: true, sensitive: true, description: 'Evolución de la utilidad bruta.',
    run: (d, r, now) => {
      const pts = series(d.sales, d.ledger, d.expenses, cats(d), r)
      return mk('utilidad_bruta', 'Utilidad bruta por periodo', 'Utilidad bruta = ventas netas − costo directo.', SRC_SALES, r, [c('p', 'Periodo'), c('g', 'Utilidad bruta', 'money'), c('m', 'Margen bruto', 'pct')], pts.map((p) => [p.label, p.grossCents, marginPct(p.salesCents, p.costCents)] as Cell[]), now, { sensitive: true })
    },
  },
  {
    id: 'gastos_categoria', title: 'Gastos por categoría', group: 'Finanzas', ranged: true, sensitive: false, description: 'Gastos devengados por categoría.',
    run: (d, r, now) => {
      const m = new Map<string, number>()
      const cm = new Map(cats(d).map((x) => [x.id, x.name]))
      for (const e of d.expenses) if (!e.cancelled && inRange(e.date, r)) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amountCents)
      const total = [...m.values()].reduce((a, b) => a + b, 0)
      const rows = [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => [cm.get(k) ?? 'Sin categoría', v, total ? (v / total) * 100 : null] as Cell[])
      return mk('gastos_categoria', 'Gastos por categoría', 'Gastos por fecha del gasto (devengado), sin IVA acreditable. No incluye compras de inventario (son activo hasta que se consumen).', 'Gastos registrados.', r, [c('k', 'Categoría'), c('v', 'Importe', 'money'), c('p', '% del total', 'pct')], rows, now, { totals: ['Total', total, 100] })
    },
  },
  {
    id: 'estado_resultados', title: 'Estado de resultados gerencial', group: 'Finanzas', ranged: true, sensitive: true, description: 'Ventas, costo, utilidad bruta, gastos y utilidad operativa.',
    run: (d, r, now) => {
      const st = incomeStatement(d.sales, d.expenses, cats(d), r)
      const rows: Cell[][] = [
        ['Ventas brutas (antes de impuestos)', st.grossSalesCents], ['(−) Devoluciones', -st.returnsCents], ['Ventas netas', st.netSalesCents],
        ['(−) Refacciones', -st.cogs.partsCents], ['(−) Consumibles y otros', -(st.cogs.consumablesCents + st.cogs.otherCents)], ['(−) Servicios externos', -st.cogs.externalCents], ['(−) Mano de obra imputada', -st.cogs.laborCents],
        ['Utilidad bruta', st.grossProfitCents],
        ...st.opex.byCategory.map((x) => [`(−) ${x.name}`, -x.cents] as Cell[]),
        ...(st.idleLaborCents ? ([['(−) Capacidad ociosa de mano de obra (nómina − imputado)', -st.idleLaborCents]] as Cell[][]) : []),
        ['Utilidad operativa estimada', st.operatingProfitCents],
      ]
      return mk('estado_resultados', 'Estado de resultados gerencial', 'Reconocimiento por devengado: ventas en su fecha de emisión, gastos en su fecha. La nómina de mecánicos no se resta dos veces: el costo laboral imputado va en costo de ventas y solo se resta la parte no absorbida. No es un estado financiero fiscal ni sustituye contabilidad.', SRC_SALES, r, [c('c', 'Concepto'), c('v', 'Importe', 'money')], rows, now, { warnings: st.warnings, sensitive: true })
    },
  },
  {
    id: 'flujo_efectivo', title: 'Flujo de efectivo', group: 'Finanzas', ranged: true, sensitive: false, description: 'Entradas y salidas reales de dinero.',
    run: (d, r, now) => {
      const cf = cashFlow(d.ledger, r)
      const rows: Cell[][] = [...cf.inflows.map((x) => ['Entrada · ' + (LEDGER_LABEL[x.kind] ?? x.kind), x.cents] as Cell[]), ...cf.outflows.map((x) => ['Salida · ' + (LEDGER_LABEL[x.kind] ?? x.kind), -x.cents] as Cell[])]
      return mk('flujo_efectivo', 'Flujo de efectivo', 'Solo dinero efectivamente cobrado o pagado, por fecha del movimiento. Distinto de ventas y de utilidad. Aportaciones, préstamos y retiros no son ventas ni gastos.', 'Movimientos de caja/banco.', r, [c('c', 'Concepto'), c('v', 'Importe', 'money')], rows, now, { totals: ['Flujo neto', cf.netCents] })
    },
  },
  {
    id: 'cxc', title: 'Cuentas por cobrar', group: 'Cobranza', ranged: false, sensitive: false, description: 'Saldos de clientes por antigüedad.',
    run: (d, r, now) => {
      const rows = receivables(d.sales, d.ledger, r.to)
      const t = agingTotals(rows)
      return mk('cxc', 'Cuentas por cobrar', 'Saldo = total de la venta − devoluciones − cobros netos. Antigüedad según vencimiento al corte.', 'Ventas y cobros.', { from: r.to, to: r.to }, [c('c', 'Cliente'), c('f', 'Folio'), c('d', 'Vence', 'date'), c('l', 'Días de atraso', 'num'), c('t', 'Total', 'money'), c('p', 'Cobrado', 'money'), c('s', 'Saldo', 'money'), c('b', 'Antigüedad')],
        rows.map((x) => [x.party, x.folio, x.dueDate, x.daysLate, x.totalCents, x.paidCents, x.balanceCents, AGING_LABEL[x.bucket]] as Cell[]), now, { filters: [`Corte: ${r.to}`, ...AGING_ORDER.map((k) => `${AGING_LABEL[k]}: ${(t[k] / 100).toFixed(2)}`)], totals: ['Total', '', '', '', sum(rows.map((x) => [x.totalCents]), 0), sum(rows.map((x) => [x.paidCents]), 0), rows.reduce((a, x) => a + x.balanceCents, 0), ''] })
    },
  },
  {
    id: 'cxp', title: 'Cuentas por pagar', group: 'Cobranza', ranged: false, sensitive: false, description: 'Obligaciones con proveedores y gastos pendientes.',
    run: (d, r, now) => {
      const sn = (id?: string) => d.suppliers.find((s) => s.id === id)?.name ?? '—'
      const rows = payables(d.receipts, d.expenses, d.ledger, sn, r.to)
      return mk('cxp', 'Cuentas por pagar', 'Saldo = total de la recepción/gasto − pagos registrados. Una compra recibida sin pago registrado sigue por pagar.', 'Recepciones de compra, gastos y pagos.', { from: r.to, to: r.to }, [c('p', 'Proveedor / concepto'), c('k', 'Tipo'), c('f', 'Documento'), c('d', 'Vence', 'date'), c('l', 'Días de atraso', 'num'), c('s', 'Saldo', 'money'), c('b', 'Antigüedad')],
        rows.map((x) => [x.party, x.kind, x.folio, x.dueDate, x.daysLate, x.balanceCents, AGING_LABEL[x.bucket]] as Cell[]), now, { totals: ['Total', '', '', '', '', rows.reduce((a, x) => a + x.balanceCents, 0), ''] })
    },
  },
  {
    id: 'rotacion', title: 'Rotación de inventario', group: 'Inventario', ranged: true, sensitive: true, description: 'Salidas, valor y días sin movimiento por producto.',
    run: (d, r, now) => {
      const rows = d.products.filter((p) => p.active).map((p) => {
        const out = d.movements.filter((m) => m.productId === p.id && m.qty < 0 && ['venta', 'consumo_orden'].includes(m.type) && inRange(m.date, r))
        const qty = -out.reduce((a, m) => a + m.qty, 0), cost = -out.reduce((a, m) => a + m.totalCostCents, 0)
        const val = d.balances.filter((b) => b.productId === p.id).reduce((a, b) => a + b.valueCents, 0)
        const last = d.movements.filter((m) => m.productId === p.id).map((m) => m.date).sort().pop() ?? null
        return [p.name, qty, cost, val, val > 0 ? cost / val : null, last] as Cell[]
      }).sort((a, b) => Number(b[2]) - Number(a[2]))
      return mk('rotacion', 'Rotación de inventario', 'Rotación = costo de lo consumido/vendido en el periodo ÷ valor actual del inventario.', 'Movimientos y saldos de inventario.', r, [c('p', 'Producto'), c('q', 'Salidas', 'num'), c('c', 'Costo de salidas', 'money'), c('v', 'Valor en inventario', 'money'), c('r', 'Rotación (veces)', 'num'), c('u', 'Último movimiento', 'date')], rows, now, { sensitive: true })
    },
  },
  {
    id: 'valor_inventario', title: 'Valor del inventario', group: 'Inventario', ranged: false, sensitive: true, description: 'Existencias y costo promedio vigentes.',
    run: (d, r, now) => {
      const rows = d.products.filter((p) => p.active).map((p) => {
        const bs = d.balances.filter((b) => b.productId === p.id), q = bs.reduce((a, b) => a + b.qty, 0), v = bs.reduce((a, b) => a + b.valueCents, 0)
        return [p.sku, p.name, q, q > 0 ? v / q : null, v] as Cell[]
      }).sort((a, b) => Number(b[4]) - Number(a[4]))
      return mk('valor_inventario', 'Valor del inventario', 'Costo promedio ponderado móvil: valor = costo acumulado de las existencias.', 'Saldos de inventario.', { from: r.to, to: r.to }, [c('s', 'SKU'), c('p', 'Producto'), c('q', 'Existencias', 'num'), c('c', 'Costo promedio', 'money'), c('v', 'Valor', 'money')], rows, now, { totals: ['Total', '', '', '', inventoryValue(d.balances)], sensitive: true })
    },
  },
  {
    id: 'compras_proveedor', title: 'Compras por proveedor', group: 'Compras', ranged: true, sensitive: false, description: 'Recepciones y saldo por proveedor.',
    run: (d, r, now) => {
      const m = new Map<string, { n: number; total: number }>()
      for (const x of d.receipts) if (inRange(x.date, r)) { const c0 = m.get(x.supplierId) ?? { n: 0, total: 0 }; m.set(x.supplierId, { n: c0.n + 1, total: c0.total + x.totalCents }) }
      const rows = [...m].map(([id, v]) => [d.suppliers.find((s) => s.id === id)?.name ?? '—', v.n, v.total] as Cell[]).sort((a, b) => Number(b[2]) - Number(a[2]))
      return mk('compras_proveedor', 'Compras por proveedor', 'Total de recepciones (con flete e IVA) por proveedor.', 'Recepciones de compra.', r, [c('p', 'Proveedor'), c('n', 'Recepciones', 'num'), c('t', 'Total', 'money')], rows, now, { totals: ['Total', sum(rows, 1), sum(rows, 2)] })
    },
  },
  {
    id: 'descuentos', title: 'Descuentos concedidos', group: 'Ventas', ranged: true, sensitive: false, description: 'Partidas vendidas con descuento.',
    run: (d, r, now) => {
      const rows: Cell[][] = []
      for (const s of d.sales) if (s.status === 'emitida' && inRange(s.date, r)) for (const i of s.items) if (i.discountCents > 0) rows.push([s.folio, s.date, i.description, i.discountCents, i.netCents])
      return mk('descuentos', 'Descuentos concedidos', 'Descuento comercial por partida, en la base de precio de captura.', 'Partidas de ventas emitidas.', r, [c('f', 'Folio'), c('d', 'Fecha', 'date'), c('p', 'Partida'), c('x', 'Descuento', 'money'), c('v', 'Venta neta de la partida', 'money')], rows, now, { totals: ['Total', '', '', sum(rows, 3), sum(rows, 4)] })
    },
  },
  {
    id: 'perdidas', title: 'Servicios y ventas con pérdidas', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Ventas cuyo costo directo supera su venta.',
    run: (d, r, now) => {
      const rows = lossSales(d.sales, r).map((s) => [s.folio, s.customerName, s.date, s.netCents, s.costCents, s.netCents - s.costCents] as Cell[])
      return mk('perdidas', 'Servicios y ventas con pérdidas', 'Ventas donde costo directo > venta neta (incluye garantías sin cobro).', SRC_SALES, r, [c('f', 'Folio'), c('c', 'Cliente'), c('d', 'Fecha', 'date'), c('v', 'Venta neta', 'money'), c('k', 'Costo directo', 'money'), c('u', 'Resultado', 'money')], rows, now, { totals: ['Total', '', '', sum(rows, 3), sum(rows, 4), sum(rows, 5)], sensitive: true })
    },
  },
  {
    id: 'margen_bajo', title: 'Productos con margen inferior al objetivo', group: 'Inventario', ranged: false, sensitive: true, description: 'Precio vigente contra costo promedio actual.',
    run: (d, r, now) => {
      const rows: Cell[][] = []
      for (const p of d.products.filter((x) => x.active)) {
        const bs = d.balances.filter((b) => b.productId === p.id), q = bs.reduce((a, b) => a + b.qty, 0), v = bs.reduce((a, b) => a + b.valueCents, 0)
        const cost = q > 0 ? v / q : p.lastPurchaseCost ?? 0
        const a = priceAlert(p.priceCents, cost, taxRateOf(d.settings, p.taxId), d.settings, p.minMarginPct)
        if (a.kind === 'bajo_costo' || a.kind === 'margen_bajo') rows.push([p.name, cost, a.netPriceCents, a.marginPct, a.minMarginPct, a.kind === 'bajo_costo' ? 'Bajo costo' : 'Margen bajo'])
      }
      return mk('margen_bajo', 'Productos con margen inferior al objetivo', 'Margen = (precio neto − costo promedio) ÷ precio neto, contra el margen mínimo configurado.', 'Catálogo y saldos de inventario.', { from: r.to, to: r.to }, [c('p', 'Producto'), c('c', 'Costo', 'money'), c('v', 'Precio neto', 'money'), c('m', 'Margen', 'pct'), c('o', 'Mínimo', 'pct'), c('a', 'Alerta')], rows, now, { sensitive: true })
    },
  },
  {
    id: 'productividad', title: 'Productividad de mano de obra', group: 'Personal', ranged: true, sensitive: false, description: 'Horas trabajadas, facturadas y eficiencia por mecánico.',
    run: (d, r, now) => {
      const m = new Map<string, { worked: number; billed: number; orders: Set<string> }>()
      const get = (id: string) => m.get(id) ?? (m.set(id, { worked: 0, billed: 0, orders: new Set() }), m.get(id)!)
      for (const o of d.orders) {
        for (const t of o.timeEntries) if (t.kind === 'trabajo' && t.endAt && inRange(t.endAt.slice(0, 10), r)) { const g = get(t.employeeId); g.worked += t.minutes / 60; g.orders.add(o.id) }
        if (o.status === 'entregada' && o.deliveredAt && inRange(o.deliveredAt.slice(0, 10), r) && !o.isWarranty) for (const i of billableItems(o)) if (i.type === 'servicio') { const g = get(i.mechanicId ?? o.mechanicId ?? ''); g.billed += i.stdHours * i.qty; g.orders.add(o.id) }
      }
      const rows = [...m].map(([id, v]) => [d.employees.find((e) => e.id === id)?.name ?? 'Sin asignar', v.worked, v.billed, v.worked > 0 ? (v.billed / v.worked) * 100 : null, v.orders.size] as Cell[])
      return mk('productividad', 'Productividad de mano de obra', 'Horas trabajadas = tramos registrados. Horas facturadas = tiempo estándar de los servicios entregados. Eficiencia = facturadas ÷ trabajadas. Mide tiempo, no calidad ni tipo de servicio.', 'Tiempos de órdenes y servicios entregados.', r, [c('m', 'Mecánico'), c('w', 'Horas trabajadas', 'num'), c('b', 'Horas facturadas (estándar)', 'num'), c('e', 'Eficiencia', 'pct'), c('o', 'Órdenes', 'num')], rows, now)
    },
  },
  {
    id: 'equilibrio', title: 'Punto de equilibrio', group: 'Finanzas', ranged: true, sensitive: true, description: 'Ventas necesarias para cubrir costos, con los datos reales del periodo.',
    run: (d, r, now) => {
      const st = incomeStatement(d.sales, d.expenses, cats(d), r), be = breakEvenFromStatement(st)
      const rows: Cell[][] = [['Costos fijos del periodo', be.fixedCostsCents], ['Costos variables (% de ventas)', be.variableCostPct], ['Margen de contribución (%)', be.contributionMarginPct], ['Punto de equilibrio en ventas', be.breakEvenSalesCents], ['Ventas netas reales', st.netSalesCents], ['Diferencia vs. equilibrio', be.gapCents]]
      return mk('equilibrio', 'Punto de equilibrio', 'Equilibrio = costos fijos ÷ margen de contribución. Fijos: gastos operativos + nómina de mecánicos. Variables: refacciones, consumibles, externos. Es una estimación con la estructura del periodo.', SRC_SALES, r, [c('c', 'Concepto'), c('v', 'Valor', 'num')], rows.map((x) => [x[0], typeof x[1] === 'number' ? Math.round(x[1] * 100) / 100 : x[1]]), now, { warnings: [be.message], sensitive: true })
    },
  },
  {
    id: 'ticket', title: 'Ticket promedio', group: 'Clientes', ranged: true, sensitive: false, description: 'Venta neta promedio por venta.',
    run: (d, r, now) => {
      const b = bucketFor(r), m = new Map<string, { n: number; v: number }>()
      for (const s of d.sales) if (s.status === 'emitida' && inRange(s.date, r)) { const k = bucketKey(s.date, b), x = m.get(k) ?? { n: 0, v: 0 }; m.set(k, { n: x.n + 1, v: x.v + s.netCents }) }
      const rows = [...m].sort().map(([k, v]) => [k, v.n, v.v, Math.round(v.v / v.n)] as Cell[])
      const n = sum(rows, 1), v = sum(rows, 2)
      return mk('ticket', 'Ticket promedio', 'Venta neta ÷ número de ventas emitidas.', 'Ventas emitidas.', r, [c('p', 'Periodo', 'date'), c('n', 'Ventas', 'num'), c('v', 'Venta neta', 'money'), c('t', 'Ticket promedio', 'money')], rows, now, { totals: ['Total', n, v, n ? Math.round(v / n) : null] })
    },
  },
  {
    id: 'recurrentes', title: 'Clientes recurrentes', group: 'Clientes', ranged: true, sensitive: false, description: 'Clientes con más de una visita.',
    run: (d, r, now) => {
      const m = new Map<string, { n: number; v: number; last: string }>()
      for (const s of d.sales) if (s.status === 'emitida' && s.customerId && inRange(s.date, r)) { const x = m.get(s.customerId) ?? { n: 0, v: 0, last: '' }; m.set(s.customerId, { n: x.n + 1, v: x.v + s.netCents, last: s.date > x.last ? s.date : x.last }) }
      const rows = [...m].filter(([, v]) => v.n >= 2).map(([id, v]) => [d.customers.find((x) => x.id === id)?.name ?? '—', v.n, v.v, v.last] as Cell[]).sort((a, b) => Number(b[1]) - Number(a[1]))
      return mk('recurrentes', 'Clientes recurrentes', 'Clientes con 2 o más ventas en el periodo.', 'Ventas emitidas.', r, [c('c', 'Cliente'), c('n', 'Visitas', 'num'), c('v', 'Venta neta', 'money'), c('u', 'Última visita', 'date')], rows, now)
    },
  },
  {
    id: 'vehiculos', title: 'Vehículos atendidos', group: 'Clientes', ranged: true, sensitive: false, description: 'Vehículos que ingresaron al taller.',
    run: (d, r, now) => {
      const m = new Map<string, number>()
      for (const o of d.orders) if (o.status !== 'cancelada' && inRange(o.receivedAt.slice(0, 10), r)) m.set(o.vehicleId, (m.get(o.vehicleId) ?? 0) + 1)
      const rows = [...m].map(([id, n]) => { const v = d.vehicles.find((x) => x.id === id); return [v ? `${v.make} ${v.model} ${v.year ?? ''}`.trim() : '—', v?.plate ?? '', d.customers.find((c0) => c0.id === v?.customerId)?.name ?? '', n] as Cell[] }).sort((a, b) => Number(b[3]) - Number(a[3]))
      return mk('vehiculos', 'Vehículos atendidos', 'Vehículos con al menos una orden recibida (no cancelada) en el periodo.', 'Órdenes de trabajo.', r, [c('v', 'Vehículo'), c('p', 'Placas'), c('c', 'Cliente'), c('n', 'Órdenes', 'num')], rows, now, { totals: ['Total', '', '', sum(rows, 3)] })
    },
  },
  {
    id: 'garantias', title: 'Trabajos en garantía y retrabajos', group: 'Rentabilidad', ranged: true, sensitive: true, description: 'Órdenes de garantía y su costo.',
    run: (d, r, now) => {
      const rows: Cell[][] = []
      for (const o of d.orders) if (o.isWarranty && inRange(o.receivedAt.slice(0, 10), r)) {
        const s = d.sales.find((x) => x.id === o.saleId), orig = d.orders.find((x) => x.id === o.warrantyOfOrderId)
        rows.push([o.folio, orig?.folio ?? '', o.complaint, o.status, s ? s.costCents : null])
      }
      return mk('garantias', 'Trabajos en garantía y retrabajos', 'Órdenes de garantía: sin cobro al cliente; su costo reduce la utilidad.', 'Órdenes de garantía y sus ventas.', r, [c('o', 'Orden'), c('g', 'Original'), c('m', 'Motivo'), c('e', 'Estado'), c('k', 'Costo', 'money')], rows, now, { totals: ['Total', '', '', '', sum(rows, 4)], sensitive: true })
    },
  },
]

export const reportById = (id: string) => REPORTS.find((r) => r.id === id)
export { saleBalance }
