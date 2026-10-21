import { useMemo, useState } from 'react'
import '../css/stock.css'
import { addDays } from '../../domain/dates'
import { formatMXN, formatNum, formatQty, round } from '../../domain/money'
import type { PurchaseReceipt } from '../../domain/types'
import { receivePurchase } from '../../services/purchasing'
import { useOpen } from '../create'
import { fmtDate, type Data } from '../data'
import { useCtx } from '../session'
import { pendingQty, previewReceipt } from '../stock/helpers'
import { Badge, Field, NumInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

interface Done { receipt: PurchaseReceipt; complete: boolean; increases: { name: string; prev: number; now: number }[] }

export function ReceiveSheet({ data: d, poId, onClose }: { data: Data; poId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey(), open = useOpen()
  const [busy, guard] = useBusy()
  const canCost = d.can('costos.ver')
  const po = d.purchaseOrders.find((x) => x.id === poId)
  const sup = po ? d.supMap.get(po.supplierId) : undefined
  const [qty, setQty] = useState<Record<string, number | undefined>>(() => Object.fromEntries((po?.items ?? []).map((i) => [i.id, pendingQty(i)])))
  const [invoice, setInvoice] = useState('')
  const [date, setDate] = useState(d.today)
  const [due, setDue] = useState(addDays(d.today, sup?.paymentTermsDays ?? 0))
  const [dueTouched, setDueTouched] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [tried, setTried] = useState(false)

  const qmap = useMemo(() => new Map(Object.entries(qty).filter(([, v]) => v !== undefined && v > 0) as [string, number][]), [qty])
  const over = (po?.items ?? []).filter((i) => (qty[i.id] ?? 0) > pendingQty(i) + 1e-9)
  const neg = Object.values(qty).some((v) => v !== undefined && v < 0)
  const pv = useMemo(() => {
    if (!po) return null
    const clamp = new Map<string, number>()
    for (const [k, v] of qmap) { const it = po.items.find((i) => i.id === k); if (it) clamp.set(k, Math.min(v, pendingQty(it))) }
    return previewReceipt(po, d.receipts, clamp)
  }, [po, d.receipts, qmap])
  const err = {
    qty: !qmap.size ? 'Indica al menos una cantidad recibida.' : neg ? 'Las cantidades no pueden ser negativas.' : over.length ? `${over[0].description}: solo faltan ${formatQty(pendingQty(over[0]))} por recibir. Recibir de más duplicaría el inventario.` : undefined,
    due: due && due < date ? 'El vencimiento no puede ser anterior a la fecha de recepción.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)

  if (!po || !['borrador', 'enviada', 'parcial'].includes(po.status)) return <Sheet title="Recibir compra" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Cerrar</button>}><div className="banner">Esta orden no admite recepciones (está {po ? po.status : 'eliminada'}).</div></Sheet>

  const confirm = () => guard(async () => {
    setTried(true)
    if (hasErr || !pv) { ui.toast(err.qty ?? err.due ?? 'Revisa los datos de la recepción.', true); return }
    const before = new Map(d.products.map((p) => [p.id, p.lastPurchaseCost]))
    const lines = [...qmap].map(([itemId, q]) => ({ itemId, qty: q }))
    const r = await ui.run(() => receivePurchase(ctx, po.id, lines, { invoiceRef: invoice, date, dueDate: due || undefined }, opKey))
    if (!r) return
    const increases = r.items.flatMap((it) => {
      const prev = before.get(it.productId), now = it.landedCents / it.qty
      return prev && prev > 0 && round(now) > round(prev) ? [{ name: d.prodMap.get(it.productId)?.name ?? 'Producto', prev, now }] : []
    })
    const complete = po.items.every((i) => i.qty - i.receivedQty - (qmap.get(i.id) ?? 0) < 1e-9)
    setDone({ receipt: r, complete, increases })
  })

  if (done) return (
    <Sheet title="Recepción registrada" onClose={onClose} footer={<>
      {d.can('pagos_proveedor.registrar') && <button className="btn" onClick={() => open({ k: 'supplierpay', receiptId: done.receipt.id })}>Pagar ahora</button>}
      <button className="btn primary" onClick={onClose}>Listo</button>
    </>}>
      <div className="stack">
        <div className="banner ok"><b>{done.receipt.folio}</b> registrada: {formatMXN(done.receipt.totalCents)} por pagar{sup ? ` a ${sup.name}` : ''}, vence el {fmtDate(done.receipt.dueDate)}. La orden {po.folio} quedó {done.complete ? 'recibida completa' : 'con recepción parcial'}.</div>
        {done.increases.length > 0 && (
          <div className="banner" role="alert"><b>El costo de {done.increases.length} producto(s) subió respecto a la compra anterior:</b>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{done.increases.map((x) => <li key={x.name}>{x.name}: {formatMXN(Math.round(x.prev))} → {formatMXN(Math.round(x.now))} (+{formatNum(((x.now - x.prev) / x.prev) * 100)} %). Revisa si tu precio de venta sigue dando margen.</li>)}</ul></div>
        )}
        <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Producto</th><th className="r">Recibido</th><th className="r">Mercancía</th><th className="r">Flete</th><th className="r">Costo unit.</th></tr></thead>
          <tbody>{done.receipt.items.map((it) => <tr key={it.itemId}><td>{d.prodMap.get(it.productId)?.name}</td><td className="r num">{formatQty(it.qty)}</td><td className="r num">{formatMXN(it.goodsCents)}</td><td className="r num">{formatMXN(it.freightCents)}</td><td className="r num">{formatMXN(Math.round(it.landedCents / it.qty))}</td></tr>)}</tbody></table></div>
        <div className="small muted">La mercancía ya está en inventario. El pago a proveedor se registra aparte: hasta entonces queda como cuenta por pagar.</div>
      </div>
    </Sheet>
  )

  return (
    <Sheet title={`Recibir ${po.folio}`} wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={confirm}>Confirmar recepción</button>
    </>}>
      <div className="stack-lg">
        <div className="small muted">{sup?.name} · {po.items.length} partida(s). Registrar la recepción suma la mercancía al inventario con su costo de adquisición y genera una cuenta por pagar.</div>
        <section className="stack"><h3>Datos de la factura</h3>
          <div className="grid">
            <Field label="Número de factura o remisión"><input value={invoice} onChange={(e) => setInvoice(e.target.value)} autoComplete="off" /></Field>
            <Field label="Fecha de recepción"><input type="date" value={date} onChange={(e) => { setDate(e.target.value); if (!dueTouched) setDue(addDays(e.target.value, sup?.paymentTermsDays ?? 0)) }} /></Field>
            <Field label="Vencimiento del pago" error={tried ? err.due : undefined} hint={sup ? (sup.paymentTermsDays > 0 ? `Crédito de ${sup.paymentTermsDays} días` : 'Proveedor de contado') : undefined}><input type="date" value={due} onChange={(e) => { setDue(e.target.value); setDueTouched(true) }} /></Field>
          </div>
        </section>

        <section className="stack"><h3>Lo que llegó</h3>
          {tried && err.qty && <div className="err" role="alert">{err.qty}</div>}
          <div>
            {po.items.map((it) => {
              const pend = pendingQty(it), p = d.prodMap.get(it.productId), q = qty[it.id]
              const line = pv?.lines.find((l) => l.item.id === it.id)
              const st = d.stock.get(it.productId)
              const prevCost = p?.lastPurchaseCost
              const up = line && prevCost && prevCost > 0 && round(line.unit) > round(prevCost)
              const bad = q !== undefined && q > pend + 1e-9
              return (
                <div key={it.id} className="stk-recv">
                  <div className="full"><span className="stk-name">{it.description}</span> <span className="stk-sub stk-mono">{p?.sku}</span>{pend === 0 && <> <Badge tone="ok">Completa</Badge></>}</div>
                  <div className="small muted full">Pedido {formatQty(it.qty)} · recibido {formatQty(it.receivedQty)} · <b>pendiente {formatQty(pend)}</b> {p?.unit} · {formatMXN(it.unitCostCents)} c/u{it.discountCents > 0 ? ` (desc. ${formatMXN(it.discountCents)})` : ''}</div>
                  <Field label={`Cantidad recibida (${p?.unit ?? ''})`} error={bad ? `Máximo ${formatQty(pend)}` : undefined}><NumInput value={q} onChange={(v) => setQty((x) => ({ ...x, [it.id]: v }))} invalid={bad} disabled={pend === 0} /></Field>
                  {line ? (
                    <div className="small" aria-live="polite">
                      <div className="muted">Costo de adquisición</div>
                      <b className="num">{formatMXN(Math.round(line.unit))}</b> c/u <span className="muted">({formatMXN(line.goods)} + flete {formatMXN(line.freight)})</span>
                      {up && <div><Badge tone="warn">Sube {formatNum(((line.unit - (prevCost as number)) / (prevCost as number)) * 100)} % vs. última compra</Badge></div>}
                      {canCost && st && <div className="muted">Costo prom.: {st.qty > 0 ? formatMXN(Math.round(st.valueCents / st.qty)) : '—'} → <b>{formatMXN(Math.round((st.valueCents + line.landed) / (st.qty + line.qty)))}</b></div>}
                    </div>
                  ) : <div className="small muted">Sin recibir en esta entrega</div>}
                </div>
              )
            })}
          </div>
        </section>

        {pv && qmap.size > 0 && (
          <section className="stack" aria-live="polite"><h3>Costo de adquisición y cuenta por pagar</h3>
            <div className="stk-totals">
              <span>Mercancía recibida (− descuentos)</span><span>{formatMXN(pv.goods)}</span>
              <span>Flete prorrateado{po.freightCents > 0 ? ` (de ${formatMXN(po.freightCents)})` : ''}</span><span>{formatMXN(pv.freight)}</span>
              <span>IVA ({po.taxRate} %, no forma parte del costo)</span><span>{formatMXN(pv.tax)}</span>
              <span className="big">Por pagar al proveedor</span><span className="big">{formatMXN(pv.total)}</span>
            </div>
            <div className="small muted">Costo que entra al inventario: mercancía − descuento + flete prorrateado = {formatMXN(pv.goods + pv.freight)}. {pv.complete ? 'Con esta entrega la orden queda completa y se liquida todo el flete.' : 'La orden quedará con recepción parcial; el flete se reparte en proporción a lo recibido.'}</div>
          </section>
        )}
      </div>
    </Sheet>
  )
}
