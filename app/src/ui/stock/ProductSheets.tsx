import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { netPrice, productAlertFor, serviceAlertFor, taxRateOf } from '../../domain/alerts'
import { diffDays } from '../../domain/dates'
import { formatMXN, formatNum, formatPct, formatQty } from '../../domain/money'
import { marginPct, markupPct } from '../../domain/pricing'
import type { PriceHistory } from '../../domain/types'
import { removeService } from '../../services/catalog'
import { unitCostOf } from '../alerts'
import { useOpen } from '../create'
import { fmtDate, fmtDateTime, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Empty, Sheet, useBusy, useUi } from '../ui'
import { ALERT_BADGE, ALERT_TONE, MOVE_LABEL, MOVE_TONE, lastMoves, outflows, pendingQty, priceNote, signed, suggestQty, useLaborRate, useUserNames } from './helpers'
import { Di, Dl, Pct, PriceProposalPanel, Sec } from './parts'
import { movementDoc } from './movdoc'

function PriceHistoryList({ rows, names }: { rows: PriceHistory[] | undefined; names: Map<string, string> }) {
  if (!rows) return <div className="muted small">Cargando…</div>
  if (!rows.length) return <div className="muted small">Este precio no ha cambiado desde su alta.</div>
  return (
    <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Fecha</th><th className="r">Anterior</th><th className="r">Nuevo</th><th>Motivo</th><th>Usuario</th></tr></thead>
      <tbody>{rows.map((h) => <tr key={h.id}><td className="nowrap">{fmtDateTime(h.at)}</td><td className="r num">{formatMXN(h.oldPriceCents)}</td><td className="r num"><b>{formatMXN(h.newPriceCents)}</b></td><td>{h.reason}</td><td>{names.get(h.userId) ?? '—'}</td></tr>)}</tbody></table></div>
  )
}

/** Ficha completa de un producto: datos, existencias por almacén, costos, historial de precios, proveedores, rotación y movimientos. */
export function ProductSheet({ data: d, id, onClose }: { data: Data; id: string; onClose: () => void }) {
  const ctx = useCtx(), open = useOpen()
  const names = useUserNames(ctx)
  const p = d.prodMap.get(id)
  const history = useLiveQuery(() => ctx.db.priceHistory.where('refId').equals(id).toArray().then((r) => r.filter((x) => x.kind === 'producto').sort((a, b) => b.at.localeCompare(a.at))), [ctx.db, id])
  const canCost = d.can('costos.ver')
  const info = useMemo(() => {
    if (!p) return null
    const st = d.stock.get(id) ?? { qty: 0, valueCents: 0 }
    const out = outflows(d.movements, d.today).get(id) ?? 0, last = lastMoves(d.movements).get(id)
    const mv = d.movements.filter((m) => m.productId === id).sort((a, b) => b.at.localeCompare(a.at))
    return { st, out, last, mv }
  }, [d, id, p])
  if (!p || !info) return <Sheet title="Producto" onClose={onClose}><Empty title="El producto ya no existe" /></Sheet>
  const { st, out, last, mv } = info
  const cost = unitCostOf(d, id), costIsLast = !(st.qty > 0)
  const rate = taxRateOf(d.settings, p.taxId), net = netPrice(p.priceCents, rate, d.settings.pricesIncludeTax)
  const total = d.settings.pricesIncludeTax ? p.priceCents : Math.round(p.priceCents * (1 + rate / 100))
  const margin = cost > 0 ? marginPct(net, cost) : null, markup = cost > 0 ? markupPct(net, cost) : null
  const minM = p.minMarginPct ?? d.settings.minMarginPct
  const al = productAlertFor(p, cost, d.settings)
  const daily = out / 60, cover = daily > 0 ? st.qty / daily : null
  const state = st.qty <= 0 ? 'agotado' : st.qty <= p.minStock ? 'bajo' : 'ok'
  const sups = d.supplierProducts.filter((x) => x.productId === id).map((x) => ({ ...x, name: d.supMap.get(x.supplierId)?.name ?? '—' })).sort((a, b) => a.lastCostCents - b.lastCostCents)
  const principal = p.supplierId ? d.supMap.get(p.supplierId) : undefined
  const incoming = d.purchaseOrders.filter((o) => (o.status === 'enviada' || o.status === 'parcial')).flatMap((o) => o.items.filter((i) => i.productId === id && pendingQty(i) > 0).map((i) => ({ o, q: pendingQty(i) })))
  const whs = d.balances.filter((b) => b.productId === id)
  const sug = suggestQty(p.minStock, st.qty, daily, principal?.leadDays ?? 0)
  const go = (fn: () => void) => () => { onClose(); fn() }
  const costPrev = p.prevPurchaseCost, costLast = p.lastPurchaseCost
  const chg = costPrev && costLast ? ((costLast - costPrev) / costPrev) * 100 : null
  return (
    <Sheet title={p.name} onClose={onClose} wide footer={<>
      {d.can('inventario.editar') && <button className="btn" onClick={go(() => open({ k: 'product', v: p }))}>Editar</button>}
      {d.can('inventario.ajustar') && <button className="btn" onClick={go(() => open({ k: 'adjust', productId: id }))}>Ajustar existencias</button>}
      {d.can('compras.editar') && p.active && <button className="btn" onClick={go(() => open({ k: 'purchase', supplierId: p.supplierId, items: [{ productId: id, qty: sug || Math.max(1, p.minStock) }] }))}>Comprar</button>}
      <button className="btn primary" onClick={onClose}>Cerrar</button>
    </>}>
      <div className="stack-lg">
        <div className="row wrap">
          <span className="stk-mono">{p.sku}</span>
          <Badge tone={p.active ? 'ok' : ''}>{p.active ? 'Activo' : 'Inactivo'}</Badge>
          <Badge>{p.type === 'refaccion' ? 'Refacción' : 'Consumible'}</Badge>
          {state === 'agotado' && <Badge tone="bad">Agotado</Badge>}
          {state === 'bajo' && <Badge tone="warn">Bajo mínimo</Badge>}
          {canCost && (al.kind ? <Badge tone={ALERT_TONE[al.kind] || undefined}>{ALERT_BADGE[al.kind]}</Badge> : <Badge tone="ok">Margen sano</Badge>)}
        </div>

        <Sec title="Datos del producto">
          <Dl>
            <Di k="Categoría">{p.category || '—'}</Di><Di k="Marca">{p.brand || '—'}</Di><Di k="Número de parte">{p.partNo || '—'}</Di>
            <Di k="Código de barras">{p.barcode || '—'}</Di><Di k="Unidad">{p.unit}</Di><Di k="Ubicación">{p.location || '—'}</Di>
            <Di k="Proveedor principal">{principal?.name ?? '—'}</Di><Di k="Stock mínimo">{formatQty(p.minStock)} {p.unit}</Di><Di k="Impuesto">{d.settings.taxes.find((t) => t.id === p.taxId)?.name ?? '—'} ({rate} %)</Di>
            {p.description && <Di k="Descripción" wide>{p.description}</Di>}
            {p.compat && <Di k="Compatibilidad" wide>{p.compat}</Di>}
          </Dl>
        </Sec>

        <Sec title="Existencias">
          <Dl>
            <Di k="Existencias totales"><span className="num">{formatQty(st.qty)} {p.unit}</span></Di>
            {canCost && <Di k="Valor en inventario"><span className="num">{formatMXN(st.valueCents)}</span></Di>}
            <Di k="Por recibir">{incoming.length ? incoming.map((x) => `${formatQty(x.q)} ${p.unit} (${x.o.folio})`).join(', ') : 'Nada pendiente'}</Di>
          </Dl>
          {whs.length > 0 ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Almacén</th><th className="r">Existencias</th>{canCost && <th className="r">Valor</th>}</tr></thead>
              <tbody>{whs.map((b) => <tr key={b.id}><td>{d.warehouses.find((w) => w.id === b.warehouseId)?.name ?? '—'}</td><td className="r num">{formatQty(b.qty)} {p.unit}</td>{canCost && <td className="r num">{formatMXN(b.valueCents)}</td>}</tr>)}</tbody></table></div>
          ) : <div className="small muted">Sin existencias registradas en ningún almacén.</div>}
        </Sec>

        <Sec title="Precio y rentabilidad">
          <Dl>
            <Di k={d.settings.pricesIncludeTax ? 'Precio de venta (con IVA)' : 'Precio de venta (antes de IVA)'}><span className="num">{formatMXN(p.priceCents)}</span></Di>
            <Di k="Precio neto (sin IVA)"><span className="num">{formatMXN(net)}</span></Di>
            <Di k="Precio al cliente (con IVA)"><span className="num">{formatMXN(total)}</span></Di>
            {canCost && <>
              <Di k={costIsLast ? 'Costo vigente (último costo, sin existencias)' : 'Costo vigente (promedio)'}><span className="num">{cost > 0 ? formatMXN(Math.round(cost)) : 'Sin costo'}</span></Di>
              <Di k="Margen (sobre precio neto)"><Pct v={margin} /></Di>
              <Di k="Markup (sobre costo)"><Pct v={markup} /></Di>
              <Di k="Último costo de compra"><span className="num">{costLast ? formatMXN(Math.round(costLast)) : '—'}</span></Di>
              <Di k="Costo de compra anterior"><span className="num">{costPrev ? formatMXN(Math.round(costPrev)) : '—'}</span> {chg !== null && <span className={`small ${chg > 0 ? 'neg' : 'pos'}`}>({chg > 0 ? '+' : ''}{formatNum(chg)} %)</span>}</Di>
              <Di k="Margen mínimo configurado">{formatPct(minM)} <span className="small muted">{p.minMarginPct === undefined ? '(global)' : '(propio)'}</span></Di>
            </>}
          </Dl>
          <div className="small muted">{priceNote(d)} Margen = utilidad ÷ precio neto; markup = utilidad ÷ costo.</div>
        </Sec>

        <Sec title="Rotación (últimos 60 días)">
          <Dl>
            <Di k="Salidas (ventas y consumos)"><span className="num">{formatQty(out)} {p.unit}</span></Di>
            <Di k="Consumo diario promedio"><span className="num">{formatQty(Math.round(daily * 100) / 100)} {p.unit}</span></Di>
            <Di k="Cobertura con las existencias actuales">{cover === null ? 'Sin consumo en el periodo' : `${formatNum(cover)} días`}</Di>
            <Di k="Último movimiento">{last ? `${fmtDate(last)} (hace ${diffDays(last, d.today)} días)` : 'Sin movimientos'}</Di>
          </Dl>
        </Sec>

        <Sec title="Proveedores y último costo">
          {sups.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Proveedor</th><th>SKU del proveedor</th><th className="r">Último costo</th><th>Actualizado</th></tr></thead>
              <tbody>{sups.map((s, i) => <tr key={s.id}><td>{s.name} {s.supplierId === p.supplierId && <Badge tone="info">Principal</Badge>} {i === 0 && sups.length > 1 && <Badge tone="ok">Más barato</Badge>}</td><td>{s.supplierSku || '—'}</td><td className="r num">{formatMXN(s.lastCostCents)}</td><td>{fmtDate(s.updatedAt)}</td></tr>)}</tbody></table></div>
          ) : <div className="small muted">Aún no se ha comprado este producto: no hay costos por proveedor.</div>}
          {sups.length > 1 && <Link to="/compras?t=comparar" onClick={onClose}>Comparar precios entre proveedores</Link>}
        </Sec>

        {canCost && d.can('precios.editar') && (
          <Sec title="Proponer precio para margen objetivo">
            <PriceProposalPanel data={d} kind="producto" refId={id} taxId={p.taxId} />
          </Sec>
        )}

        <Sec title="Historial de precios"><PriceHistoryList rows={history} names={names} /></Sec>

        <Sec title="Movimientos recientes" right={mv.length > 0 && <Link className="small" to={`/inventario?f=movimientos&p=${id}`} onClick={onClose}>Ver todos ({mv.length})</Link>}>
          {mv.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Fecha</th><th>Tipo</th><th className="r">Cantidad</th>{canCost && <th className="r">Costo</th>}<th>Documento</th></tr></thead>
              <tbody>{mv.slice(0, 10).map((m) => { const doc = movementDoc(d, m); return <tr key={m.id}><td className="nowrap">{fmtDate(m.date)}</td><td><Badge tone={MOVE_TONE(m)}>{MOVE_LABEL[m.type]}</Badge></td><td className={`r num ${m.qty < 0 ? 'neg' : 'pos'}`}>{signed(m.qty)}</td>{canCost && <td className="r num">{formatMXN(Math.abs(m.totalCostCents))}</td>}<td>{doc.to ? <Link to={doc.to} onClick={onClose}>{doc.label}</Link> : doc.label}</td></tr> })}</tbody></table></div>
          ) : <div className="small muted">Sin movimientos todavía.</div>}
        </Sec>
      </div>
    </Sheet>
  )
}

/** Ficha de un servicio de mano de obra. */
export function ServiceSheet({ data: d, id, onClose }: { data: Data; id: string; onClose: () => void }) {
  const ctx = useCtx(), open = useOpen(), ui = useUi()
  const [busy, guard] = useBusy()
  const names = useUserNames(ctx)
  const s = d.svcMap.get(id)
  const rate = useLaborRate()
  const history = useLiveQuery(() => ctx.db.priceHistory.where('refId').equals(id).toArray().then((r) => r.filter((x) => x.kind === 'servicio').sort((a, b) => b.at.localeCompare(a.at))), [ctx.db, id])
  const canCost = d.can('costos.ver'), canEdit = d.can('precios.editar')
  if (!s) return <Sheet title="Servicio" onClose={onClose}><Empty title="El servicio ya no existe" /></Sheet>
  const tax = taxRateOf(d.settings, s.taxId), net = netPrice(s.priceCents, tax, d.settings.pricesIncludeTax)
  const cost = rate === undefined ? undefined : s.stdHours * rate
  const al = cost !== undefined ? serviceAlertFor(s, cost, d.settings) : null
  const remove = () => guard(async () => {
    if (!(await ui.confirm(`«${s.name}» dejará de ofrecerse en cotizaciones y órdenes. Las ventas anteriores no cambian.`, 'Desactivar servicio', true))) return
    const r = await ui.run(() => removeService(ctx, id).then(() => true), 'Servicio desactivado')
    if (r) onClose()
  })
  return (
    <Sheet title={s.name} onClose={onClose} wide footer={<>
      {canEdit && s.active && <button className="btn danger" disabled={busy} onClick={remove}>Desactivar</button>}
      {canEdit && <button className="btn" onClick={() => { onClose(); open({ k: 'service', v: s }) }}>Editar</button>}
      <button className="btn primary" onClick={onClose}>Cerrar</button>
    </>}>
      <div className="stack-lg">
        <div className="row wrap"><Badge tone={s.active ? 'ok' : ''}>{s.active ? 'Activo' : 'Inactivo'}</Badge><Badge>{s.category}</Badge>{canCost && al?.kind && <Badge tone={ALERT_TONE[al.kind] || undefined}>{ALERT_BADGE[al.kind]}</Badge>}</div>
        <Sec title="Datos del servicio">
          <Dl>
            <Di k="Horas estándar">{formatNum(s.stdHours)} h</Di>
            <Di k={d.settings.pricesIncludeTax ? 'Precio (con IVA)' : 'Precio (antes de IVA)'}><span className="num">{formatMXN(s.priceCents)}</span></Di>
            <Di k="Precio neto (sin IVA)"><span className="num">{formatMXN(net)}</span></Di>
            <Di k="Impuesto">{d.settings.taxes.find((t) => t.id === s.taxId)?.name ?? '—'} ({tax} %)</Di>
            <Di k="Margen mínimo">{formatPct(s.minMarginPct ?? d.settings.minMarginPct)} <span className="small muted">{s.minMarginPct === undefined ? '(global)' : '(propio)'}</span></Di>
            {s.description && <Di k="Descripción" wide>{s.description}</Di>}
          </Dl>
        </Sec>
        {canCost && (
          <Sec title="Costo estimado y margen">
            {rate === undefined ? <div className="muted small">Calculando…</div> : rate <= 0 ? <div className="banner">No hay costo laboral: captura el costo mensual de al menos un mecánico activo en Personal para estimar el costo y el margen.</div> : (
              <Dl>
                <Di k="Costo laboral promedio por hora"><span className="num">{formatMXN(rate)}</span></Di>
                <Di k="Costo estimado (horas × costo por hora)"><span className="num">{formatMXN(Math.round(cost ?? 0))}</span></Di>
                <Di k="Margen / markup"><Pct v={al?.marginPct ?? null} /> / <Pct v={cost && cost > 0 ? markupPct(net, cost) : null} /></Di>
              </Dl>
            )}
            <div className="small muted">Es una estimación con el promedio de los mecánicos; el costo real se calcula con los tiempos registrados en cada orden.</div>
          </Sec>
        )}
        {canCost && canEdit && <Sec title="Proponer precio para margen objetivo"><PriceProposalPanel data={d} kind="servicio" refId={id} taxId={s.taxId} /></Sec>}
        <Sec title="Historial de precios"><PriceHistoryList rows={history} names={names} /></Sec>
      </div>
    </Sheet>
  )
}
