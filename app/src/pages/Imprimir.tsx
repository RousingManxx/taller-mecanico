import type { ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { addDays } from '../domain/dates'
import { saleBalance, salePaid, saleReturnsTotal } from '../domain/finance'
import { lineAmounts, sumLines } from '../domain/lines'
import { formatMXN, formatQty } from '../domain/money'
import { billableItems, ITEM_TYPE_LABEL, STATUS_LABEL } from '../domain/orders'
import { currentVersion, quoteSummary } from '../domain/quotes'
import type { WorkOrder } from '../domain/types'
import { fmtDate, fmtDateTime, plateOf, type Data } from '../ui/data'
import { useAttachments } from '../ui/image'
import { useCtx } from '../ui/session'
import { Empty, Icon } from '../ui/ui'

/**
 * Documentos imprimibles. Los destinados al cliente muestran solo información comercial: nunca costos internos,
 * márgenes, notas privadas ni salarios. «Imprimir» abre el diálogo del navegador (permite «Guardar como PDF»).
 */
function Doc({ data, title, folio, date, children }: { data: Data; title: string; folio?: string; date?: string; children: ReactNode }) {
  const ctx = useCtx(), nav = useNavigate()
  const s = data.settings
  const logo = useAttachments(ctx, s.logoId ? [s.logoId] : [])[0]
  return (
    <div className="stack" style={{ padding: 16 }}>
      <div className="row no-print"><button className="btn" onClick={() => nav(-1)}><Icon n="back" size={18} />Volver</button><button className="btn primary" onClick={() => window.print()}><Icon n="print" size={18} />Imprimir / Guardar PDF</button></div>
      <article className="doc">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>{logo && <img src={logo.dataUrl} alt="" style={{ height: 52, maxWidth: 120, objectFit: 'contain' }} />}
            <div><b style={{ fontSize: 16 }}>{s.businessName}</b>{s.legalName && <div>{s.legalName}</div>}{s.taxId && <div>RFC {s.taxId}</div>}<div>{s.address}</div><div>{[s.phone, s.email].filter(Boolean).join(' · ')}</div></div></div>
          <div className="right"><h1>{title}</h1>{folio && <div><b>{folio}</b></div>}{date && <div>{date}</div>}</div>
        </div>
        {children}
        <p style={{ marginTop: 24, fontSize: 10, color: '#666' }}>Documento generado por Torque. Este documento es de control interno y no constituye un comprobante fiscal (CFDI).</p>
      </article>
    </div>
  )
}

function Parties({ data, order, customerId, vehicleId }: { data: Data; order?: WorkOrder; customerId?: string; vehicleId?: string }) {
  const c = data.custMap.get(order?.customerId ?? customerId ?? ''), v = data.vehMap.get(order?.vehicleId ?? vehicleId ?? '')
  return (
    <div className="grid2" style={{ marginTop: 14 }}>
      <div><h2>Cliente</h2><div><b>{c?.name ?? 'Público en general'}</b></div>{c?.phone && <div>{c.phone}</div>}{c?.email && <div>{c.email}</div>}{c?.taxId && <div>RFC {c.taxId}</div>}</div>
      {v && <div><h2>Vehículo</h2><div><b>{v.make} {v.model} {v.year ?? ''} {v.version}</b></div><div>Placas {v.plate || '—'}{v.vin ? ` · VIN ${v.vin}` : ''}</div><div>{[v.color, v.fuel, v.transmission].filter(Boolean).join(' · ')}</div>{order && <div>Kilometraje de entrada: {formatQty(order.km)} km</div>}</div>}
    </div>
  )
}

interface Row { description: string; qty: number; unit?: string; price: number; discount: number; total: number; type?: string }
function Items({ rows }: { rows: Row[] }) {
  return (
    <table style={{ marginTop: 6 }}><thead><tr><th>Concepto</th><th className="r">Cant.</th><th className="r">Precio unit.</th><th className="r">Desc.</th><th className="r">Importe</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{r.description}{r.type && <span style={{ color: '#777' }}> · {r.type}</span>}</td><td className="r">{formatQty(r.qty)} {r.unit}</td><td className="r">{formatMXN(r.price)}</td><td className="r">{r.discount ? formatMXN(r.discount) : ''}</td><td className="r">{formatMXN(r.total)}</td></tr>)}</tbody></table>
  )
}
function Totals({ net, tax, total, extra }: { net: number; tax: number; total: number; extra?: [string, number][] }) {
  return (
    <table style={{ marginTop: 8, width: 300, marginLeft: 'auto' }}><tbody>
      <tr><td>Subtotal</td><td className="r">{formatMXN(net)}</td></tr><tr><td>IVA / impuestos</td><td className="r">{formatMXN(tax)}</td></tr>
      <tr className="tot"><td>Total</td><td className="r">{formatMXN(total)}</td></tr>
      {extra?.map(([l, v]) => <tr key={l}><td>{l}</td><td className="r">{formatMXN(v)}</td></tr>)}
    </tbody></table>
  )
}
const Sig = ({ labels }: { labels: string[] }) => <div className="sig">{labels.map((l) => <div key={l}>{l}</div>)}</div>

export function Imprimir({ data }: { data: Data }) {
  const { tipo, id } = useParams()
  const [sp] = useSearchParams()
  const ctx = useCtx()
  const s = data.settings
  const order = data.orders.find((o) => o.id === id) ?? data.orderMap.get(id ?? '')
  const photos = useAttachments(ctx, tipo === 'recepcion' && order ? order.photoIds : [])
  const itemRows = (o: WorkOrder, filter?: (id: string) => boolean): Row[] => billableItems(o).filter((i) => !filter || filter(i.id)).map((i) => { const a = lineAmounts(i, s.pricesIncludeTax); return { description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: a.netCents, type: ITEM_TYPE_LABEL[i.type] } })
  const mech = (o: WorkOrder) => data.empMap.get(o.mechanicId ?? '')?.name

  if (tipo === 'cotizacion') {
    const q = data.quotations.find((x) => x.id === id)
    if (!q) return <Empty title="Cotización no encontrada" />
    const v = (q.approvedVersion ? q.versions.find((x) => x.n === q.approvedVersion) : null) ?? currentVersion(q)
    const sum = quoteSummary(v.items, s)
    return (
      <Doc data={data} title="Cotización" folio={`${q.folio} · v${v.n}`} date={`Emitida ${fmtDate(q.issueDate)}`}>
        <Parties data={data} customerId={q.customerId} vehicleId={q.vehicleId} />
        <h2>Partidas</h2>
        <Items rows={v.items.map((i) => { const a = lineAmounts(i, s.pricesIncludeTax); return { description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: a.netCents, type: ITEM_TYPE_LABEL[i.type] } })} />
        <Totals net={sum.netCents} tax={sum.taxCents} total={sum.totalCents} />
        <h2>Condiciones</h2>
        <div>Vigencia: hasta el <b>{fmtDate(q.validUntil)}</b> · Tiempo estimado: <b>{v.estimatedDays} día(s)</b></div>
        {v.notes && <div>Observaciones: {v.notes}</div>}<div>{v.terms}</div><div><b>Garantía:</b> {v.warranty}</div>
        <Sig labels={['Aceptación del cliente (nombre y firma)', 'Por el taller']} />
      </Doc>)
  }

  if (tipo === 'venta') {
    const sale = data.sales.find((x) => x.id === id)
    if (!sale) return <Empty title="Venta no encontrada" />
    const pays = data.ledger.filter((l) => (l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente') && (l.saleId === sale.id || (!l.saleId && sale.workOrderId && l.workOrderId === sale.workOrderId)))
    return (
      <Doc data={data} title="Comprobante de venta" folio={sale.folio} date={fmtDate(sale.date)}>
        <Parties data={data} customerId={sale.customerId} order={sale.workOrderId ? data.orders.find((o) => o.id === sale.workOrderId) : undefined} />
        {!sale.customerId && <div style={{ marginTop: 8 }}>Cliente: {sale.customerName}</div>}
        <h2>Partidas</h2>
        <Items rows={sale.items.map((i) => ({ description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: i.netCents, type: ITEM_TYPE_LABEL[i.type] }))} />
        <Totals net={sale.netCents} tax={sale.taxCents} total={sale.totalCents} extra={[...(sale.returns.length ? [['Devoluciones', -saleReturnsTotal(sale)] as [string, number]] : []), ['Pagado', salePaid(sale, data.ledger)], ['Saldo pendiente', saleBalance(sale, data.ledger)]]} />
        {pays.length > 0 && <><h2>Pagos recibidos</h2><table><tbody>{pays.map((p) => <tr key={p.id}><td>{fmtDate(p.date)}</td><td>{s.paymentMethods.find((m) => m.id === p.methodId)?.name ?? p.methodId}</td><td>{p.reference}</td><td className="r">{p.direction === 'in' ? formatMXN(p.amountCents) : '−' + formatMXN(p.amountCents)}</td></tr>)}</tbody></table></>}
        {sale.status === 'cancelada' && <h2 style={{ color: '#a00' }}>VENTA CANCELADA</h2>}
      </Doc>)
  }

  if (tipo === 'comprobante') {
    const l = data.ledger.find((x) => x.id === id)
    if (!l) return <Empty title="Pago no encontrado" />
    const sale = data.sales.find((x) => x.id === l.saleId)
    const cust = data.custMap.get(l.customerId ?? sale?.customerId ?? '')
    return (
      <Doc data={data} title="Comprobante de pago" folio={sale?.folio} date={fmtDateTime(l.at)}>
        <div style={{ marginTop: 14 }}><h2>Recibimos de</h2><div><b>{cust?.name ?? sale?.customerName ?? 'Cliente'}</b></div></div>
        <table style={{ marginTop: 14 }}><tbody>
          <tr><td>Importe</td><td className="r"><b style={{ fontSize: 16 }}>{formatMXN(l.amountCents)}</b></td></tr><tr><td>Forma de pago</td><td className="r">{s.paymentMethods.find((m) => m.id === l.methodId)?.name ?? l.methodId}</td></tr>
          <tr><td>Referencia</td><td className="r">{l.reference || '—'}</td></tr><tr><td>Concepto</td><td className="r">{l.note}</td></tr>
          {sale && <tr><td>Saldo pendiente de la venta {sale.folio}</td><td className="r">{formatMXN(saleBalance(sale, data.ledger))}</td></tr>}
        </tbody></table>
        {l.direction === 'out' && <h2 style={{ color: '#a00' }}>Devolución / reembolso al cliente</h2>}
        <Sig labels={['Recibió', 'Cliente']} />
      </Doc>)
  }

  if (tipo === 'compra') {
    const po = data.purchaseOrders.find((x) => x.id === id)
    if (!po) return <Empty title="Orden de compra no encontrada" />
    const sup = data.supMap.get(po.supplierId)
    const goods = po.items.reduce((a, i) => a + Math.round(i.qty * i.unitCostCents) - i.discountCents, 0), tax = Math.round(((goods + po.freightCents) * po.taxRate) / 100)
    return (
      <Doc data={data} title="Orden de compra" folio={po.folio} date={fmtDate(po.date)}>
        <div className="grid2" style={{ marginTop: 14 }}><div><h2>Proveedor</h2><b>{sup?.name}</b><div>{sup?.contact}</div><div>{sup?.phone} {sup?.email}</div><div>{sup?.address}</div></div><div><h2>Entrega</h2><div>Fecha esperada: {po.expectedDate ? fmtDate(po.expectedDate) : '—'}</div><div>Estado: {po.status}</div></div></div>
        <Items rows={po.items.map((i) => ({ description: i.description, qty: i.qty, price: i.unitCostCents, discount: i.discountCents, total: Math.round(i.qty * i.unitCostCents) - i.discountCents }))} />
        <Totals net={goods + po.freightCents} tax={tax} total={goods + po.freightCents + tax} extra={po.freightCents ? [['Incluye flete', po.freightCents]] : undefined} />
        {po.notes && <div>Notas: {po.notes}</div>}
      </Doc>)
  }

  if (!order) return <Empty title="Documento no encontrado" text="Verifica que tengas acceso a esta orden." />
  const rows = itemRows(order), tot = sumLines(billableItems(order).map((i) => lineAmounts(i, s.pricesIncludeTax)))

  if (tipo === 'orden') return (
    <Doc data={data} title={order.isWarranty ? 'Orden de trabajo (garantía)' : 'Orden de trabajo'} folio={order.folio} date={`Recibida ${fmtDateTime(order.receivedAt)}`}>
      <Parties data={data} order={order} />
      <h2>Motivo de ingreso y diagnóstico</h2>
      <div><b>Reportado:</b> {order.complaint}</div>{order.symptoms && <div><b>Síntomas:</b> {order.symptoms}</div>}{order.inspection && <div><b>Inspección inicial:</b> {order.inspection}</div>}{order.diagnosis && <div><b>Diagnóstico:</b> {order.diagnosis}</div>}
      <div>Estado: <b>{STATUS_LABEL[order.status]}</b>{mech(order) && <> · Mecánico: {mech(order)}</>}{order.promisedAt && <> · Entrega estimada: {fmtDateTime(order.promisedAt)}</>}</div>
      <h2>Trabajos y refacciones autorizados</h2>{rows.length ? <><Items rows={rows} /><Totals net={tot.netCents} tax={tot.taxCents} total={tot.totalCents} /></> : <div>Aún no hay partidas autorizadas.</div>}
      {order.notesCustomer && <><h2>Observaciones</h2><div>{order.notesCustomer}</div></>}
      <Sig labels={['Autorizo los trabajos descritos (cliente)', 'Por el taller']} />
    </Doc>)

  if (tipo === 'recepcion') return (
    <Doc data={data} title="Hoja de recepción del vehículo" folio={order.folio} date={fmtDateTime(order.receivedAt)}>
      <Parties data={data} order={order} />
      <h2>Estado del vehículo al recibirlo</h2>
      <div><b>Nivel de combustible:</b> {order.fuelLevel || '—'}</div><div><b>Daños preexistentes:</b> {order.damages || 'Sin daños reportados'}</div><div><b>Accesorios / pertenencias:</b> {order.accessories || '—'}</div>
      <h2>Motivo de ingreso</h2><div>{order.complaint}</div>{order.symptoms && <div><b>Síntomas:</b> {order.symptoms}</div>}{order.inspection && <div><b>Inspección inicial:</b> {order.inspection}</div>}
      {photos.length > 0 && <><h2>Fotografías</h2><div className="row wrap">{photos.filter((p) => p.mime.startsWith('image/')).map((p) => <img key={p.id} src={p.dataUrl} alt={p.name} style={{ height: 110, borderRadius: 4 }} />)}</div></>}
      <p style={{ marginTop: 10 }}>El taller no se hace responsable por objetos de valor dejados en el vehículo que no hayan sido registrados en esta hoja.</p>
      <Sig labels={['Firma del cliente (recibe copia)', 'Recibió por el taller']} />
    </Doc>)

  if (tipo === 'autorizacion') {
    const auth = order.authorizations.find((a) => a.id === sp.get('auth'))
    const pend = order.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado')
    const ids = auth ? new Set(auth.itemIds) : new Set(pend.map((i) => i.id))
    const list = order.items.filter((i) => ids.has(i.id)).map((i) => { const a = lineAmounts(i, s.pricesIncludeTax); return { description: i.description, qty: i.qty, unit: i.unit, price: i.unitPriceCents, discount: i.discountCents, total: a.netCents, type: ITEM_TYPE_LABEL[i.type] } })
    const t = sumLines(order.items.filter((i) => ids.has(i.id)).map((i) => lineAmounts(i, s.pricesIncludeTax)))
    return (
      <Doc data={data} title="Autorización de trabajos" folio={order.folio} date={fmtDateTime(auth?.at ?? order.updatedAt)}>
        <Parties data={data} order={order} />
        <h2>{auth ? 'Trabajos autorizados' : 'Trabajos adicionales por autorizar'}</h2>
        {list.length ? <><Items rows={list} /><Totals net={t.netCents} tax={t.taxCents} total={t.totalCents} /></> : <div>No hay partidas pendientes.</div>}
        {auth && <div style={{ marginTop: 10 }}>Autorizó: <b>{auth.approvedBy}</b> · Vía: {auth.via} · Importe aprobado: <b>{formatMXN(auth.amountCents)}</b>{auth.quotationId && <> · Cotización v{auth.quotationVersion}</>}</div>}
        <p>Los trabajos adicionales se ejecutan únicamente con la autorización del cliente.</p>
        <Sig labels={['Autorizo (nombre y firma del cliente)', 'Por el taller']} />
      </Doc>)
  }

  if (tipo === 'entrega') {
    const sale = data.sales.find((x) => x.id === order.saleId)
    return (
      <Doc data={data} title="Resumen de entrega" folio={order.folio} date={order.deliveredAt ? fmtDateTime(order.deliveredAt) : 'Pendiente de entrega'}>
        <Parties data={data} order={order} />
        <div>Kilometraje de salida: <b>{order.kmOut ? formatQty(order.kmOut) + ' km' : '—'}</b>{mech(order) && <> · Mecánico: {mech(order)}</>}</div>
        <h2>Trabajos realizados y refacciones instaladas</h2><Items rows={rows} /><Totals net={tot.netCents} tax={tot.taxCents} total={tot.totalCents} extra={sale ? [['Pagado', salePaid(sale, data.ledger)], ['Saldo pendiente', saleBalance(sale, data.ledger)]] : undefined} />
        <h2>Garantía</h2><div>{s.warrantyText}</div><div>Vigencia: {s.warrantyDays} días{order.deliveredAt ? `, hasta el ${fmtDate(addDays(order.deliveredAt.slice(0, 10), s.warrantyDays))}` : ''}.</div>
        <Sig labels={['Recibo el vehículo de conformidad (cliente)', 'Entregó por el taller']} />
      </Doc>)
  }

  if (tipo === 'garantia') return (
    <Doc data={data} title="Garantía de servicio" folio={order.folio} date={order.deliveredAt ? fmtDate(order.deliveredAt) : ''}>
      <Parties data={data} order={order} />
      <h2>Servicios y refacciones cubiertos</h2><Items rows={rows} />
      <h2>Condiciones de la garantía</h2><div>{s.warrantyText}</div>
      <div style={{ marginTop: 6 }}>Vigencia: <b>{s.warrantyDays} días</b>{order.deliveredAt ? <> a partir del {fmtDate(order.deliveredAt)}, es decir, hasta el <b>{fmtDate(addDays(order.deliveredAt.slice(0, 10), s.warrantyDays))}</b></> : ''}. Para hacerla válida presenta este documento y el vehículo {plateOf(data.vehMap.get(order.vehicleId))}.</div>
      <Sig labels={['Cliente', 'Por el taller']} />
    </Doc>)

  return <Empty title="Tipo de documento no reconocido" />
}
