import { Link, useParams, useSearchParams } from 'react-router-dom'
import { saleBalance } from '../domain/finance'
import { formatMXN } from '../domain/money'
import { canTransition, nextStatuses, orderTotals, STATUS_LABEL } from '../domain/orders'
import type { OrderStatus, WorkOrder } from '../domain/types'
import { cancelOrder, changeStatus, updateOrder } from '../services/workorders'
import { useOpen } from '../ui/create'
import { fmtDate, fmtDateTime, plateOf, type Data } from '../ui/data'
import { FinanzasTab } from '../ui/orders/Finanzas'
import { HistorialTab } from '../ui/orders/Historial'
import { advancesOf, fmtSpan, isClosed, mechanicsOf, minutesInShop, printHref, promiseInfo, saleOfOrder, useNow } from '../ui/orders/helpers'
import { PartidasTab } from '../ui/orders/Partidas'
import { Row, PriorityBadge, StatusBadge } from '../ui/orders/parts'
import { ResumenTab } from '../ui/orders/Resumen'
import { TiemposTab } from '../ui/orders/Tiempos'
import { useCtx } from '../ui/session'
import { Badge, Empty, Field, Seg, useBusy, useUi } from '../ui/ui'

type Tab = 'resumen' | 'partidas' | 'tiempos' | 'finanzas' | 'historial'
const FLOW = ['Recepción', 'Diagnóstico', 'Autorización', 'Reparación', 'Pruebas', 'Lista', 'Entregada']
const STAGE: Record<OrderStatus, number> = { borrador: 0, espera_diagnostico: 0, en_diagnostico: 1, pendiente_autorizacion: 2, autorizada: 3, esperando_refacciones: 3, en_reparacion: 3, en_pruebas: 4, lista_entrega: 5, entregada: 6, cancelada: -1 }
const VERB: Partial<Record<OrderStatus, string>> = {
  espera_diagnostico: 'Poner en espera de diagnóstico', en_diagnostico: 'Iniciar diagnóstico', pendiente_autorizacion: 'Pedir autorización al cliente', autorizada: 'Marcar como autorizada',
  esperando_refacciones: 'Esperar refacciones', en_reparacion: 'Iniciar o reanudar reparación', en_pruebas: 'Pasar a pruebas', lista_entrega: 'Marcar lista para entrega',
}
const PRIMARY: Partial<Record<OrderStatus, OrderStatus>> = {
  borrador: 'en_diagnostico', espera_diagnostico: 'en_diagnostico', en_diagnostico: 'pendiente_autorizacion', autorizada: 'en_reparacion', esperando_refacciones: 'en_reparacion', en_reparacion: 'en_pruebas', en_pruebas: 'lista_entrega',
}

export function OrdenDetalle({ data }: { data: Data }) {
  const { id } = useParams()
  const [sp, setSp] = useSearchParams()
  const order = id ? data.orderMap.get(id) : undefined
  if (!order) {
    return <Empty title="Orden no encontrada" text="No existe o no está asignada a ti." action={<Link className="btn primary" to="/ordenes">Ir a órdenes de trabajo</Link>} />
  }
  const showMoney = data.can('ventas.ver') || data.can('costos.ver')
  const tabs: [Tab, string][] = [['resumen', 'Resumen'], ['partidas', `Partidas (${order.items.length})`], ['tiempos', 'Tiempos'], ...(showMoney ? [['finanzas', 'Finanzas'] as [Tab, string]] : []), ['historial', 'Historial']]
  const raw = sp.get('tab') as Tab | null
  const tab: Tab = raw && tabs.some(([t]) => t === raw) ? raw : 'resumen'
  return (
    <div className="stack-lg">
      <Header data={data} order={order} />
      <div className="stack">
        <Seg<Tab> label="Secciones de la orden" value={tab} options={tabs} onChange={(t) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })} />
        {tab === 'resumen' && <ResumenTab key={order.id} data={data} order={order} />}
        {tab === 'partidas' && <PartidasTab data={data} order={order} />}
        {tab === 'tiempos' && <TiemposTab data={data} order={order} />}
        {tab === 'finanzas' && showMoney && <FinanzasTab data={data} order={order} />}
        {tab === 'historial' && <HistorialTab data={data} order={order} />}
      </div>
    </div>
  )
}

function Header({ data, order }: { data: Data; order: WorkOrder }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const [, setSp] = useSearchParams()
  const now = useNow(60000)
  const cust = data.custMap.get(order.customerId), veh = data.vehMap.get(order.vehicleId)
  const closed = isClosed(order)
  const stage = STAGE[order.status]
  const prom = promiseInfo(order, now, data.today)
  const shop = minutesInShop(order, now)
  const t = orderTotals(order, data.settings)
  const sale = saleOfOrder(data, order)
  const canEdit = data.can('ordenes.editar') && !closed
  const pending = order.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado')
  const orig = order.warrantyOfOrderId ? data.orderMap.get(order.warrantyOfOrderId) : undefined
  const children = data.orders.filter((o) => o.warrantyOfOrderId === order.id)
  const lastAuth = order.authorizations[order.authorizations.length - 1]
  const goto = (tab: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('tab', tab); return n }, { replace: true })

  const move = (to: OrderStatus) => guard(async () => { await ui.run(() => changeStatus(ctx, order.id, to), `Orden en «${STATUS_LABEL[to]}»`) })
  const assign = (mechanicId: string) => guard(async () => { await ui.run(() => updateOrder(ctx, order.id, { mechanicId }), mechanicId ? 'Mecánico asignado' : 'Mecánico retirado') })

  const cancel = () => guard(async () => {
    const why = await ui.askReason(`Cancelar orden ${order.folio}`, 'Motivo de la cancelación', 'Cancelar orden')
    if (!why) return
    const adv = advancesOf(data.ledger, order.id)
    const consumed = order.items.filter((i) => i.consumedQty > 0)
    let refund = false
    if (adv > 0 || consumed.length) {
      const parts: string[] = []
      if (consumed.length) parts.push(`Las refacciones consumidas (${consumed.map((i) => i.description).join(', ')}) volverán al inventario con su costo original.`)
      if (adv > 0) parts.push(`La orden tiene anticipos por ${formatMXN(adv)}: cancelar exige reembolsarlos al cliente (se registrará una salida de dinero).`)
      const ok = await ui.confirm(`${parts.join(' ')} ¿Continuar con la cancelación?`, adv > 0 ? 'Reembolsar y cancelar' : 'Cancelar orden', true)
      if (!ok) return
      refund = adv > 0
    }
    await ui.run(() => cancelOrder(ctx, order.id, why, { refundAdvances: refund }), 'Orden cancelada')
  })

  const transitions = nextStatuses(order.status).filter((s) => s !== 'cancelada' && s !== 'entregada')
  const canDeliver = nextStatuses(order.status).includes('entregada') && data.can('ordenes.entregar')
  const deliverGuard = canDeliver ? canTransition(order, 'entregada') : undefined
  const cancelBlock = sale && sale.status === 'emitida' ? 'La orden tiene una venta emitida: cancélala primero desde la venta.' : ''
  const bal = sale && sale.status === 'emitida' ? saleBalance(sale, data.ledger) : null

  return (
    <div className="stack">
      <div className="card ord-head">
        <div className="row between wrap" style={{ alignItems: 'flex-start' }}>
          <div className="stack-sm">
            <div className="row wrap" style={{ gap: 8 }}>
              <Link to="/ordenes" className="small" aria-label="Volver a órdenes de trabajo">← Órdenes</Link>
            </div>
            <div className="row wrap" style={{ gap: 10 }}><h1>{order.folio}</h1><StatusBadge status={order.status} />{order.isWarranty && <Badge tone="warn">Garantía</Badge>}<PriorityBadge priority={order.priority} /></div>
            <div className="small muted">Recibida el {fmtDateTime(order.receivedAt)}{shop !== null && ` · ${closed ? 'Estuvo' : 'En taller'} ${fmtSpan(shop)}`}</div>
          </div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="small muted">Imprimir:</span>
            <a className="btn small" href={printHref('orden', order.id)} target="_blank" rel="noopener">Orden</a>
            <a className="btn small" href={printHref('recepcion', order.id)} target="_blank" rel="noopener">Hoja de recepción</a>
            {lastAuth && <a className="btn small" href={printHref('autorizacion', order.id, lastAuth.id)} target="_blank" rel="noopener">Autorización</a>}
            {order.status === 'entregada' && <a className="btn small" href={printHref('entrega', order.id)} target="_blank" rel="noopener">Entrega</a>}
            {(order.isWarranty || order.status === 'entregada') && <a className="btn small" href={printHref('garantia', order.id)} target="_blank" rel="noopener">Garantía</a>}
          </div>
        </div>

        <div className="ord-meta">
          <Row l="Cliente">{cust ? (data.can('clientes.ver') ? <Link to={`/clientes/${cust.id}`}>{cust.name}</Link> : cust.name) : '—'}{cust?.phone && <div className="small muted">{cust.phone}</div>}</Row>
          <Row l="Vehículo">{veh ? (data.can('vehiculos.ver') ? <Link to={`/vehiculos/${veh.id}`}>{plateOf(veh)}</Link> : plateOf(veh)) : '—'}</Row>
          <Row l="Mecánico">{order.mechanicId ? data.empMap.get(order.mechanicId)?.name ?? '—' : <span className="muted">Sin asignar</span>}</Row>
          <Row l="Fecha promesa">{prom ? (prom.overdue ? <span className="ord-overdue">{prom.text} · Vencida</span> : prom.text) : <span className="muted">Sin fecha</span>}</Row>
          {data.can('ventas.ver') && <Row l={sale ? 'Saldo de la venta' : 'Autorizado'}>{bal !== null ? (bal > 0 ? <span className="neg">{formatMXN(bal)}</span> : 'Pagada') : formatMXN(t.totalCents)}</Row>}
        </div>

        {stage >= 0 && (
          <ol className="ord-steps" aria-label="Avance del flujo">
            {FLOW.map((f, i) => <li key={f} className={i < stage ? 'done' : i === stage ? 'cur' : ''} aria-current={i === stage ? 'step' : undefined}>{f}<span className="sr-only">{i < stage ? ' (completada)' : i === stage ? ' (etapa actual)' : ' (pendiente)'}</span></li>)}
          </ol>
        )}

        {order.isWarranty && <div className="banner info">Orden de <b>garantía</b>{orig ? <> de <Link to={`/ordenes/${orig.id}`}>{orig.folio}</Link></> : ''}: el cliente no paga; el costo de lo que se use se registra como costo del taller.</div>}
        {order.status === 'cancelada' && <div className="banner bad" role="status"><b>Orden cancelada</b>{order.cancelReason ? `: ${order.cancelReason}` : '.'} Ya no se puede modificar.</div>}
        {order.status === 'pendiente_autorizacion' && <div className="banner" role="status">Esperando la autorización del cliente{t.pendingApprovalCents > 0 ? ` por ${formatMXN(t.pendingApprovalCents)} (con IVA)` : ''}.</div>}
        {order.status === 'esperando_refacciones' && <div className="banner" role="status">Esperando refacciones: el tiempo de espera se registra aparte de la mano de obra.</div>}
        {order.status === 'entregada' && order.deliveredAt && <div className="banner ok">Entregada el {fmtDateTime(order.deliveredAt)}{order.kmOut ? ` con ${order.kmOut.toLocaleString('es-MX')} km` : ''}.</div>}
        {children.length > 0 && <div className="banner info">Garantías abiertas sobre esta orden: {children.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link to={`/ordenes/${c.id}`}>{c.folio}</Link> ({STATUS_LABEL[c.status]})</span>)}.</div>}
      </div>

      {!closed && (
        <div className="card stack" aria-label="Acciones de la orden">
          <h3>Acciones</h3>
          <div className="row wrap">
            {data.can('ordenes.autorizar') && pending.length > 0 && <button className="btn primary" onClick={() => open({ k: 'authorize', orderId: order.id })}>Autorizar trabajos ({pending.length})</button>}
            {canDeliver && <button className="btn primary" disabled={!deliverGuard?.ok} onClick={() => open({ k: 'deliver', orderId: order.id })}>Entregar vehículo</button>}
            {canEdit && <button className="btn" onClick={() => { goto('partidas'); open({ k: 'item', orderId: order.id }) }}>Agregar partida</button>}
            {data.can('ordenes.cancelar') && <button className="btn danger" disabled={busy || !!cancelBlock} onClick={cancel}>Cancelar orden</button>}
          </div>
          {deliverGuard && !deliverGuard.ok && <div className="small neg" role="status">Entregar vehículo: {deliverGuard.reason}</div>}
          {cancelBlock && <div className="small neg" role="status">{cancelBlock}</div>}

          {canEdit && transitions.length > 0 && (
            <>
              <div className="small muted" style={{ fontWeight: 600 }}>Cambiar de estado</div>
              <div className="ord-trans">
                {transitions.map((s) => {
                  const g = canTransition(order, s)
                  const label = VERB[s] ?? `Regresar a «${STATUS_LABEL[s]}»`
                  return (
                    <div key={s}>
                      <button className={`btn block ${g.ok && PRIMARY[order.status] === s ? 'primary' : ''}`} disabled={busy || !g.ok} onClick={() => move(s)}>{label}</button>
                      {!g.ok && <span className="why" role="note">{g.reason}</span>}
                    </div>
                  )
                })}
              </div>
            </>
          )}
          {data.can('ordenes.crear') && (
            <div className="grid2" style={{ maxWidth: 520 }}>
              <Field label="Asignar mecánico"><select value={order.mechanicId ?? ''} disabled={busy} onChange={(e) => assign(e.target.value)}><option value="">Sin asignar</option>{mechanicsOf(data).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}{order.mechanicId && !mechanicsOf(data).some((m) => m.id === order.mechanicId) && <option value={order.mechanicId}>{data.empMap.get(order.mechanicId)?.name ?? 'Mecánico'}</option>}</select></Field>
            </div>
          )}
        </div>
      )}
      {order.status === 'entregada' && data.can('ordenes.crear') && (
        <div className="card row between wrap"><div><b>¿El cliente regresa con una falla?</b><div className="small muted">Abre una orden de garantía vinculada a esta; no se cobra, pero su costo queda registrado.</div></div><button className="btn" onClick={() => open({ k: 'warranty', orderId: order.id })}>Abrir garantía</button></div>
      )}
      {order.status === 'entregada' && sale && data.can('ventas.ver') && (
        <div className="small muted">Venta <Link to={`/ventas/${sale.id}`}>{sale.folio}</Link> del {fmtDate(sale.date)}.{' '}<button className="btn small ghost" onClick={() => goto('finanzas')}>Ver finanzas de la orden</button></div>
      )}
    </div>
  )
}
