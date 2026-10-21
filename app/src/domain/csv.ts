import { formatMXN } from './money'
import type { Cell, ReportResult } from './reports'
import type { ReportData } from './reports'
import { saleBalance, salePaid } from './finance'
import { STATUS_LABEL } from './orders'

const BOM = '﻿'

export function cell(v: unknown, sep: string): string {
  let s = v === null || v === undefined ? '' : String(v)
  // Evita inyección de fórmulas en Excel/Sheets.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = "'" + s
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
/** UTF-8 con BOM (Excel muestra bien los acentos). Separador «,» o «;». */
export function toCsv(headers: string[], rows: unknown[][], sep: ',' | ';' = ','): string {
  return BOM + [headers, ...rows].map((r) => r.map((c) => cell(c, sep)).join(sep)).join('\r\n') + '\r\n'
}
export function rowsToCsv(rows: unknown[][], sep: ',' | ';' = ','): string {
  return BOM + rows.map((r) => r.map((c) => cell(c, sep)).join(sep)).join('\r\n') + '\r\n'
}

const pesos = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2))

/** Valor de celda legible para pantalla. */
export function fmtCell(v: Cell, kind: string): string {
  if (v === null || v === undefined || v === '') return kind === 'pct' || kind === 'money' || kind === 'num' ? 'n/c' : ''
  if (typeof v === 'string') return v
  if (kind === 'money') return formatMXN(v)
  if (kind === 'pct') return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(v) + ' %'
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(v)
}

/** CSV de un reporte, con encabezado de contexto: periodo, filtros, definición y fuente. */
export function reportToCsv(r: ReportResult, sep: ',' | ';' = ','): string {
  const meta: unknown[][] = [
    [r.title], ['Periodo', r.range ? `${r.range.from} a ${r.range.to}` : 'Al corte'], ['Filtros', r.filters.join(' | ') || 'Ninguno'], ['Generado', r.generatedAt],
    ['Definición', r.definition], ['Fuente', r.source], ...(r.warnings.length ? [['Advertencias', r.warnings.join(' | ')]] : []), [],
  ]
  const body = r.rows.map((row) => row.map((v, i) => (typeof v === 'number' ? (r.columns[i]?.kind === 'money' ? pesos(v) : r.columns[i]?.kind === 'pct' || r.columns[i]?.kind === 'num' ? Number(v.toFixed(2)) : v) : v)))
  const tot = r.totals ? [r.totals.map((v, i) => (typeof v === 'number' ? (r.columns[i]?.kind === 'money' ? pesos(v) : Number(v.toFixed(2))) : v))] : []
  return rowsToCsv([...meta, r.columns.map((c) => c.label), ...body, ...tot], sep)
}

export interface ExportOpts { costs: boolean; salaries: boolean }
/** Exportación de datos del taller. Respeta permisos: sin «costos.ver» no salen costos ni márgenes; sin «personal.salarios» no sale información salarial. */
export function exportCsvs(d: ReportData, o: ExportOpts, sep: ',' | ';' = ','): Record<string, string> {
  const cust = new Map(d.customers.map((c) => [c.id, c.name]))
  const veh = new Map(d.vehicles.map((v) => [v.id, v]))
  const out: Record<string, string> = {
    'clientes.csv': toCsv(['id', 'nombre', 'telefono', 'correo', 'rfc', 'activo'], d.customers.map((c) => [c.id, c.name, c.phone, c.email, c.taxId, c.active ? 'sí' : 'no']), sep),
    'vehiculos.csv': toCsv(['id', 'cliente_id', 'cliente', 'marca', 'modelo', 'anio', 'placas', 'vin', 'km'], d.vehicles.map((v) => [v.id, v.customerId, cust.get(v.customerId), v.make, v.model, v.year, v.plate, v.vin, v.km]), sep),
    'ordenes.csv': toCsv(['id', 'folio', 'estado', 'cliente', 'placas', 'recibida', 'entregada', 'garantia'], d.orders.map((x) => [x.id, x.folio, STATUS_LABEL[x.status], cust.get(x.customerId), veh.get(x.vehicleId)?.plate, x.receivedAt, x.deliveredAt, x.isWarranty ? 'sí' : 'no']), sep),
    'ventas.csv': toCsv(['id', 'folio', 'fecha', 'cliente', 'estado', 'venta_neta_mxn', 'impuestos_mxn', 'total_mxn', 'cobrado_mxn', 'saldo_mxn', ...(o.costs ? ['costo_directo_mxn', 'utilidad_bruta_mxn'] : [])],
      d.sales.map((s) => [s.id, s.folio, s.date, s.customerName, s.status, pesos(s.netCents), pesos(s.taxCents), pesos(s.totalCents), pesos(salePaid(s, d.ledger)), pesos(saleBalance(s, d.ledger)), ...(o.costs ? [pesos(s.costCents), pesos(s.netCents - s.costCents)] : [])]), sep),
    'ventas_partidas.csv': toCsv(['venta_id', 'folio', 'tipo', 'descripcion', 'cantidad', 'precio_unitario_mxn', 'descuento_mxn', 'venta_neta_mxn', ...(o.costs ? ['costo_mxn', 'costo_estimado'] : [])],
      d.sales.flatMap((s) => s.items.map((i) => [s.id, s.folio, i.type, i.description, i.qty, pesos(i.unitPriceCents), pesos(i.discountCents), pesos(i.netCents), ...(o.costs ? [pesos(i.costCents), i.costEstimated ? 'sí' : 'no'] : [])])), sep),
    'movimientos_dinero.csv': toCsv(['id', 'fecha', 'tipo', 'direccion', 'monto_mxn', 'metodo', 'cuenta', 'referencia', 'nota'], d.ledger.map((l) => [l.id, l.date, l.kind, l.direction, pesos(l.amountCents), l.methodId, l.account, l.reference, l.note]), sep),
    'gastos.csv': toCsv(['id', 'fecha', 'concepto', 'categoria', 'importe_mxn', 'iva_mxn', 'cancelado'], d.expenses.map((e) => [e.id, e.date, e.concept, d.settings.expenseCategories.find((c) => c.id === e.categoryId)?.name, pesos(e.amountCents), pesos(e.taxCents), e.cancelled ? 'sí' : 'no']), sep),
    'proveedores.csv': toCsv(['id', 'nombre', 'telefono', 'correo', 'dias_credito'], d.suppliers.map((s) => [s.id, s.name, s.phone, s.email, s.paymentTermsDays]), sep),
    'productos.csv': toCsv(['id', 'sku', 'nombre', 'categoria', 'unidad', 'precio_mxn', 'stock_minimo', ...(o.costs ? ['existencias', 'valor_mxn'] : [])],
      d.products.map((p) => { const bs = d.balances.filter((b) => b.productId === p.id); return [p.id, p.sku, p.name, p.category, p.unit, pesos(p.priceCents), p.minStock, ...(o.costs ? [bs.reduce((a, b) => a + b.qty, 0), pesos(bs.reduce((a, b) => a + b.valueCents, 0))] : [])] }), sep),
    'compras_recepciones.csv': toCsv(['id', 'folio', 'fecha', 'vence', 'proveedor_id', 'mercancia_mxn', 'flete_mxn', 'iva_mxn', 'total_mxn'], d.receipts.map((r) => [r.id, r.folio, r.date, r.dueDate, r.supplierId, pesos(r.goodsCents), pesos(r.freightCents), pesos(r.taxCents), pesos(r.totalCents)]), sep),
  }
  if (o.costs) out['movimientos_inventario.csv'] = toCsv(['id', 'fecha', 'producto_id', 'tipo', 'cantidad', 'costo_total_mxn', 'referencia', 'motivo'], d.movements.map((m) => [m.id, m.date, m.productId, m.type, m.qty, pesos(m.totalCostCents), m.refType + ':' + m.refId, m.reason]), sep)
  out['empleados.csv'] = toCsv(['id', 'nombre', 'rol', 'especialidad', 'activo', ...(o.salaries ? ['costo_laboral_mensual_mxn'] : [])], d.employees.map((e) => [e.id, e.name, e.role, e.specialty, e.active ? 'sí' : 'no', ...(o.salaries ? [pesos(e.monthlyCostCents)] : [])]), sep)
  return out
}
