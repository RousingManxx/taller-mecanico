import { addDays } from '../domain/dates'
import { fmtCell } from '../domain/csv'
import { saleBalance, salePaid, saleReturnsTotal } from '../domain/finance'
import { lineAmounts, sumLines } from '../domain/lines'
import { formatMXN, formatQty } from '../domain/money'
import { billableItems, ITEM_TYPE_LABEL, STATUS_LABEL } from '../domain/orders'
import type { PdfBlock, PdfDoc } from '../domain/pdf'
import { currentVersion, quoteSummary } from '../domain/quotes'
import type { ReportResult } from '../domain/reports'
import type { WorkOrder } from '../domain/types'
import { fmtDate, fmtDateTime, plateOf, type Data } from './data'

/**
 * Modelos de los documentos (cotización, orden, recepción, autorización, entrega, garantía, venta, comprobante, compra y reportes).
 * Los destinados al cliente solo llevan información comercial: nunca costos internos, márgenes, notas privadas ni salarios.
 */
const money = formatMXN
const header = (d: Data) => {
  const s = d.settings
  return { name: s.businessName, legal: s.legalName || undefined, line1: [s.taxId && `RFC ${s.taxId}`, s.address].filter(Boolean).join(' · ') || undefined, line2: [s.phone, s.email].filter(Boolean).join(' · ') || undefined }
}
const base = (d: Data, title: string, folio?: string, date?: string): Omit<PdfDoc, 'blocks'> => ({ title, folio, date, business: header(d), footer: `${d.settings.businessName} · documento de control interno, no es un comprobante fiscal (CFDI)` })

function parties(d: Data, customerId?: string, vehicleId?: string, order?: WorkOrder, fallbackName?: string): PdfBlock {
  const c = d.custMap.get(order?.customerId ?? customerId ?? ''), v = d.vehMap.get(order?.vehicleId ?? vehicleId ?? '')
  const boxes = [{ title: 'Cliente', lines: [c?.name ?? fallbackName ?? 'Público en general', ...[c?.phone, c?.email, c?.taxId && `RFC ${c.taxId}`].filter(Boolean) as string[]] }]
  if (v) boxes.push({ title: 'Vehículo', lines: [`${v.make} ${v.model} ${v.year ?? ''} ${v.version}`.trim(), `Placas ${v.plate || '—'}${v.vin ? ` · VIN ${v.vin}` : ''}`, [v.color, v.fuel, v.transmission].filter(Boolean).join(' · '), order ? `Kilometraje de entrada: ${formatQty(order.km)} km` : ''].filter(Boolean) })
  return { t: 'boxes', boxes }
}
interface Row { description: string; qty: number; unit?: string; price: number; discount: number; total: number; type?: string }
const itemsTable = (rows: Row[]): PdfBlock => ({ t: 'table', table: { cols: [{ label: 'Concepto', w: 5.2 }, { label: 'Cant.', w: 1.3, align: 'r' }, { label: 'Precio unit.', w: 1.7, align: 'r' }, { label: 'Desc.', w: 1.2, align: 'r' }, { label: 'Importe', w: 1.7, align: 'r' }], rows: rows.map((r) => [r.type ? `${r.description} · ${r.type}` : r.description, `${formatQty(r.qty)} ${r.unit ?? ''}`.trim(), money(r.price), r.discount ? money(r.discount) : '', money(r.total)]) } })
const totals = (net: number, tax: number, total: number, extra: [string, string][] = []): PdfBlock => ({ t: 'totals', rows: [['Subtotal', money(net)], ['IVA / impuestos', money(tax)], ...extra, ['Total', money(total), true]] })

export function buildDoc(d: Data, tipo: string, id: string, authId?: string | null): PdfDoc | null {
  const s = d.settings
  const order = d.orders.find((o) => o.id === id)
  const orderRows = (o: WorkOrder, ids?: Set<string>): Row[] => billableItems(o).filter((i) => !ids || ids.has(i.id)).map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: lineAmounts(i, s.pricesIncludeTax).netCents, type: ITEM_TYPE_LABEL[i.type] }))
  const mech = (o: WorkOrder) => d.empMap.get(o.mechanicId ?? '')?.name

  if (tipo === 'cotizacion') {
    const q = d.quotations.find((x) => x.id === id); if (!q) return null
    const v = (q.approvedVersion ? q.versions.find((x) => x.n === q.approvedVersion) : null) ?? currentVersion(q)
    const sum = quoteSummary(v.items, s)
    return { ...base(d, 'Cotización', `${q.folio} · v${v.n}`, `Emitida ${fmtDate(q.issueDate)}`), signatures: ['Aceptación del cliente (nombre y firma)', 'Por el taller'], blocks: [
      parties(d, q.customerId, q.vehicleId), { t: 'heading', text: 'Partidas' },
      itemsTable(v.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: lineAmounts(i, s.pricesIncludeTax).netCents, type: ITEM_TYPE_LABEL[i.type] }))),
      totals(sum.netCents, sum.taxCents, sum.totalCents), { t: 'heading', text: 'Condiciones' },
      { t: 'kv', rows: [['Vigencia', `hasta el ${fmtDate(q.validUntil)}`], ['Tiempo estimado', `${v.estimatedDays} día(s)`], ...(v.notes ? [['Observaciones', v.notes] as [string, string]] : [])] },
      { t: 'text', text: v.terms, muted: true }, { t: 'text', text: `Garantía: ${v.warranty}`, muted: true },
    ] }
  }
  if (tipo === 'venta') {
    const sale = d.sales.find((x) => x.id === id); if (!sale) return null
    const pays = d.ledger.filter((l) => (l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente') && (l.saleId === sale.id || (!l.saleId && sale.workOrderId && l.workOrderId === sale.workOrderId)))
    const blocks: PdfBlock[] = [parties(d, sale.customerId, undefined, sale.workOrderId ? d.orders.find((o) => o.id === sale.workOrderId) : undefined, sale.customerName)]
    if (sale.status === 'cancelada') blocks.push({ t: 'stamp', text: 'VENTA CANCELADA' })
    blocks.push({ t: 'heading', text: 'Partidas' }, itemsTable(sale.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: i.netCents, type: ITEM_TYPE_LABEL[i.type] }))),
      totals(sale.netCents, sale.taxCents, sale.totalCents, [...(sale.returns.length ? ([['Devoluciones', '-' + money(saleReturnsTotal(sale))]] as [string, string][]) : []), ['Pagado', money(salePaid(sale, d.ledger))], ['Saldo pendiente', money(saleBalance(sale, d.ledger))]]))
    if (pays.length) blocks.push({ t: 'heading', text: 'Pagos recibidos' }, { t: 'table', table: { cols: [{ label: 'Fecha', w: 1.5 }, { label: 'Forma de pago', w: 2 }, { label: 'Referencia', w: 2 }, { label: 'Importe', w: 1.5, align: 'r' }], rows: pays.map((p) => [fmtDate(p.date), s.paymentMethods.find((m) => m.id === p.methodId)?.name ?? p.methodId, p.reference, (p.direction === 'in' ? '' : '-') + money(p.amountCents)]) } })
    return { ...base(d, 'Comprobante de venta', sale.folio, fmtDate(sale.date)), blocks }
  }
  if (tipo === 'comprobante') {
    const l = d.ledger.find((x) => x.id === id); if (!l) return null
    const sale = d.sales.find((x) => x.id === l.saleId), cust = d.custMap.get(l.customerId ?? sale?.customerId ?? '')
    return { ...base(d, l.direction === 'out' ? 'Comprobante de reembolso' : 'Comprobante de pago', sale?.folio, fmtDateTime(l.at)), signatures: ['Recibió', 'Cliente'], blocks: [
      { t: 'boxes', boxes: [{ title: l.direction === 'out' ? 'Devolvimos a' : 'Recibimos de', lines: [cust?.name ?? sale?.customerName ?? 'Cliente'] }] },
      { t: 'kv', rows: [['Importe', money(l.amountCents)], ['Forma de pago', s.paymentMethods.find((m) => m.id === l.methodId)?.name ?? l.methodId], ['Referencia', l.reference || '—'], ['Concepto', l.note || '—'], ...(sale ? [[`Saldo pendiente de la venta ${sale.folio}`, money(saleBalance(sale, d.ledger))] as [string, string]] : [])] },
    ] }
  }
  if (tipo === 'compra') {
    const po = d.purchaseOrders.find((x) => x.id === id); if (!po) return null
    const sup = d.supMap.get(po.supplierId)
    const goods = po.items.reduce((a, i) => a + Math.round(i.qty * i.unitCostCents) - i.discountCents, 0), tax = Math.round(((goods + po.freightCents) * po.taxRate) / 100)
    return { ...base(d, 'Orden de compra', po.folio, fmtDate(po.date)), blocks: [
      { t: 'boxes', boxes: [{ title: 'Proveedor', lines: [sup?.name ?? '—', ...[sup?.contact, [sup?.phone, sup?.email].filter(Boolean).join(' · '), sup?.address].filter(Boolean) as string[]] }, { title: 'Entrega', lines: [`Fecha esperada: ${po.expectedDate ? fmtDate(po.expectedDate) : '—'}`, `Estado: ${po.status}`] }] },
      { t: 'heading', text: 'Productos' }, itemsTable(po.items.map((i) => ({ description: i.description, qty: i.qty, price: i.unitCostCents, discount: i.discountCents, total: Math.round(i.qty * i.unitCostCents) - i.discountCents }))),
      totals(goods + po.freightCents, tax, goods + po.freightCents + tax, po.freightCents ? [['Incluye flete', money(po.freightCents)]] : []), ...(po.notes ? [{ t: 'text', text: `Notas: ${po.notes}` } as PdfBlock] : []),
    ] }
  }
  if (!order) return null
  const rows = orderRows(order), tot = sumLines(billableItems(order).map((i) => lineAmounts(i, s.pricesIncludeTax)))
  const folio = order.folio

  if (tipo === 'orden') return { ...base(d, order.isWarranty ? 'Orden de trabajo (garantía)' : 'Orden de trabajo', folio, `Recibida ${fmtDateTime(order.receivedAt)}`), signatures: ['Autorizo los trabajos descritos (cliente)', 'Por el taller'], blocks: [
    parties(d, undefined, undefined, order), { t: 'heading', text: 'Motivo de ingreso y diagnóstico' },
    { t: 'kv', rows: [['Reportado', order.complaint], ...(order.symptoms ? [['Síntomas', order.symptoms] as [string, string]] : []), ...(order.inspection ? [['Inspección inicial', order.inspection] as [string, string]] : []), ...(order.diagnosis ? [['Diagnóstico', order.diagnosis] as [string, string]] : []), ['Estado', STATUS_LABEL[order.status]], ...(mech(order) ? [['Mecánico', mech(order)!] as [string, string]] : []), ...(order.promisedAt ? [['Entrega estimada', fmtDateTime(order.promisedAt)] as [string, string]] : [])] },
    { t: 'heading', text: 'Trabajos y refacciones autorizados' }, ...(rows.length ? [itemsTable(rows), totals(tot.netCents, tot.taxCents, tot.totalCents)] : [{ t: 'text', text: 'Aún no hay partidas autorizadas.', muted: true } as PdfBlock]),
    ...(order.notesCustomer ? [{ t: 'heading', text: 'Observaciones' } as PdfBlock, { t: 'text', text: order.notesCustomer } as PdfBlock] : []),
  ] }
  if (tipo === 'recepcion') return { ...base(d, 'Hoja de recepción', folio, fmtDateTime(order.receivedAt)), signatures: ['Firma del cliente (recibe copia)', 'Recibió por el taller'], blocks: [
    parties(d, undefined, undefined, order), { t: 'heading', text: 'Estado del vehículo al recibirlo' },
    { t: 'kv', rows: [['Nivel de combustible', order.fuelLevel || '—'], ['Daños preexistentes', order.damages || 'Sin daños reportados'], ['Accesorios / pertenencias', order.accessories || '—'], ...(order.photoIds.length ? [['Fotografías', `${order.photoIds.length} adjunta(s) en la orden`] as [string, string]] : [])] },
    { t: 'heading', text: 'Motivo de ingreso' }, { t: 'kv', rows: [['Reportado', order.complaint], ...(order.symptoms ? [['Síntomas', order.symptoms] as [string, string]] : []), ...(order.inspection ? [['Inspección inicial', order.inspection] as [string, string]] : [])] },
    { t: 'text', text: 'El taller no se hace responsable por objetos de valor dejados en el vehículo que no hayan sido registrados en esta hoja.', muted: true },
  ] }
  if (tipo === 'autorizacion') {
    const auth = order.authorizations.find((a) => a.id === authId)
    const ids = new Set(auth ? auth.itemIds : order.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado').map((i) => i.id))
    const its = order.items.filter((i) => ids.has(i.id)), t = sumLines(its.map((i) => lineAmounts(i, s.pricesIncludeTax)))
    return { ...base(d, 'Autorización de trabajos', folio, fmtDateTime(auth?.at ?? order.updatedAt)), signatures: ['Autorizo (nombre y firma del cliente)', 'Por el taller'], blocks: [
      parties(d, undefined, undefined, order), { t: 'heading', text: auth ? 'Trabajos autorizados' : 'Trabajos adicionales por autorizar' },
      ...(its.length ? [itemsTable(its.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: lineAmounts(i, s.pricesIncludeTax).netCents, type: ITEM_TYPE_LABEL[i.type] }))), totals(t.netCents, t.taxCents, t.totalCents)] : [{ t: 'text', text: 'No hay partidas pendientes.', muted: true } as PdfBlock]),
      ...(auth ? [{ t: 'kv', rows: [['Autorizó', auth.approvedBy], ['Vía', auth.via], ['Importe aprobado', money(auth.amountCents)], ...(auth.quotationId ? [['Cotización', `versión ${auth.quotationVersion}`] as [string, string]] : [])] } as PdfBlock] : []),
      { t: 'text', text: 'Los trabajos adicionales se ejecutan únicamente con la autorización del cliente.', muted: true },
    ] }
  }
  if (tipo === 'entrega') {
    const sale = d.sales.find((x) => x.id === order.saleId)
    return { ...base(d, 'Resumen de entrega', folio, order.deliveredAt ? fmtDateTime(order.deliveredAt) : 'Pendiente de entrega'), signatures: ['Recibo el vehículo de conformidad (cliente)', 'Entregó por el taller'], blocks: [
      parties(d, undefined, undefined, order), { t: 'kv', rows: [['Kilometraje de salida', order.kmOut ? `${formatQty(order.kmOut)} km` : '—'], ...(mech(order) ? [['Mecánico', mech(order)!] as [string, string]] : [])] },
      { t: 'heading', text: 'Trabajos realizados y refacciones instaladas' }, itemsTable(rows),
      totals(tot.netCents, tot.taxCents, tot.totalCents, sale ? [['Pagado', money(salePaid(sale, d.ledger))], ['Saldo pendiente', money(saleBalance(sale, d.ledger))]] : []),
      { t: 'heading', text: 'Garantía' }, { t: 'text', text: s.warrantyText }, { t: 'text', text: `Vigencia: ${s.warrantyDays} días${order.deliveredAt ? `, hasta el ${fmtDate(addDays(order.deliveredAt.slice(0, 10), s.warrantyDays))}` : ''}.`, bold: true },
    ] }
  }
  if (tipo === 'garantia') return { ...base(d, 'Garantía de servicio', folio, order.deliveredAt ? fmtDate(order.deliveredAt) : ''), signatures: ['Cliente', 'Por el taller'], blocks: [
    parties(d, undefined, undefined, order), { t: 'heading', text: 'Servicios y refacciones cubiertos' }, itemsTable(rows), { t: 'heading', text: 'Condiciones de la garantía' }, { t: 'text', text: s.warrantyText },
    { t: 'text', text: `Vigencia: ${s.warrantyDays} días${order.deliveredAt ? ` a partir del ${fmtDate(order.deliveredAt)}, es decir, hasta el ${fmtDate(addDays(order.deliveredAt.slice(0, 10), s.warrantyDays))}` : ''}. Para hacerla válida presenta este documento y el vehículo ${plateOf(d.vehMap.get(order.vehicleId))}.`, bold: true },
  ] }
  return null
}

/** Reporte (tabla) como documento PDF; apaisado si tiene muchas columnas. */
export function reportDoc(d: Data, r: ReportResult): PdfDoc {
  const w = (c: { kind: string; label: string }) => (c.kind === 'text' ? 3 : c.kind === 'date' ? 1.6 : 1.8)
  const fmt = (v: unknown, kind: string) => (kind === 'date' && typeof v === 'string' ? fmtDate(v) : fmtCell(v as never, kind))
  const blocks: PdfBlock[] = [
    { t: 'kv', rows: [['Periodo', r.range ? (r.range.from === r.range.to ? fmtDate(r.range.from) : `${fmtDate(r.range.from)} – ${fmtDate(r.range.to)}`) : 'Al corte'], ['Filtros', r.filters.join(' | ') || 'ninguno'], ['Generado', fmtDateTime(r.generatedAt)], ...(r.sensitive ? [['Aviso', 'Contiene costos o márgenes: uso interno'] as [string, string]] : [])] },
    { t: 'text', text: `Definición: ${r.definition}`, muted: true }, { t: 'text', text: `Fuente: ${r.source}`, muted: true },
    ...r.warnings.map((x) => ({ t: 'text', text: `Aviso: ${x}`, bold: true }) as PdfBlock),
    r.rows.length ? { t: 'table', table: { cols: r.columns.map((c) => ({ label: c.label, w: w(c), align: c.kind === 'text' || c.kind === 'date' ? undefined : ('r' as const) })), rows: r.rows.map((row) => row.map((v, j) => fmt(v, r.columns[j].kind))), foot: r.totals?.map((v, j) => (typeof v === 'string' ? v : fmt(v, r.columns[j]?.kind ?? 'text'))) } } : { t: 'text', text: 'Sin datos para este periodo.', muted: true },
  ]
  return { ...base(d, r.title, undefined, fmtDate(d.today)), blocks, landscape: r.columns.length > 5, footer: `${d.settings.businessName} · ${r.title} · reporte gerencial, no sustituye contabilidad` }
}
