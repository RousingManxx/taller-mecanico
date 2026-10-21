import { useMemo, useState } from 'react'
import '../css/stock.css'
import { addDays } from '../../domain/dates'
import { formatMXN, formatQty } from '../../domain/money'
import type { Product, PurchaseOrder } from '../../domain/types'
import { savePurchaseOrder, sendPurchaseOrder } from '../../services/purchasing'
import type { Data } from '../data'
import { useCtx } from '../session'
import { canEditPO, defaultPurchaseCost, lineGoods, norm, poTotals, supplierCost } from '../stock/helpers'
import { Badge, Field, Icon, MoneyInput, NumInput, Sheet, useBusy, useUi } from '../ui'

interface Line { key: string; productId: string; qty: number | undefined; cost: number | undefined; disc: number | undefined; touched: boolean }
let seq = 0
const key = () => `l${++seq}`

export function PurchaseForm({ data: d, purchase, supplierId, items, onClose }: { data: Data; purchase?: PurchaseOrder; supplierId?: string; items?: { productId: string; qty: number }[]; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const s = d.settings
  const editable = !purchase || canEditPO(purchase, d.receipts)
  const supplierList = useMemo(() => d.suppliers.filter((x) => x.active || x.id === (purchase?.supplierId ?? supplierId)).sort((a, b) => a.name.localeCompare(b.name, 'es')), [d.suppliers, purchase, supplierId])
  const sup0 = purchase?.supplierId ?? supplierId ?? ''
  const [sid, setSid] = useState(sup0)
  const [date, setDate] = useState(purchase?.date ?? d.today)
  const [expected, setExpected] = useState(purchase?.expectedDate ?? (sup0 && d.supMap.get(sup0)?.leadDays ? addDays(d.today, d.supMap.get(sup0)?.leadDays ?? 0) : ''))
  const [expTouched, setExpTouched] = useState(!!purchase)
  const [freight, setFreight] = useState<number | undefined>(purchase?.freightCents ?? 0)
  const defaultRate = s.taxes.find((t) => t.id === s.defaultTaxId)?.rate ?? 16
  const [rate, setRate] = useState<number>(purchase?.taxRate ?? defaultRate)
  const [notes, setNotes] = useState(purchase?.notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => purchase
    ? purchase.items.map((i) => ({ key: key(), productId: i.productId, qty: i.qty, cost: i.unitCostCents, disc: i.discountCents, touched: true }))
    : (items ?? []).filter((i) => d.prodMap.has(i.productId)).map((i) => ({ key: key(), productId: i.productId, qty: i.qty, cost: defaultPurchaseCost(d, sup0, i.productId) || undefined, disc: 0, touched: false })))
  const [find, setFind] = useState('')
  const [savedId, setSavedId] = useState(purchase?.id)
  const [tried, setTried] = useState(false)
  const sup = d.supMap.get(sid)
  const rates = useMemo(() => [...new Set([...s.taxes.map((t) => t.rate), 0, rate])].sort((a, b) => b - a), [s.taxes, rate])

  const changeSupplier = (id: string) => {
    setSid(id)
    const lead = d.supMap.get(id)?.leadDays ?? 0
    if (!expTouched) setExpected(lead > 0 ? addDays(date, lead) : '')
    setLines((ls) => ls.map((l) => l.touched ? l : { ...l, cost: defaultPurchaseCost(d, id, l.productId) || undefined }))
  }
  const addProduct = (p: Product) => { setLines((ls) => [...ls, { key: key(), productId: p.id, qty: 1, cost: defaultPurchaseCost(d, sid, p.id) || undefined, disc: 0, touched: false }]); setFind('') }
  const upd = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => l.key === k ? { ...l, ...patch } : l))

  const used = new Set(lines.map((l) => l.productId))
  const matches = useMemo(() => {
    const t = norm(find.trim())
    const pool = d.products.filter((p) => p.active && !used.has(p.id))
    if (!t) {
      const mine = pool.filter((p) => sid && (p.supplierId === sid || d.supplierProducts.some((x) => x.supplierId === sid && x.productId === p.id)))
      return mine.slice(0, 8)
    }
    return pool.filter((p) => [p.sku, p.name, p.partNo, p.barcode, p.brand].some((x) => norm(x).includes(t))).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.products, d.supplierProducts, find, sid, lines])

  const valid = lines.map((l) => ({ ...l, qty: l.qty ?? 0, cost: l.cost ?? 0, disc: l.disc ?? 0 }))
  const totals = poTotals({ items: valid.map((l) => ({ qty: l.qty, unitCostCents: l.cost, discountCents: l.disc })), freightCents: freight ?? 0, taxRate: rate })
  const lineErr = (l: (typeof valid)[number]) => !(l.qty > 0) ? 'La cantidad debe ser mayor que cero.' : l.cost < 0 ? 'El costo no puede ser negativo.' : l.disc < 0 || l.disc > Math.round(l.qty * l.cost) ? 'El descuento no puede ser mayor al importe de la partida.' : undefined
  const err = {
    sid: !sid ? 'Elige el proveedor.' : undefined,
    items: !lines.length ? 'Agrega al menos un producto.' : valid.some((l) => lineErr(l)) ? 'Revisa las partidas marcadas.' : undefined,
    freight: (freight ?? 0) < 0 ? 'El flete no puede ser negativo.' : undefined,
    expected: expected && expected < date ? 'La fecha esperada no puede ser anterior a la fecha de la orden.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried ? err[k] : undefined)
  const noCost = valid.filter((l) => l.cost === 0).length

  const persist = async () => {
    setTried(true)
    if (hasErr) { ui.toast('Revisa los campos marcados en rojo.', true); return undefined }
    const po = await ui.run(() => savePurchaseOrder(ctx, { supplierId: sid, date, expectedDate: expected || undefined, items: valid.map((l) => ({ productId: l.productId, qty: l.qty, unitCostCents: l.cost, discountCents: l.disc })), freightCents: freight ?? 0, taxRate: rate, notes }, savedId))
    if (po) setSavedId(po.id)
    return po
  }
  const draft = () => guard(async () => {
    const po = await persist()
    if (po) { ui.toast(purchase && purchase.status === 'enviada' ? `Orden ${po.folio} actualizada` : `Orden ${po.folio} guardada como borrador`); onClose() }
  })
  const send = () => guard(async () => {
    const po = await persist()
    if (!po) return
    const ok = await ui.run(() => sendPurchaseOrder(ctx, po.id).then(() => true), `Orden ${po.folio} guardada y marcada como enviada`)
    if (ok) onClose()
  })

  if (!editable) return (
    <Sheet title={`Orden ${purchase?.folio}`} onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Entendido</button>}>
      <div className="banner">Esta orden ya no se puede editar porque tiene recepciones o está {purchase?.status === 'cancelada' ? 'cancelada' : 'cerrada'}. Solo se editan órdenes en borrador o enviadas sin recepciones.</div>
    </Sheet>
  )
  const isDraftish = !purchase || purchase.status === 'borrador'
  return (
    <Sheet title={purchase ? `Editar orden ${purchase.folio}` : 'Nueva orden de compra'} wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      {isDraftish ? <>
        <button className="btn" disabled={busy} onClick={draft}>Guardar borrador</button>
        <button className="btn primary" disabled={busy} onClick={send}>Guardar y enviar</button>
      </> : <button className="btn primary" disabled={busy} onClick={draft}>Guardar cambios</button>}
    </>}>
      <div className="stack-lg">
        {(items?.length ?? 0) > 0 && !purchase && <div className="banner info">Orden precargada con la propuesta de compra. Revisa cantidades y costos: nada se compra hasta que la guardes y la envíes.</div>}
        <section className="stack"><h3>Orden</h3>
          <div className="grid">
            <Field label="Proveedor *" error={show('sid')}>
              <select value={sid} onChange={(e) => changeSupplier(e.target.value)} aria-invalid={!!show('sid') || undefined}><option value="">— Elegir proveedor —</option>{supplierList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </Field>
            <Field label="Fecha de la orden"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Fecha esperada de entrega" error={show('expected')} hint={sup ? `Este proveedor entrega en ${sup.leadDays} día(s)` : undefined}><input type="date" value={expected} onChange={(e) => { setExpected(e.target.value); setExpTouched(true) }} aria-invalid={!!show('expected') || undefined} /></Field>
          </div>
          {sup && <div className="small muted">{sup.paymentTermsDays > 0 ? `Crédito de ${sup.paymentTermsDays} días` : 'Pago de contado'}{sup.phone ? ` · Tel. ${sup.phone}` : ''}</div>}
        </section>

        <section className="stack"><h3>Partidas</h3>
          <div className="stack-sm">
            <div className="search"><Icon n="search" size={18} /><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Buscar producto para agregar (SKU, nombre, parte)" aria-label="Buscar producto para agregar" autoComplete="off" /></div>
            {matches.length > 0 && <div className="chips" style={{ flexWrap: 'wrap' }} role="group" aria-label="Productos sugeridos">{!find.trim() && <span className="small muted" style={{ alignSelf: 'center' }}>De este proveedor:</span>}{matches.map((p) => <button key={p.id} className="chip" onClick={() => addProduct(p)}>+ {p.name} <span className="stk-mono">{p.sku}</span></button>)}</div>}
            {find.trim() && !matches.length && <div className="small muted">Sin productos que coincidan (o ya están en la orden).</div>}
          </div>
          {err.items && tried && <div className="err" role="alert">{err.items}</div>}
          {lines.map((raw) => {
            const l = { ...raw, qty: raw.qty ?? 0, cost: raw.cost ?? 0, disc: raw.disc ?? 0 }
            const p = d.prodMap.get(l.productId)
            const e = tried ? lineErr(l) : undefined
            const last = supplierCost(d, sid, l.productId)
            return (
              <div key={l.key} className="stk-line" role="group" aria-label={p?.name}>
                <div className="full row between"><div><span className="stk-name">{p?.name ?? 'Producto'}</span><br /><span className="stk-sub"><span className="stk-mono">{p?.sku}</span> · {p?.unit}{last !== undefined ? ` · último costo con este proveedor ${formatMXN(last)}` : ''}</span></div>
                  <button className="btn small ghost" aria-label={`Quitar ${p?.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Quitar</button></div>
                <Field label={`Cantidad (${p?.unit ?? ''})`}><NumInput value={raw.qty} onChange={(v) => upd(l.key, { qty: v })} invalid={!!e && !(l.qty > 0)} /></Field>
                <Field label="Costo unitario (sin IVA)"><MoneyInput cents={raw.cost} onChange={(v) => upd(l.key, { cost: v, touched: true })} /></Field>
                <Field label="Descuento de la partida ($)"><MoneyInput cents={raw.disc} onChange={(v) => upd(l.key, { disc: v })} /></Field>
                <div className="tot"><span className="muted">Importe</span><b className="num">{formatMXN(l.qty > 0 ? lineGoods({ qty: l.qty, unitCostCents: l.cost, discountCents: l.disc }) : 0)}</b></div>
                {e && <div className="err full" role="alert">{e}</div>}
              </div>
            )
          })}
          {noCost > 0 && <div className="small muted">{noCost} partida(s) con costo $0: captura el costo para que el total sea real.</div>}
        </section>

        <section className="stack"><h3>Totales</h3>
          <div className="grid">
            <Field label="Flete ($)" error={show('freight')} hint="Se prorratea al costo de lo recibido"><MoneyInput cents={freight} onChange={setFreight} invalid={!!show('freight')} /></Field>
            <Field label="Tasa de IVA"><select value={rate} onChange={(e) => setRate(Number(e.target.value))}>{rates.map((r) => <option key={r} value={r}>{r} %</option>)}</select></Field>
          </div>
          <div className="stk-totals" aria-live="polite">
            <span>Mercancía (con descuentos)</span><span>{formatMXN(totals.goods)}</span>
            <span>Flete</span><span>{formatMXN(totals.freight)}</span>
            <span>IVA ({rate} %)</span><span>{formatMXN(totals.tax)}</span>
            <span className="big">Total estimado</span><span className="big">{formatMXN(totals.total)}</span>
          </div>
          <div className="small muted">Es un estimado: el costo y el monto a pagar definitivos salen de lo que realmente recibas. {lines.length > 0 && <Badge>{lines.length} partida(s) · {formatQty(valid.reduce((a, l) => a + l.qty, 0))} unidades</Badge>}</div>
        </section>

        <Field label="Notas"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Condiciones, referencias, indicaciones para el proveedor…" /></Field>
      </div>
    </Sheet>
  )
}
