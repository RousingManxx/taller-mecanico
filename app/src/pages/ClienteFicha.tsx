import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LEDGER_LABEL, PAY_LABEL, payStatus, saleReturnsTotal, type PayStatus } from '../domain/finance'
import { formatMXN } from '../domain/money'
import { orderTotals, STATUS_LABEL } from '../domain/orders'
import type { Customer, LedgerEntry, Quotation, Sale, Vehicle, WorkOrder } from '../domain/types'
import { QUOTE_LABEL } from '../domain/quotes'
import { removeCustomer, saveCustomer } from '../services/customers'
import { QUOTE_TONE, balanceOf, customerLedger, customerStats, effStatus, entriesOf, indexLedger, mailHref, quoteTotals, telHref, waHref, warrantyInfo } from '../ui/crm/lib'
import { Info, TabPanel, Tabs } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, plateOf, type Data } from '../ui/data'
import { useCtx } from '../ui/session'
import { Badge, DataTable, Empty, Stat, useBusy, useUi, type Column } from '../ui/ui'

type Tab = 'vehiculos' | 'ordenes' | 'cotizaciones' | 'ventas' | 'pagos' | 'garantias' | 'notas'
const PREF: Record<Customer['contactPref'], string> = { telefono: 'Llamada telefónica', whatsapp: 'WhatsApp', correo: 'Correo electrónico', ninguna: 'No contactar' }
const PAY_TONE: Record<PayStatus, '' | 'ok' | 'warn' | 'bad'> = { pagada: 'ok', parcial: 'warn', pendiente: 'bad', cancelada: '', sin_importe: '' }

const asInput = (c: Customer, patch: Partial<Customer> = {}) => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, address: c.address, taxId: c.taxId, fiscalName: c.fiscalName, fiscalAddress: c.fiscalAddress, contactPref: c.contactPref, notes: c.notes, active: c.active, ...patch })

export function ClienteFicha({ data }: { data: Data }) {
  const { id = '' } = useParams()
  const customer = data.custMap.get(id)
  if (!customer) return <Empty title="Cliente no encontrado" text="Puede que se haya borrado o que el enlace sea incorrecto." action={<Link className="btn" to="/clientes">Volver a clientes</Link>} />
  return <Ficha key={customer.id} data={data} c={customer} />
}

function Ficha({ data, c }: { data: Data; c: Customer }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate(), open = useOpen()
  const [tab, setTab] = useState<Tab>('vehiculos')
  const [busy, guard] = useBusy()
  const money = data.can('ventas.ver')
  const st = useMemo(() => customerStats(data, c.id), [data, c.id])
  const vehicles = useMemo(() => data.vehicles.filter((v) => v.customerId === c.id).sort((a, b) => Number(b.active) - Number(a.active) || a.make.localeCompare(b.make, 'es')), [data.vehicles, c.id])
  const orders = useMemo(() => data.orders.filter((o) => o.customerId === c.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [data.orders, c.id])
  const quotes = useMemo(() => data.quotations.filter((q) => q.customerId === c.id).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.folio.localeCompare(a.folio)), [data.quotations, c.id])
  const sales = useMemo(() => data.sales.filter((s) => s.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date) || b.folio.localeCompare(a.folio)), [data.sales, c.id])
  const ledger = useMemo(() => (money ? customerLedger(data, c.id) : []), [data, c.id, money])
  const saleMap = useMemo(() => new Map(data.sales.map((s) => [s.id, s])), [data.sales])
  const tel = telHref(c.phone), wa = waHref(c.phone), mail = mailHref(c.email)
  const canEdit = data.can('clientes.editar')

  const remove = async () => {
    const hist = { veh: data.vehicles.filter((v) => v.customerId === c.id).length, ord: data.orders.filter((o) => o.customerId === c.id).length, sal: data.sales.filter((s) => s.customerId === c.id).length, quo: data.quotations.filter((q) => q.customerId === c.id).length }
    const has = hist.veh + hist.ord + hist.sal + hist.quo > 0
    const msg = has
      ? `${c.name} tiene historial (${hist.veh} vehículo(s), ${hist.ord} orden(es), ${hist.sal} venta(s), ${hist.quo} cotización(es)), así que NO se borrará: se desactivará. Dejará de aparecer al elegir cliente en formularios nuevos, pero su historial se conserva y podrás reactivarlo cuando quieras.`
      : `${c.name} no tiene historial (vehículos, órdenes, ventas ni cotizaciones), por lo que se borrará definitivamente. Esta acción no se puede deshacer.`
    if (!(await ui.confirm(msg, has ? 'Desactivar cliente' : 'Borrar cliente', true))) return
    const r = await guard(() => ui.run(() => removeCustomer(ctx, c.id)))
    if (r === 'borrado') { ui.toast('Cliente borrado'); nav('/clientes') } else if (r === 'desactivado') ui.toast('Cliente desactivado: su historial se conserva.')
  }
  const reactivate = () => guard(() => ui.run(() => saveCustomer(ctx, asInput(c, { active: true })), 'Cliente reactivado'))

  const tabs: [Tab, string][] = [['vehiculos', `Vehículos (${vehicles.length})`], ['ordenes', `Órdenes (${orders.length})`], ['cotizaciones', `Cotizaciones (${quotes.length})`],
    ...(money ? [['ventas', `Ventas (${sales.length})`] as [Tab, string], ['pagos', `Pagos (${ledger.length})`] as [Tab, string]] : []), ['garantias', 'Garantías'], ['notas', 'Notas internas']]

  return (
    <div className="stack-lg">
      <div className="stack">
        <Link to="/clientes" className="small">← Clientes</Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>{c.name}</h1>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>{!c.active && <Badge tone="warn">Inactivo</Badge>}<Badge>Prefiere: {PREF[c.contactPref]}</Badge></div>
          </div>
          <div className="row wrap">
            {canEdit && <button className="btn" onClick={() => open({ k: 'customer', v: c })}>Editar</button>}
            {canEdit && !c.active && <button className="btn" disabled={busy} onClick={reactivate}>Reactivar</button>}
            {canEdit && <button className="btn danger" disabled={busy} onClick={remove}>Eliminar</button>}
          </div>
        </div>
        <div className="row wrap" role="group" aria-label="Contactar al cliente (no se envía nada automáticamente)">
          {tel ? <a className="btn" href={tel}>Llamar</a> : <button className="btn" disabled title="Sin teléfono válido">Llamar</button>}
          {wa ? <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a> : <button className="btn" disabled title="Se necesita un teléfono de 10 dígitos">WhatsApp</button>}
          {mail ? <a className="btn" href={mail}>Correo</a> : <button className="btn" disabled title="Sin correo registrado">Correo</button>}
        </div>
        <div className="small muted">Estos botones solo abren tu app de llamadas, WhatsApp o correo; Torque no envía mensajes por sí mismo.</div>
        <div className="row wrap" role="group" aria-label="Acciones">
          {data.can('ordenes.crear') && <button className="btn primary" onClick={() => open({ k: 'order', customerId: c.id })}>Nueva orden</button>}
          {data.can('cotizaciones.editar') && <button className="btn" onClick={() => open({ k: 'quote', customerId: c.id })}>Nueva cotización</button>}
          {data.can('vehiculos.editar') && <button className="btn" onClick={() => open({ k: 'vehicle', customerId: c.id })}>Nuevo vehículo</button>}
          {data.can('agenda.editar') && <button className="btn" onClick={() => open({ k: 'appointment', customerId: c.id })}>Agendar cita</button>}
        </div>
      </div>

      {money && (
        <section aria-label="Indicadores del cliente" className="crm-stats">
          <Stat label="Total histórico comprado" value={formatMXN(st.boughtCents)} hint={`${st.sales.length} venta(s) emitida(s) menos devoluciones, con IVA`} />
          <Stat label="Cobros netos recibidos" value={formatMXN(st.paidCents)} hint="Cobros menos reembolsos, incluye anticipos" />
          <Stat label="Saldo pendiente actual" value={formatMXN(st.balanceCents)} tone={st.balanceCents > 0 ? 'bad' : undefined} hint={st.balanceCents > 0 ? 'Lo que hoy debe el cliente' : 'Sin adeudo'} />
          <Stat label="Visitas" value={String(st.visits)} hint="Órdenes entregadas" />
          <Stat label="Última visita" value={fmtDate(st.lastVisit)} />
          <Stat label="Ticket promedio" value={st.avgTicketNetCents === null ? 'n/c' : formatMXN(st.avgTicketNetCents)} hint="Venta neta (sin IVA) ÷ ventas emitidas" />
        </section>
      )}
      {!money && <section className="grid"><Stat label="Visitas" value={String(st.visits)} hint="Órdenes entregadas" /><Stat label="Última visita" value={fmtDate(st.lastVisit)} /></section>}

      <section className="card" aria-label="Datos del cliente">
        <dl className="crm-infos">
          <Info label="Teléfono">{c.phone || '—'}</Info>
          <Info label="Correo">{c.email || '—'}</Info>
          <Info label="Dirección">{c.address || '—'}</Info>
          <Info label="RFC">{c.taxId || '—'}</Info>
          <Info label="Razón social fiscal">{c.fiscalName || '—'}</Info>
          <Info label="Domicilio fiscal">{c.fiscalAddress || '—'}</Info>
          <Info label="Cliente desde">{fmtDate(c.createdAt)}</Info>
        </dl>
      </section>

      <section className="stack" aria-label="Historial del cliente">
        <Tabs value={tab} tabs={tabs} onChange={setTab} label="Historial del cliente" />
        <TabPanel label={tabs.find((t) => t[0] === tab)?.[1] ?? ''}>
          {tab === 'vehiculos' && <VehiclesTab data={data} vehicles={vehicles} customerId={c.id} />}
          {tab === 'ordenes' && <OrdersTab data={data} orders={orders} />}
          {tab === 'cotizaciones' && <QuotesTab data={data} quotes={quotes} />}
          {tab === 'ventas' && money && <SalesTab data={data} sales={sales} />}
          {tab === 'pagos' && money && <PaymentsTab data={data} ledger={ledger} saleMap={saleMap} />}
          {tab === 'garantias' && <WarrantyTab data={data} orders={orders} vehicles={vehicles} />}
          {tab === 'notas' && <NotesTab c={c} canEdit={canEdit} />}
        </TabPanel>
      </section>
    </div>
  )
}

function VehiclesTab({ data, vehicles, customerId }: { data: Data; vehicles: Vehicle[]; customerId: string }) {
  const nav = useNavigate(), open = useOpen()
  const cols: Column<Vehicle>[] = [
    { key: 'v', label: 'Vehículo', primary: true, render: (v) => <span>{v.make} {v.model}{v.year ? ` ${v.year}` : ''}{!v.active && <> <Badge>Inactivo</Badge></>}</span> },
    { key: 'p', label: 'Placas', render: (v) => v.plate || '—' },
    { key: 'vin', label: 'VIN', hideMobile: true, render: (v) => v.vin || '—' },
    { key: 'km', label: 'Km', align: 'r', render: (v) => v.km.toLocaleString('es-MX') },
  ]
  return <DataTable rows={vehicles} columns={cols} rowKey={(v) => v.id} onRow={(v) => nav(`/vehiculos/${v.id}`)}
    empty={<Empty title="Sin vehículos registrados" text="Registra el vehículo del cliente para poder crear órdenes, cotizaciones y citas." action={data.can('vehiculos.editar') ? <button className="btn primary" onClick={() => open({ k: 'vehicle', customerId })}>Registrar vehículo</button> : undefined} />} />
}

function OrdersTab({ data, orders }: { data: Data; orders: WorkOrder[] }) {
  const nav = useNavigate()
  const cols: Column<WorkOrder>[] = [
    { key: 'f', label: 'Folio', primary: true, render: (o) => <span>{o.folio}{o.isWarranty && <> <Badge tone="info">Garantía</Badge></>}</span> },
    { key: 'd', label: 'Fecha', render: (o) => fmtDate(o.receivedAt) },
    { key: 'v', label: 'Vehículo', render: (o) => plateOf(data.vehMap.get(o.vehicleId)) },
    { key: 's', label: 'Estado', render: (o) => <Badge tone={o.status === 'entregada' ? 'ok' : o.status === 'cancelada' ? '' : 'info'}>{STATUS_LABEL[o.status]}</Badge> },
    { key: 't', label: 'Total', align: 'r', render: (o) => (o.isWarranty ? 'Garantía' : formatMXN(orderTotals(o, data.settings).totalCents)) },
  ]
  return <DataTable rows={orders} columns={cols} rowKey={(o) => o.id} onRow={(o) => nav(`/ordenes/${o.id}`)} empty={<Empty title="Sin órdenes" text="Las órdenes de trabajo de este cliente aparecerán aquí." />} />
}

function QuotesTab({ data, quotes }: { data: Data; quotes: Quotation[] }) {
  const nav = useNavigate()
  const cols: Column<Quotation>[] = [
    { key: 'f', label: 'Folio', primary: true, render: (q) => q.folio },
    { key: 'd', label: 'Fecha', render: (q) => fmtDate(q.issueDate) },
    { key: 'v', label: 'Vehículo', hideMobile: true, render: (q) => plateOf(data.vehMap.get(q.vehicleId)) },
    { key: 's', label: 'Estado', render: (q) => { const s = effStatus(q, data.today); return <Badge tone={QUOTE_TONE[s]}>{QUOTE_LABEL[s]}</Badge> } },
    { key: 't', label: 'Total', align: 'r', render: (q) => formatMXN(quoteTotals(q, data.settings).totalCents) },
  ]
  return <DataTable rows={quotes} columns={cols} rowKey={(q) => q.id} onRow={(q) => nav(`/cotizaciones/${q.id}`)} empty={<Empty title="Sin cotizaciones" text="Las cotizaciones de este cliente aparecerán aquí." />} />
}

function SalesTab({ data, sales }: { data: Data; sales: Sale[] }) {
  const nav = useNavigate()
  const idx = useMemo(() => indexLedger(data.ledger), [data.ledger])
  const cols: Column<Sale>[] = [
    { key: 'f', label: 'Folio', primary: true, render: (s) => <span>{s.folio}{s.status === 'cancelada' && <> <Badge>Cancelada</Badge></>}</span> },
    { key: 'd', label: 'Fecha', render: (s) => fmtDate(s.date) },
    { key: 't', label: 'Total', align: 'r', render: (s) => formatMXN(s.totalCents - saleReturnsTotal(s)) },
    { key: 'b', label: 'Saldo', align: 'r', render: (s) => { const b = balanceOf(s, idx); return b > 0 ? <span className="neg">{formatMXN(b)}</span> : formatMXN(0) } },
    { key: 's', label: 'Cobro', render: (s) => { const p = payStatus(s, entriesOf(s, idx)); return <Badge tone={PAY_TONE[p]}>{PAY_LABEL[p]}</Badge> } },
  ]
  return <DataTable rows={sales} columns={cols} rowKey={(s) => s.id} onRow={(s) => nav(`/ventas/${s.id}`)} empty={<Empty title="Sin ventas" text="Cuando se entregue una orden o se registre una venta a este cliente, aparecerá aquí." />} />
}

function PaymentsTab({ data, ledger, saleMap }: { data: Data; ledger: LedgerEntry[]; saleMap: Map<string, Sale> }) {
  const cols: Column<LedgerEntry>[] = [
    { key: 'd', label: 'Fecha', primary: true, render: (l) => fmtDate(l.date) },
    { key: 'k', label: 'Movimiento', render: (l) => LEDGER_LABEL[l.kind] ?? l.kind },
    { key: 'v', label: 'Aplicado a', render: (l) => { const s = l.saleId ? saleMap.get(l.saleId) : undefined; return s ? <Link to={`/ventas/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.folio}</Link> : l.workOrderId ? <span>Anticipo de orden {data.orderMap.get(l.workOrderId)?.folio ?? ''}</span> : '—' } },
    { key: 'm', label: 'Método', hideMobile: true, render: (l) => data.settings.paymentMethods.find((m) => m.id === l.methodId)?.name ?? l.methodId },
    { key: 'a', label: 'Importe', align: 'r', render: (l) => <span className={l.direction === 'in' ? 'pos' : 'neg'}>{l.direction === 'in' ? '+' : '−'}{formatMXN(l.amountCents)}</span> },
    { key: 'p', label: 'Comprobante', hideMobile: true, render: (l) => <a href={`#/imprimir/comprobante/${l.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Ver</a> },
  ]
  return <DataTable rows={ledger} columns={cols} rowKey={(l) => l.id} empty={<Empty title="Sin pagos registrados" text="Los cobros y anticipos de este cliente aparecerán aquí." />} />
}

function WarrantyTab({ data, orders, vehicles }: { data: Data; orders: WorkOrder[]; vehicles: Vehicle[] }) {
  const nav = useNavigate(), open = useOpen()
  const vids = new Set(vehicles.map((v) => v.id))
  const warrantyOrders = orders.filter((o) => o.isWarranty || (o.warrantyOfOrderId && vids.has(o.vehicleId)))
  const valid = orders.filter((o) => !o.isWarranty).map((o) => ({ o, w: warrantyInfo(o, data.settings, data.today) })).filter((x) => x.w?.active)
  const cols: Column<WorkOrder>[] = [
    { key: 'f', label: 'Orden de garantía', primary: true, render: (o) => o.folio },
    { key: 'd', label: 'Fecha', render: (o) => fmtDate(o.receivedAt) },
    { key: 'o', label: 'Garantía de', render: (o) => (o.warrantyOfOrderId ? data.orderMap.get(o.warrantyOfOrderId)?.folio ?? '—' : '—') },
    { key: 'v', label: 'Vehículo', hideMobile: true, render: (o) => plateOf(data.vehMap.get(o.vehicleId)) },
    { key: 's', label: 'Estado', render: (o) => STATUS_LABEL[o.status] },
  ]
  return (
    <div className="stack-lg">
      <div className="stack">
        <h3>Garantías vigentes</h3>
        <p className="small muted">Órdenes entregadas dentro de los {data.settings.warrantyDays} días de garantía configurados en Ajustes.</p>
        {valid.length ? valid.map(({ o, w }) => (
          <div key={o.id} className="item" style={{ cursor: 'default' }}>
            <div className="grow"><div className="ttl">{o.folio} · {plateOf(data.vehMap.get(o.vehicleId))}</div><div className="sub">Entregada {fmtDate(o.deliveredAt)} · vigente hasta {fmtDate(w!.until)}</div></div>
            <Link className="btn small" to={`/ordenes/${o.id}`}>Ver orden</Link>
            {data.can('ordenes.crear') && <button className="btn small" onClick={() => open({ k: 'warranty', orderId: o.id })}>Abrir garantía</button>}
          </div>
        )) : <div className="muted small">No hay garantías vigentes.</div>}
      </div>
      <div className="stack">
        <h3>Órdenes de garantía</h3>
        <DataTable rows={warrantyOrders} columns={cols} rowKey={(o) => o.id} onRow={(o) => nav(`/ordenes/${o.id}`)} empty={<div className="muted small">Este cliente no tiene órdenes de garantía.</div>} />
      </div>
    </div>
  )
}

function NotesTab({ c, canEdit }: { c: Customer; canEdit: boolean }) {
  const ctx = useCtx(), ui = useUi()
  const [text, setText] = useState(c.notes)
  const [busy, guard] = useBusy()
  const dirty = text.trim() !== c.notes.trim()
  const save = () => guard(() => ui.run(() => saveCustomer(ctx, asInput(c, { notes: text })), 'Notas guardadas'))
  return (
    <div className="stack">
      <div className="banner info">Estas notas son <b>solo para el personal</b>: nunca salen en cotizaciones, órdenes, ventas ni en ningún documento que se entrega al cliente.</div>
      <label className="f">Notas internas<textarea value={text} readOnly={!canEdit} onChange={(e) => setText(e.target.value)} placeholder="Preferencias, advertencias, acuerdos de pago…" style={{ minHeight: 140 }} /></label>
      {canEdit && <div className="row end"><button className="btn" disabled={!dirty || busy} onClick={() => setText(c.notes)}>Descartar cambios</button><button className="btn primary" disabled={!dirty || busy} onClick={save}>Guardar notas</button></div>}
    </div>
  )
}
