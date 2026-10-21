import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { saleNetOfReturns, saleReturnsTotal } from '../domain/finance'
import { lineProfit } from '../domain/lines'
import { formatMXN, formatPct, formatQty } from '../domain/money'
import { orderEconomics, STATUS_LABEL, timeSummary, estimatedLabor } from '../domain/orders'
import type { Sale, Vehicle, WorkOrder } from '../domain/types'
import { removeVehicle, saveVehicle } from '../services/customers'
import { detectRecurrences, installedParts, isDoneService, isInstalledPart, warrantyInfo } from '../ui/crm/lib'
import { Info } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, plateOf, type Data } from '../ui/data'
import { useAttachments } from '../ui/image'
import { useCtx } from '../ui/session'
import { Badge, DataTable, Empty, Sheet, Stat, useBusy, useUi, type Column } from '../ui/ui'
import type { InstalledPart } from '../ui/crm/lib'

const FUEL: Record<string, string> = { gasolina: 'Gasolina', diesel: 'Diésel', hibrido: 'Híbrido', electrico: 'Eléctrico', gas: 'Gas', '': '—' }
const TRANS: Record<string, string> = { manual: 'Manual', automatica: 'Automática', '': '—' }

export function VehiculoFicha({ data }: { data: Data }) {
  const { id = '' } = useParams()
  const v = data.vehMap.get(id)
  if (!v) return <Empty title="Vehículo no encontrado" text="Puede que se haya borrado o que el enlace sea incorrecto." action={<Link className="btn" to="/vehiculos">Volver a vehículos</Link>} />
  return <Ficha key={v.id} data={data} v={v} />
}

function Ficha({ data, v }: { data: Data; v: Vehicle }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate(), open = useOpen()
  const [busy, guard] = useBusy()
  const [big, setBig] = useState<{ src: string; name: string } | null>(null)
  const tz = data.settings.timezone
  const [nowIso] = useState(() => new Date().toISOString())
  const owner = data.custMap.get(v.customerId)
  const photos = useAttachments(ctx, v.photoIds)
  const orders = useMemo(() => data.orders.filter((o) => o.vehicleId === v.id).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), [data.orders, v.id])
  const saleMap = useMemo(() => new Map(data.sales.map((s) => [s.id, s])), [data.sales])
  const recs = useMemo(() => detectRecurrences(orders, tz), [orders, tz])
  const flagged = useMemo(() => new Set(recs.flatMap((r) => r.orderIds)), [recs])
  const parts = useMemo(() => installedParts(orders, tz), [orders, tz])
  const live = orders.filter((o) => o.status !== 'cancelada')
  const lastIn = live[0]?.receivedAt
  const canEdit = data.can('vehiculos.editar')

  const remove = async () => {
    const ord = data.orders.filter((o) => o.vehicleId === v.id).length, quo = data.quotations.filter((q) => q.vehicleId === v.id).length
    const has = ord + quo > 0
    const msg = has
      ? `${plateOf(v)} tiene historial (${ord} orden(es), ${quo} cotización(es)), así que NO se borrará: se desactivará. Dejará de aparecer al elegir vehículo en formularios nuevos, pero su historial se conserva.`
      : `${plateOf(v)} no tiene órdenes ni cotizaciones, por lo que se borrará definitivamente. Esta acción no se puede deshacer.`
    if (!(await ui.confirm(msg, has ? 'Desactivar vehículo' : 'Borrar vehículo', true))) return
    const r = await guard(() => ui.run(() => removeVehicle(ctx, v.id)))
    if (r === 'borrado') { ui.toast('Vehículo borrado'); nav('/vehiculos') } else if (r === 'desactivado') ui.toast('Vehículo desactivado: su historial se conserva.')
  }
  const reactivate = () => guard(() => ui.run(() => saveVehicle(ctx, { id: v.id, customerId: v.customerId, make: v.make, model: v.model, year: v.year, version: v.version, plate: v.plate, vin: v.vin, km: v.km, fuel: v.fuel, transmission: v.transmission, color: v.color, engineNo: v.engineNo, notes: v.notes, active: true }), 'Vehículo reactivado'))

  const partCols: Column<InstalledPart>[] = [
    { key: 'p', label: 'Refacción', primary: true, render: (p) => p.label },
    { key: 'q', label: 'Cantidad total', align: 'r', render: (p) => `${formatQty(p.qty)} ${p.unit}` },
    { key: 't', label: 'Veces', align: 'r', render: (p) => <span>{p.times}{p.times >= 2 && <> <Badge tone="warn">Repetida</Badge></>}</span> },
    { key: 'l', label: 'Última vez', render: (p) => fmtDate(p.last) },
  ]

  return (
    <div className="stack-lg">
      <div className="stack">
        <Link to="/vehiculos" className="small">← Vehículos</Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>{v.make} {v.model}{v.year ? ` ${v.year}` : ''}</h1>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              <Badge tone="info">{v.plate || 'Sin placas'}</Badge>{!v.active && <Badge tone="warn">Inactivo</Badge>}
              {owner && <span className="small">Propietario: <Link to={`/clientes/${owner.id}`}>{owner.name}</Link></span>}
            </div>
          </div>
          <div className="row wrap">
            {canEdit && <button className="btn" onClick={() => open({ k: 'vehicle', v })}>Editar</button>}
            {canEdit && !v.active && <button className="btn" disabled={busy} onClick={reactivate}>Reactivar</button>}
            {canEdit && <button className="btn danger" disabled={busy} onClick={remove}>Eliminar</button>}
          </div>
        </div>
        <div className="row wrap" role="group" aria-label="Acciones">
          {data.can('ordenes.crear') && <button className="btn primary" onClick={() => open({ k: 'order', customerId: v.customerId, vehicleId: v.id })}>Nueva orden</button>}
          {data.can('cotizaciones.editar') && <button className="btn" onClick={() => open({ k: 'quote', customerId: v.customerId, vehicleId: v.id })}>Nueva cotización</button>}
          {data.can('agenda.editar') && <button className="btn" onClick={() => open({ k: 'appointment', customerId: v.customerId, vehicleId: v.id })}>Agendar cita</button>}
        </div>
      </div>

      {recs.length > 0 && (
        <div className="banner" role="alert" aria-label="Posible recurrencia de falla">
          <b>Posible recurrencia de falla.</b> Revisa el historial antes de cotizar: estas coincidencias pueden indicar una falla que regresa (o ser mantenimiento programado; confírmalo con el mecánico).
          <ul className="crm-ul">{recs.map((r) => <li key={r.kind + r.label}><b>{r.label}</b>: {r.detail}</li>)}</ul>
        </div>
      )}

      <section className="grid" aria-label="Resumen del vehículo">
        <Stat label="Intervenciones" value={String(live.length)} hint="Órdenes no canceladas" />
        <Stat label="Última entrada al taller" value={fmtDate(lastIn)} />
        <Stat label="Kilometraje actual" value={`${v.km.toLocaleString('es-MX')} km`} />
        <Stat label="Posibles recurrencias" value={String(recs.length)} tone={recs.length ? 'bad' : undefined} hint={recs.length ? 'Ver aviso arriba' : 'Sin coincidencias'} />
      </section>

      <section className="card" aria-label="Datos del vehículo">
        <dl className="crm-infos">
          <Info label="Placas">{v.plate || '—'}</Info><Info label="VIN">{v.vin || '—'}</Info><Info label="Versión">{v.version || '—'}</Info>
          <Info label="Color">{v.color || '—'}</Info><Info label="Combustible">{FUEL[v.fuel]}</Info><Info label="Transmisión">{TRANS[v.transmission]}</Info>
          <Info label="Número de motor">{v.engineNo || '—'}</Info><Info label="Observaciones">{v.notes || '—'}</Info>
        </dl>
        {photos.length > 0 && (
          <div className="crm-photos" style={{ marginTop: 12 }}>
            {photos.map((p) => <button key={p.id} type="button" className="crm-photo btn ghost" style={{ padding: 0 }} aria-label={`Ampliar foto ${p.name}`} onClick={() => setBig({ src: p.dataUrl, name: p.name })}><img src={p.dataUrl} alt={`Foto del vehículo: ${p.name}`} loading="lazy" /></button>)}
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="vh-hist">
        <h2 id="vh-hist">Historial de intervenciones</h2>
        {orders.length === 0 && <Empty title="Sin intervenciones" text="Cuando se abra una orden para este vehículo, su historial aparecerá aquí." />}
        <ol className="tl crm-hist">
          {orders.map((o) => <li key={o.id}><Intervention data={data} o={o} saleMap={saleMap} flagged={flagged.has(o.id)} nowIso={nowIso} /></li>)}
        </ol>
      </section>

      <section className="stack" aria-labelledby="vh-parts">
        <h2 id="vh-parts">Piezas instaladas anteriormente</h2>
        <DataTable rows={parts} columns={partCols} rowKey={(p) => p.key} empty={<div className="muted small">Aún no hay refacciones instaladas registradas para este vehículo.</div>} />
      </section>
      {big && <Sheet title={big.name} onClose={() => setBig(null)}><img src={big.src} alt={`Foto ampliada: ${big.name}`} style={{ width: '100%', borderRadius: 8 }} /></Sheet>}
    </div>
  )
}

function Intervention({ data, o, saleMap, flagged, nowIso }: { data: Data; o: WorkOrder; saleMap: Map<string, Sale>; flagged: boolean; nowIso: string }) {
  const s = data.settings
  const sale = o.saleId ? saleMap.get(o.saleId) : undefined
  const done = o.items.filter(isDoneService)
  const planned = o.status !== 'entregada' && o.status !== 'cancelada' ? o.items.filter((i) => i.status === 'autorizado' && (i.type === 'servicio' || i.type === 'externo')) : []
  const installed = o.items.filter(isInstalledPart)
  const consumables = o.items.filter((i) => (i.type === 'consumible' || i.type === 'otro') && (i.consumedQty > 0 || i.status === 'ejecutado'))
  const w = warrantyInfo(o, s, data.today)
  const mech = o.mechanicId ? data.empMap.get(o.mechanicId)?.name : undefined
  const showMoney = data.can('ventas.ver'), showCost = data.can('costos.ver')
  let econ: { cost: number; net: number; profit: number; margin: number | null; provisional: boolean } | null = null
  if (showCost && o.status !== 'cancelada') {
    if (sale && sale.status === 'emitida') {
      const cost = sale.costCents - sale.returns.reduce((a, r) => a + r.costRecoveredCents, 0), net = saleNetOfReturns(sale), lp = lineProfit(net, cost)
      econ = { cost, net, profit: lp.profitCents, margin: lp.marginPct, provisional: false }
    } else if (!sale && !o.isWarranty) {
      const e = orderEconomics(o, s, timeSummary(o, nowIso).laborCostCents, estimatedLabor(o, data.employees, s))
      econ = { cost: e.directCostCents, net: e.netCents, profit: e.profitCents, margin: e.marginPct, provisional: true }
    } else if (!sale && o.isWarranty) {
      const e = orderEconomics(o, s, timeSummary(o, nowIso).laborCostCents, estimatedLabor(o, data.employees, s))
      econ = { cost: e.directCostCents, net: 0, profit: -e.directCostCents, margin: null, provisional: e.provisional }
    }
  }
  return (
    <article className="card stack-sm" aria-label={`Orden ${o.folio}`}>
      <div className="row between wrap">
        <div className="row wrap" style={{ gap: 6 }}>
          <Link to={`/ordenes/${o.id}`}><b>{o.folio}</b></Link>
          <Badge tone={o.status === 'entregada' ? 'ok' : o.status === 'cancelada' ? '' : 'info'}>{STATUS_LABEL[o.status]}</Badge>
          {o.isWarranty && <Badge tone="info">Garantía</Badge>}
          {flagged && <Badge tone="warn">Posible recurrencia de falla</Badge>}
        </div>
        <span className="small muted">Entrada: {fmtDate(o.receivedAt)}</span>
      </div>
      <dl className="crm-infos">
        <Info label="Kilometraje">{o.km.toLocaleString('es-MX')} km{o.kmOut ? ` → ${o.kmOut.toLocaleString('es-MX')} km a la salida` : ''}</Info>
        <Info label="Mecánico">{mech ?? '—'}</Info>
        <Info label="Síntoma reportado">{[o.complaint, o.symptoms].filter(Boolean).join(' · ') || '—'}</Info>
        <Info label="Diagnóstico">{o.diagnosis || '—'}</Info>
        <Info label="Trabajos realizados">{done.length ? <ul className="crm-ul">{done.map((i) => <li key={i.id}>{i.description}{i.qty !== 1 ? ` × ${formatQty(i.qty)}` : ''}</li>)}</ul> : '—'}{planned.length > 0 && <div className="small muted">Autorizados, pendientes: {planned.map((i) => i.description).join(', ')}</div>}</Info>
        <Info label="Refacciones instaladas">{installed.length ? <ul className="crm-ul">{installed.map((i) => <li key={i.id}>{formatQty(i.consumedQty > 0 ? i.consumedQty : i.qty)} {i.unit} · {i.description}</li>)}</ul> : '—'}</Info>
        <Info label="Consumibles">{consumables.length ? <ul className="crm-ul">{consumables.map((i) => <li key={i.id}>{formatQty(i.consumedQty > 0 ? i.consumedQty : i.qty)} {i.unit} · {i.description}</li>)}</ul> : '—'}</Info>
        <Info label="Fecha de entrega">{o.deliveredAt ? fmtDate(o.deliveredAt) : o.status === 'cancelada' ? 'Cancelada' : 'Aún sin entregar'}</Info>
        <Info label="Garantía aplicable">{o.isWarranty ? 'Orden de garantía: sin cargo al cliente' : w ? (w.active ? <Badge tone="ok">Vigente hasta {fmtDate(w.until)}</Badge> : <Badge>Venció el {fmtDate(w.until)}</Badge>) : o.status === 'entregada' ? 'Sin garantía configurada' : '—'}</Info>
        {showMoney && <Info label="Precio cobrado">{sale ? <span>{formatMXN(sale.totalCents - saleReturnsTotal(sale))} con IVA · <Link to={`/ventas/${sale.id}`}>{sale.folio}</Link>{sale.status === 'cancelada' && ' (cancelada)'}</span> : o.isWarranty ? 'Sin cargo (garantía)' : 'Aún sin venta'}</Info>}
        {econ && <Info label="Costo y utilidad (interno)"><span className="num">Costo {formatMXN(econ.cost)} · Utilidad {formatMXN(econ.profit)} · Margen {formatPct(econ.margin)}</span>{econ.provisional && <div className="small muted">Provisional: la orden sigue abierta o faltan tiempos/costos.</div>}<div className="small muted">Uso interno: no aparece en documentos del cliente.</div></Info>}
      </dl>
    </article>
  )
}
