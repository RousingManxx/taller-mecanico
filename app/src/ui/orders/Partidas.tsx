import { useState } from 'react'
import { priceAlert, PRICE_ALERT_TEXT, taxRateOf } from '../../domain/alerts'
import { payStatus, PAY_LABEL } from '../../domain/finance'
import { lineAmounts } from '../../domain/lines'
import { formatMXN, formatPct, formatQty } from '../../domain/money'
import { canTransition, ITEM_STATUS_LABEL, ITEM_TYPE_LABEL, orderTotals, STATUS_LABEL } from '../../domain/orders'
import { marginPct } from '../../domain/pricing'
import type { WorkItem, WorkOrder } from '../../domain/types'
import { changeStatus, completeItem, consumeItem, rejectItems, removeItem, reopenItem, returnItemToStock, updateItem } from '../../services/workorders'
import { useOpen } from '../create'
import { fmtDate, fmtDateTime, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Field, MoneyInput, NumInput, Sheet, useBusy, useOpKey, useUi } from '../ui'
import { isClosed, isTrackable, ITEM_TONE, remainingQty, saleOfOrder, stockQty, unitCostOf, VIA_LABEL } from './helpers'

type Dlg = { k: 'edit' | 'consume' | 'return' | 'complete'; id: string } | null
const EPS = 1e-9

export function PartidasTab({ data, order }: { data: Data; order: WorkOrder }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [dlg, setDlg] = useState<Dlg>(null)
  const s = data.settings
  const costs = data.can('costos.ver')
  const money = data.can('ventas.ver')
  const frozen = isClosed(order)
  const canEdit = data.can('ordenes.editar') && !frozen
  const canAuth = data.can('ordenes.autorizar') && !frozen
  const canCons = data.can('ordenes.consumir') && !frozen
  const t = orderTotals(order, s)
  const pending = order.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado')
  const sale = saleOfOrder(data, order)
  const salePay = sale && sale.status === 'emitida' ? payStatus(sale, data.ledger) : undefined
  const dlgItem = dlg ? order.items.find((i) => i.id === dlg.id) : undefined

  const reject = async (i: WorkItem) => {
    const why = await ui.askReason('Rechazar partida', `Motivo por el que se rechaza «${i.description}»`, 'Rechazar')
    if (why) await ui.run(() => rejectItems(ctx, order.id, [i.id], why), 'Partida rechazada')
  }
  const remove = async (i: WorkItem) => {
    if (await ui.confirm(`¿Quitar «${i.description}» de la orden?`, 'Quitar partida', true)) await ui.run(() => removeItem(ctx, order.id, i.id), 'Partida quitada')
  }
  const reopen = async (i: WorkItem) => {
    if (await ui.confirm(`«${i.description}» volverá a estar autorizada pero pendiente de ejecutar.`, 'Deshacer ejecución')) await ui.run(() => reopenItem(ctx, order.id, i.id), 'Ejecución deshecha')
  }
  const complete = (i: WorkItem) => (i.type === 'externo' ? setDlg({ k: 'complete', id: i.id }) : void ui.run(() => completeItem(ctx, order.id, i.id), 'Partida marcada como ejecutada'))

  /** Costo atribuible a la partida con datos observados; null = no calculable todavía. */
  const costOf = (i: WorkItem): { cents: number | null; est: boolean; why?: string } => {
    if (isTrackable(i)) {
      if (i.consumedQty > EPS) {
        if (remainingQty(i) <= EPS) return { cents: i.costCents, est: false }
        return { cents: Math.round((i.costCents / i.consumedQty) * i.qty), est: true, why: 'Parte consumida a costo real; el resto estimado con el costo promedio.' }
      }
      const p = i.refId ? data.prodMap.get(i.refId) : undefined
      const u = p ? unitCostOf(data, p) : 0
      return u > 0 ? { cents: Math.round(u * i.qty), est: true, why: 'Estimado con el costo promedio actual; el real se fija al consumir.' } : { cents: null, est: false, why: 'Sin costo registrado.' }
    }
    if (i.type === 'servicio') {
      const linked = order.timeEntries.filter((e) => e.kind === 'trabajo' && e.itemId === i.id)
      if (!linked.length) return { cents: null, est: false, why: 'Sin tiempo ligado a esta partida: el costo de mano de obra se calcula a nivel orden.' }
      const c = linked.reduce((a, e) => a + (e.endAt ? e.costCents : Math.round(((Date.now() - new Date(e.startAt).getTime()) / 3600000) * e.hourlyCostCents)), 0)
      return { cents: c, est: false, why: 'Mano de obra de los tiempos ligados a esta partida.' }
    }
    if (i.type === 'externo') return i.status === 'ejecutado' ? { cents: i.costCents, est: false } : { cents: null, est: false, why: 'El costo real se captura al marcar como ejecutada.' }
    return { cents: null, est: false, why: 'Este cargo no tiene costo capturado.' }
  }

  if (!order.items.length) {
    return (
      <div className="card"><div className="empty"><h3>Esta orden aún no tiene partidas</h3><p>Agrega servicios, refacciones, consumibles o cargos. Nada se cobra hasta que el cliente lo autorice.</p>
        {canEdit && <button className="btn primary" onClick={() => open({ k: 'item', orderId: order.id })}>Agregar partida</button>}</div></div>
    )
  }

  return (
    <div className="stack-lg">
      <div className="row wrap">
        {canEdit && <button className="btn primary" onClick={() => open({ k: 'item', orderId: order.id })}>Agregar partida</button>}
        {canAuth && pending.length > 0 && <button className="btn" onClick={() => open({ k: 'authorize', orderId: order.id })}>Autorizar trabajos ({pending.length})</button>}
        <span className="small muted grow">Sugerido → Cotizado → Autorizado → Ejecutado. Solo lo autorizado y ejecutado se cobra.</span>
      </div>

      <div className="cols-main stack-lg">
        <div className="stack" aria-label="Partidas de la orden" role="list">
          {order.items.map((i) => {
            const a = lineAmounts(i, s.pricesIncludeTax)
            const p = i.refId ? data.prodMap.get(i.refId) : undefined
            const stock = isTrackable(i) ? stockQty(data, i.refId) : 0
            const rem = remainingQty(i)
            const c = costs && i.status !== 'rechazado' ? costOf(i) : null
            const profit = c?.cents != null ? a.netCents - c.cents : null
            const eff = i.qty > 0 ? Math.round((i.qty * i.unitPriceCents - i.discountCents) / i.qty) : i.unitPriceCents
            const unitCost = p ? unitCostOf(data, p) : 0
            const alert = costs && isTrackable(i) && p && unitCost > 0 && i.status !== 'rechazado' ? priceAlert(eff, unitCost, i.taxRate, s, p.minMarginPct) : null
            const lastAuth = i.authorizedAt ? `${i.authorizedBy ?? '—'} · ${fmtDate(i.authorizedAt)}` : ''
            const billed = !!sale && sale.status === 'emitida' && (i.status === 'autorizado' || i.status === 'ejecutado')
            return (
              <div key={i.id} role="listitem" className={`ord-line ${i.status === 'rechazado' ? 'rej' : ''}`}>
                <div className="top">
                  <div className="grow">
                    <div className="small muted">{ITEM_TYPE_LABEL[i.type]}{i.stdHours > 0 && ` · ${i.stdHours} h estándar`}</div>
                    <div className="desc">{i.description}</div>
                  </div>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Badge tone={ITEM_TONE[i.status]}>{ITEM_STATUS_LABEL[i.status]}</Badge>
                    {billed && <Badge tone={salePay === 'pagada' ? 'ok' : 'info'}>{salePay === 'pagada' ? 'Cobrada' : 'Facturada'}</Badge>}
                  </div>
                </div>
                <div className="nums">
                  <div><span className="l">Cantidad</span>{formatQty(i.qty)} {i.unit}</div>
                  <div><span className="l">Precio unitario</span>{formatMXN(i.unitPriceCents)}</div>
                  <div><span className="l">Descuento</span>{i.discountCents > 0 ? formatMXN(i.discountCents) : '—'}</div>
                  <div><span className="l">Neto (antes de IVA)</span><b>{formatMXN(a.netCents)}</b></div>
                  <div><span className="l">Total con IVA</span><b>{formatMXN(a.totalCents)}</b></div>
                </div>
                {isTrackable(i) && (
                  <div className="info">
                    Existencias: <b>{formatQty(stock)} {i.unit}</b> · Consumido: <b>{formatQty(i.consumedQty)} de {formatQty(i.qty)}</b>
                    {i.status === 'autorizado' && rem > stock + EPS && <span className="neg"> · Faltan existencias: se necesitan {formatQty(rem)} y hay {formatQty(stock)}.</span>}
                  </div>
                )}
                {lastAuth && <div className="info">Autorizado por {lastAuth}</div>}
                {i.note && <div className="info">Nota: {i.note}</div>}
                {c && (
                  <div className="info" aria-label="Costo y utilidad de la partida">
                    {c.cents === null
                      ? <>Costo: <b>n/c</b> · Utilidad: <b>n/c</b> · Margen: <b>n/c</b>{c.why && <> — {c.why}</>}</>
                      : <>Costo{c.est ? ' (estimado)' : ''}: <b>{formatMXN(c.cents)}</b> · Utilidad: <b className={profit! < 0 ? 'neg' : ''}>{formatMXN(profit!)}</b> · Margen: <b className={profit! < 0 ? 'neg' : ''}>{formatPct(marginPct(a.netCents, c.cents))}</b>{c.why && <> — {c.why}</>}</>}
                  </div>
                )}
                {alert && alert.kind && alert.kind !== 'sin_costo' && <div><Badge tone={alert.kind === 'bajo_costo' ? 'bad' : 'warn'}>{PRICE_ALERT_TEXT[alert.kind]}{alert.kind === 'margen_bajo' && ` (${formatPct(alert.marginPct)} vs mínimo ${formatPct(alert.minMarginPct)})`}</Badge></div>}
                {!frozen && (
                  <div className="acts">
                    {canAuth && (i.status === 'sugerido' || i.status === 'cotizado') && <button className="btn small primary" onClick={() => open({ k: 'authorize', orderId: order.id, itemIds: [i.id] })}>Autorizar</button>}
                    {canAuth && (i.status === 'sugerido' || i.status === 'cotizado') && <button className="btn small" onClick={() => reject(i)}>Rechazar</button>}
                    {canCons && isTrackable(i) && i.status === 'autorizado' && rem > EPS && <button className="btn small primary" onClick={() => setDlg({ k: 'consume', id: i.id })}>Consumir del inventario</button>}
                    {canCons && isTrackable(i) && i.consumedQty > EPS && !order.saleId && <button className="btn small" onClick={() => setDlg({ k: 'return', id: i.id })}>Devolver al inventario</button>}
                    {canEdit && !isTrackable(i) && i.status === 'autorizado' && <button className="btn small primary" onClick={() => complete(i)}>Marcar ejecutado</button>}
                    {canEdit && !isTrackable(i) && i.status === 'ejecutado' && !order.saleId && <button className="btn small" onClick={() => reopen(i)}>Deshacer ejecución</button>}
                    {canEdit && i.status !== 'ejecutado' && <button className="btn small" onClick={() => setDlg({ k: 'edit', id: i.id })}>Editar</button>}
                    {canEdit && i.status !== 'ejecutado' && <button className="btn small danger" onClick={() => remove(i)}>Quitar</button>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <aside className="stack" aria-label="Totales y autorizaciones">
          {money && <div className="card stack-sm">
            <h3>Totales de la orden</h3>
            <div className="ord-totals">
              {(['servicio', 'refaccion', 'consumible', 'externo', 'otro'] as const).filter((k) => t.byType[k] !== 0).map((k) => <div key={k}><span className="muted">{ITEM_TYPE_LABEL[k]}</span><span className="num">{formatMXN(t.byType[k])}</span></div>)}
              <div><span>Neto (antes de IVA)</span><b className="num">{formatMXN(t.netCents)}</b></div>
              <div><span>IVA</span><span className="num">{formatMXN(t.taxCents)}</span></div>
              <div className="big"><span>Total autorizado</span><span className="num">{formatMXN(t.totalCents)}</span></div>
              <div><span className={t.pendingApprovalCents > 0 ? '' : 'muted'}>Pendiente de aprobación</span><b className="num">{formatMXN(t.pendingApprovalCents)}</b></div>
            </div>
            <p className="small muted">«Total autorizado» suma las partidas autorizadas y ejecutadas. «Pendiente de aprobación» (sugeridas y cotizadas) no se cobra hasta que el cliente las autorice.</p>
            {sale && <p className="small">Venta {sale.folio}{salePay ? ` · ${PAY_LABEL[salePay]}` : ''}.</p>}
          </div>}
          <div className="card stack-sm">
            <h3>Historial de autorizaciones</h3>
            {!order.authorizations.length && <p className="small muted">Todavía no hay autorizaciones registradas.</p>}
            <ol className="tl" aria-label="Autorizaciones">
              {[...order.authorizations].reverse().map((x) => {
                const q = x.quotationId ? data.quotations.find((z) => z.id === x.quotationId) : undefined
                return (
                  <li key={x.id}>
                    <div><b>{x.approvedBy}</b>{money && <> · {formatMXN(x.amountCents)} <span className="muted">(con IVA)</span></>}</div>
                    <div className="small muted">{fmtDateTime(x.at)} · {VIA_LABEL[x.via]} · {x.itemIds.length} partida(s){q && ` · ${q.folio} v${x.quotationVersion ?? '—'}`}</div>
                    <div className="small muted">{x.itemIds.map((id) => order.items.find((z) => z.id === id)?.description ?? 'Partida eliminada').join(', ')}</div>
                    {x.notes && <div className="small">{x.notes}</div>}
                  </li>
                )
              })}
            </ol>
          </div>
        </aside>
      </div>

      {dlg?.k === 'edit' && dlgItem && <EditItemSheet key={dlg.id} data={data} order={order} item={dlgItem} onClose={() => setDlg(null)} />}
      {dlg?.k === 'consume' && dlgItem && <ConsumeSheet key={dlg.id} data={data} order={order} item={dlgItem} onClose={() => setDlg(null)} />}
      {dlg?.k === 'return' && dlgItem && <ReturnStockSheet key={dlg.id} order={order} item={dlgItem} onClose={() => setDlg(null)} />}
      {dlg?.k === 'complete' && dlgItem && <ExternalCostSheet key={dlg.id} order={order} item={dlgItem} costs={costs} onClose={() => setDlg(null)} />}
    </div>
  )
}

/* ───────── Editar cantidad, precio y descuento ───────── */
function EditItemSheet({ data, order, item, onClose }: { data: Data; order: WorkOrder; item: WorkItem; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [desc, setDesc] = useState(item.description)
  const [qty, setQty] = useState<number | undefined>(item.qty)
  const [price, setPrice] = useState<number | undefined>(item.unitPriceCents)
  const [disc, setDisc] = useState<number | undefined>(item.discountCents)
  const w = order.isWarranty
  const q = qty ?? 0, pr = w ? 0 : price ?? 0, di = w ? 0 : disc ?? 0
  const money = q !== item.qty || pr !== item.unitPriceCents || di !== item.discountCents
  const am = lineAmounts({ qty: q, unitPriceCents: pr, discountCents: di, taxRate: item.taxRate ?? taxRateOf(data.settings, data.settings.defaultTaxId) }, data.settings.pricesIncludeTax)
  const err = !(q > 0) ? 'La cantidad debe ser mayor que cero.' : q < item.consumedQty - EPS ? `Ya se consumieron ${formatQty(item.consumedQty)}: devuelve al inventario antes de reducir la cantidad.` : price === undefined && !w ? 'Captura el precio.' : di < 0 || di > Math.round(q * pr) ? 'El descuento no puede ser negativo ni mayor al importe.' : ''
  const save = () => guard(async () => {
    if (err) { ui.toast(err, true); return }
    const r = await ui.run(async () => { await updateItem(ctx, order.id, item.id, { description: desc, qty: q, unitPriceCents: pr, discountCents: di }); return true }, money && item.status === 'autorizado' ? 'Partida actualizada: requiere nueva autorización' : 'Partida actualizada')
    if (r) onClose()
  })
  return (
    <Sheet title="Editar partida" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <div className="small muted">{ITEM_TYPE_LABEL[item.type]} · {STATUS_LABEL[order.status]}</div>
        {money && item.status === 'autorizado' && <div className="banner" role="alert">Esta partida ya está autorizada. Si cambias cantidad, precio o descuento volverá a «Cotizado» y necesitará una nueva autorización del cliente antes de cobrarse o ejecutarse.</div>}
        {w && <div className="banner info">Orden de garantía: precio y descuento se mantienen en $0.</div>}
        <Field label="Descripción"><input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <div className="ord-form-grid">
          <Field label="Cantidad"><NumInput value={qty} onChange={setQty} invalid={!(q > 0)} /></Field>
          <Field label={`Precio unitario ${data.settings.pricesIncludeTax ? '(incluye IVA)' : '(sin IVA)'}`}><MoneyInput cents={w ? 0 : price} onChange={setPrice} disabled={w} /></Field>
          <Field label="Descuento (importe)"><MoneyInput cents={w ? 0 : disc} onChange={setDisc} disabled={w} /></Field>
        </div>
        {err && <div className="err" role="alert">{err}</div>}
        <div className="card flat ord-totals" aria-live="polite">
          <div><span>Neto (antes de IVA)</span><b className="num">{formatMXN(am.netCents)}</b></div>
          <div><span>IVA ({item.taxRate} %)</span><span className="num">{formatMXN(am.taxCents)}</span></div>
          <div className="big"><span>Total</span><span className="num">{formatMXN(am.totalCents)}</span></div>
        </div>
      </div>
    </Sheet>
  )
}

/* ───────── Consumir refacción ───────── */
function ConsumeSheet({ data, order, item, onClose }: { data: Data; order: WorkOrder; item: WorkItem; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const opKey = useOpKey()
  const [busy, guard] = useBusy()
  const rem = remainingQty(item)
  const stock = stockQty(data, item.refId)
  const [qty, setQty] = useState<number | undefined>(rem)
  const [failed, setFailed] = useState(false)
  const q = qty ?? 0
  const short = q > stock + EPS
  const canWait = data.can('ordenes.editar') && order.status !== 'esperando_refacciones' && canTransition(order, 'esperando_refacciones').ok
  const err = !(q > 0) ? 'La cantidad debe ser mayor que cero.' : q > rem + EPS ? `Solo faltan ${formatQty(rem)} por consumir en esta partida.` : ''
  const save = () => guard(async () => {
    if (err) { ui.toast(err, true); return }
    const r = await ui.run(() => consumeItem(ctx, order.id, item.id, q, opKey), 'Refacción consumida del inventario')
    if (r) onClose(); else setFailed(true)
  })
  const wait = () => guard(async () => {
    const r = await ui.run(() => changeStatus(ctx, order.id, 'esperando_refacciones', `Falta inventario de ${item.description}`), 'La orden quedó en espera de refacciones')
    if (r) onClose()
  })
  return (
    <Sheet title="Consumir refacción" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Consumir del inventario</button></>}>
      <div className="stack">
        <div><b>{item.description}</b><div className="small muted">Pendiente por consumir: {formatQty(rem)} de {formatQty(item.qty)} {item.unit} · Existencias: {formatQty(stock)} {item.unit}</div></div>
        <Field label={`Cantidad a consumir (${item.unit})`} error={err} hint="Puedes consumir una parte ahora y el resto después."><NumInput value={qty} onChange={setQty} invalid={!!err} /></Field>
        {(short || failed) && stock + EPS < q && (
          <div className="banner" role="alert">
            Existencias insuficientes: hay {formatQty(stock)} y se necesitan {formatQty(q)} {item.unit}. Recibe una compra o ajusta el inventario, o consume solo lo disponible.
            {canWait && <div style={{ marginTop: 8 }}><button type="button" className="btn small" disabled={busy} onClick={wait}>Pasar la orden a «Esperando refacciones»</button></div>}
          </div>
        )}
        <p className="small muted">La salida se valúa al costo promedio vigente y ese costo queda congelado en la partida. Al consumir todo, la partida pasa a «Ejecutado».</p>
      </div>
    </Sheet>
  )
}

/* ───────── Devolver al inventario ───────── */
function ReturnStockSheet({ order, item, onClose }: { order: WorkOrder; item: WorkItem; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [qty, setQty] = useState<number | undefined>(item.consumedQty)
  const [why, setWhy] = useState('')
  const [tried, setTried] = useState(false)
  const q = qty ?? 0
  const err = !(q > 0) ? 'La cantidad debe ser mayor que cero.' : q > item.consumedQty + EPS ? `Solo hay ${formatQty(item.consumedQty)} consumidas.` : ''
  const save = () => guard(async () => {
    setTried(true)
    if (err || !why.trim()) return
    const r = await ui.run(() => returnItemToStock(ctx, order.id, item.id, q, why), 'Refacción devuelta al inventario')
    if (r) onClose()
  })
  return (
    <Sheet title="Devolver al inventario" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Devolver</button></>}>
      <div className="stack">
        <div><b>{item.description}</b><div className="small muted">Consumido: {formatQty(item.consumedQty)} {item.unit}</div></div>
        <Field label={`Cantidad a devolver (${item.unit})`} error={tried ? err : ''}><NumInput value={qty} onChange={setQty} invalid={tried && !!err} /></Field>
        <Field label="Motivo de la devolución" error={tried && !why.trim() ? 'Indica el motivo.' : ''}><textarea value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Ej. Pieza equivocada, no se instaló." /></Field>
        <p className="small muted">La pieza regresa al inventario con el costo con el que salió. Si ya se había ejecutado la partida, vuelve a «Autorizado».</p>
      </div>
    </Sheet>
  )
}

/* ───────── Costo real de un servicio externo ───────── */
function ExternalCostSheet({ order, item, costs, onClose }: { order: WorkOrder; item: WorkItem; costs: boolean; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [cost, setCost] = useState<number | undefined>()
  const err = cost === undefined ? 'Captura el costo real que cobró el proveedor (puede ser $0).' : ''
  const [tried, setTried] = useState(false)
  const save = () => guard(async () => {
    setTried(true)
    if (err) return
    const r = await ui.run(async () => { await completeItem(ctx, order.id, item.id, { costCents: cost }); return true }, 'Servicio externo ejecutado')
    if (r) onClose()
  })
  return (
    <Sheet title="Servicio externo ejecutado" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Marcar ejecutado</button></>}>
      <div className="stack">
        <div><b>{item.description}</b>{item.note && <div className="small muted">{item.note}</div>}</div>
        <Field label="Costo real del proveedor (total)" error={tried ? err : ''} hint={costs ? 'Se usa para calcular la utilidad real de la orden.' : 'Dato interno para calcular la utilidad.'}><MoneyInput cents={cost} onChange={setCost} invalid={tried && !!err} /></Field>
      </div>
    </Sheet>
  )
}
