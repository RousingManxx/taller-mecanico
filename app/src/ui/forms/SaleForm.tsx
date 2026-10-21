import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taxRateOf } from '../../domain/alerts'
import { addDays } from '../../domain/dates'
import { lineAmounts, sumLines } from '../../domain/lines'
import { formatMXN, formatPct, formatQty } from '../../domain/money'
import { marginPct } from '../../domain/pricing'
import { createCounterSale, type CounterLine } from '../../services/sales'
import { unitCostOf } from '../alerts'
import type { Data } from '../data'
import { CashGate, CustomerPick } from '../money/common'
import { isCashMethod } from '../money/helpers'
import { useCtx } from '../session'
import { Field, MoneyInput, NumInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

interface Line { key: string; kind: 'producto' | 'servicio' | 'libre'; refId?: string; description: string; qty: number | undefined; price: number | undefined; disc: number | undefined; taxRate: number; mechanicId: string; cost: number | undefined }
interface Pay { key: string; methodId: string; amount: number | undefined; reference: string }
let seq = 0
const nk = () => `k${++seq}`

export function SaleForm({ data, customerId, productId, onClose }: { data: Data; customerId?: string; productId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey(), nav = useNavigate()
  const [busy, guard] = useBusy()
  const s = data.settings
  const costs = data.can('costos.ver')
  const [cust, setCust] = useState(customerId ?? '')
  const [custName, setCustName] = useState('')
  const [q, setQ] = useState('')
  const [lines, setLines] = useState<Line[]>(() => {
    const p = productId ? data.prodMap.get(productId) : undefined
    return p ? [{ key: nk(), kind: 'producto', refId: p.id, description: p.name, qty: 1, price: p.priceCents, disc: 0, taxRate: taxRateOf(s, p.taxId), mechanicId: '', cost: undefined }] : []
  })
  const [due, setDue] = useState(data.today)
  const [notes, setNotes] = useState('')
  const [pays, setPays] = useState<Pay[]>([])
  const defMethod = s.paymentMethods[0]?.id ?? ''

  const mechanics = data.employees.filter((e) => e.isMechanic && e.active)
  const results = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    const hit = (...f: string[]) => f.some((x) => x.toLowerCase().includes(t))
    const prods = data.products.filter((p) => p.active && hit(p.sku, p.name, p.barcode, p.partNo, p.brand)).slice(0, 8).map((p) => ({ k: 'p' as const, id: p.id }))
    const svcs = data.services.filter((d) => d.active && hit(d.name, d.category)).slice(0, 5).map((d) => ({ k: 's' as const, id: d.id }))
    return [...prods, ...svcs]
  }, [q, data.products, data.services])

  const addProduct = (id: string) => {
    const p = data.prodMap.get(id); if (!p) return
    setLines((ls) => ls.some((l) => l.kind === 'producto' && l.refId === id)
      ? ls.map((l) => (l.kind === 'producto' && l.refId === id ? { ...l, qty: (l.qty ?? 0) + 1 } : l))
      : [...ls, { key: nk(), kind: 'producto', refId: p.id, description: p.name, qty: 1, price: p.priceCents, disc: 0, taxRate: taxRateOf(s, p.taxId), mechanicId: '', cost: undefined }])
    setQ('')
  }
  const addService = (id: string) => {
    const d = data.svcMap.get(id); if (!d) return
    setLines((ls) => [...ls, { key: nk(), kind: 'servicio', refId: d.id, description: d.name, qty: 1, price: d.priceCents, disc: 0, taxRate: taxRateOf(s, d.taxId), mechanicId: '', cost: undefined }])
    setQ('')
  }
  const addFree = () => setLines((ls) => [...ls, { key: nk(), kind: 'libre', description: '', qty: 1, price: undefined, disc: 0, taxRate: taxRateOf(s, s.defaultTaxId), mechanicId: '', cost: undefined }])
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const t = q.trim().toLowerCase()
    const exact = data.products.find((p) => p.active && (p.barcode.toLowerCase() === t || p.sku.toLowerCase() === t))
    if (exact) addProduct(exact.id)
    else if (results[0]?.k === 'p') addProduct(results[0].id)
    else if (results[0]) addService(results[0].id)
  }

  const amounts = lines.map((l) => lineAmounts({ qty: l.qty ?? 0, unitPriceCents: l.price ?? 0, discountCents: l.disc ?? 0, taxRate: l.taxRate }, s.pricesIncludeTax))
  const tot = sumLines(amounts)
  const paid = pays.reduce((a, p) => a + (p.amount ?? 0), 0)
  const balance = tot.totalCents - paid
  const anyCash = pays.some((p) => (p.amount ?? 0) > 0 && isCashMethod(data, p.methodId))
  const lineErr = (l: Line, i: number): string | undefined => {
    if (!l.qty || l.qty <= 0) return 'Indica una cantidad mayor que cero.'
    if (l.kind === 'libre' && !l.description.trim()) return 'Describe la partida.'
    if (l.price === undefined || l.price < 0) return 'Indica el precio unitario.'
    if ((l.disc ?? 0) < 0) return 'El descuento no puede ser negativo.'
    if ((l.disc ?? 0) > Math.round(l.qty * l.price)) return 'El descuento supera el importe de la partida.'
    if (amounts[i].totalCents < 0) return 'El importe no puede ser negativo.'
    return undefined
  }
  const errs = lines.map(lineErr)
  const stockOf = (id?: string) => (id ? data.stock.get(id)?.qty ?? 0 : 0)
  // Existencias solicitadas por producto (la misma refacción puede estar en una sola partida).
  const noStock = lines.some((l) => l.kind === 'producto' && (l.qty ?? 0) > stockOf(l.refId) + 1e-9)
  const dueErr = due < data.today ? 'El vencimiento no puede ser anterior a hoy.' : undefined
  const payErr = paid > tot.totalCents ? `Los cobros (${formatMXN(paid)}) superan el total de la venta (${formatMXN(tot.totalCents)}).` : undefined
  const valid = lines.length > 0 && errs.every((e) => !e) && !payErr && !dueErr && !noStock

  const payTotal = () => setPays((ps) => (ps.length ? [{ ...ps[0], amount: tot.totalCents }] : [{ key: nk(), methodId: defMethod, amount: tot.totalCents, reference: '' }]))
  const addPay = () => setPays((ps) => [...ps, { key: nk(), methodId: defMethod, amount: Math.max(0, balance) || undefined, reference: '' }])

  const save = () => guard(async () => {
    if (!valid) { ui.toast(!lines.length ? 'Agrega al menos una partida a la venta.' : noStock ? 'Hay partidas sin existencias suficientes.' : payErr ?? dueErr ?? errs.find(Boolean) ?? 'Revisa la venta.', true); return }
    const cl: CounterLine[] = lines.map((l) => {
      const base = { qty: l.qty ?? 0, discountCents: l.disc ?? 0 }
      if (l.kind === 'producto') return { kind: 'producto', productId: l.refId!, unitPriceCents: l.price, ...base }
      if (l.kind === 'servicio') return { kind: 'servicio', serviceId: l.refId!, unitPriceCents: l.price, mechanicId: l.mechanicId || undefined, ...base }
      return { kind: 'libre', description: l.description, unitPriceCents: l.price ?? 0, taxRate: l.taxRate, costCents: l.cost, ...base }
    })
    const sale = await ui.run(() => createCounterSale(ctx, {
      customerId: cust || undefined, customerName: cust ? undefined : custName, lines: cl, dueDate: due, notes,
      payments: pays.filter((p) => (p.amount ?? 0) > 0).map((p) => ({ methodId: p.methodId, amountCents: p.amount!, reference: p.reference })),
    }, opKey), 'Venta registrada')
    if (sale) { onClose(); nav(`/ventas/${sale.id}`) }
  })

  return (
    <Sheet title="Nueva venta de mostrador" onClose={onClose} wide footer={
      <>
        <div className="grow"><div className="small muted">Total</div><b className="num" style={{ fontSize: '1.2rem' }}>{formatMXN(tot.totalCents)}</b></div>
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy || !valid} onClick={save}>{paid >= tot.totalCents && tot.totalCents > 0 ? 'Registrar venta pagada' : paid > 0 ? 'Registrar venta con cobro parcial' : 'Registrar venta'}</button>
      </>
    }>
      <div className="stack-lg">
        <div className="stack">
          <h3>Cliente</h3>
          <CustomerPick customers={data.customers} value={cust} onChange={setCust} />
          {!cust && <Field label="Nombre para el comprobante (opcional)"><input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="Público en general" /></Field>}
          <div className="small muted">Venta de mostrador: refacciones o servicios sin orden de trabajo. Para trabajos en el vehículo usa una orden.</div>
        </div>

        <div className="stack">
          <h3>Partidas</h3>
          <div className="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" /></svg>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder="Buscar refacción (SKU, nombre, código de barras, parte) o servicio" aria-label="Buscar producto o servicio" /></div>
          {q.trim() && (
            results.length === 0 ? <div className="small muted">Sin resultados. Puedes agregar una partida libre.</div> : (
              <div className="mny-results" role="listbox" aria-label="Resultados">
                {results.map((r) => {
                  if (r.k === 'p') {
                    const p = data.prodMap.get(r.id)!, st = stockOf(p.id), uc = unitCostOf(data, p.id)
                    const net = lineAmounts({ qty: 1, unitPriceCents: p.priceCents, discountCents: 0, taxRate: taxRateOf(s, p.taxId) }, s.pricesIncludeTax).netCents
                    return (
                      <button type="button" key={'p' + p.id} className="mny-res" onClick={() => addProduct(p.id)}>
                        <span className="row between"><b>{p.name}</b><b className="num">{formatMXN(p.priceCents)}</b></span>
                        <span className="small muted">{p.sku}{p.partNo ? ` · ${p.partNo}` : ''} · <span className={st <= 0 ? 'neg' : ''}>Existencias: {formatQty(st)} {p.unit}</span>{costs && uc > 0 ? ` · Costo ${formatMXN(Math.round(uc))} · Margen ${formatPct(marginPct(net, uc))}` : ''}</span>
                      </button>
                    )
                  }
                  const d = data.svcMap.get(r.id)!
                  return <button type="button" key={'s' + d.id} className="mny-res" onClick={() => addService(d.id)}><span className="row between"><b>{d.name}</b><b className="num">{formatMXN(d.priceCents)}</b></span><span className="small muted">Servicio · {d.category}{d.stdHours ? ` · ${d.stdHours} h estándar` : ''}</span></button>
                })}
              </div>
            )
          )}
          <div><button type="button" className="btn small" onClick={addFree}>Agregar partida libre</button></div>

          {lines.length === 0 && <div className="banner info">Aún no hay partidas. Busca una refacción o servicio, o agrega una partida libre.</div>}
          {lines.map((l, i) => {
            const a = amounts[i], st = stockOf(l.refId), uc = l.kind === 'producto' && l.refId ? unitCostOf(data, l.refId) : 0
            const unitNet = (l.qty ?? 0) > 0 ? a.netCents / (l.qty ?? 1) : 0
            const below = costs && l.kind === 'producto' && uc > 0 && (l.qty ?? 0) > 0 && unitNet < uc
            return (
              <div className="mny-line" key={l.key}>
                <div className="row between">
                  <div className="grow">{l.kind === 'libre'
                    ? <Field label="Descripción de la partida"><input value={l.description} onChange={(e) => upd(l.key, { description: e.target.value })} placeholder="Ej. Mano de obra externa" /></Field>
                    : <><b>{l.description}</b><div className="small muted">{l.kind === 'producto' ? `Refacción · existencias ${formatQty(st)}` : 'Servicio del catálogo'}</div></>}</div>
                  <button type="button" className="btn small ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.description || 'partida'}`}>Quitar</button>
                </div>
                <div className="mny-line-grid">
                  <Field label="Cantidad"><NumInput value={l.qty} onChange={(v) => upd(l.key, { qty: v })} aria-label={`Cantidad de ${l.description || 'partida'}`} /></Field>
                  <Field label={s.pricesIncludeTax ? 'Precio unit. (con IVA)' : 'Precio unit. (sin IVA)'}><MoneyInput cents={l.price} onChange={(v) => upd(l.key, { price: v })} aria-label={`Precio de ${l.description || 'partida'}`} /></Field>
                  <Field label="Descuento ($)"><MoneyInput cents={l.disc} onChange={(v) => upd(l.key, { disc: v })} aria-label={`Descuento de ${l.description || 'partida'}`} /></Field>
                  <div className="stack-sm"><span className="small muted" style={{ fontWeight: 600 }}>Importe</span><b className="num">{formatMXN(a.totalCents)}</b><span className="small muted">IVA {l.taxRate} %: {formatMXN(a.taxCents)}</span></div>
                </div>
                {l.kind === 'servicio' && (
                  <Field label="Mecánico (opcional)" hint={costs ? 'Se usa para estimar el costo de mano de obra con las horas estándar.' : undefined}>
                    <select value={l.mechanicId} onChange={(e) => upd(l.key, { mechanicId: e.target.value })}><option value="">Sin asignar</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                  </Field>
                )}
                {l.kind === 'libre' && (
                  <div className="grid2">
                    <Field label="IVA de la partida"><select value={l.taxRate} onChange={(e) => upd(l.key, { taxRate: Number(e.target.value) })}>{[...new Map(s.taxes.map((t) => [t.rate, t])).values()].map((t) => <option key={t.id} value={t.rate}>{t.rate} %</option>)}</select></Field>
                    {costs && <Field label="Costo total (opcional, interno)" hint="Si lo dejas vacío, el costo se toma como cero y se marca estimado."><MoneyInput cents={l.cost} onChange={(v) => upd(l.key, { cost: v })} aria-label="Costo de la partida" /></Field>}
                  </div>
                )}
                {errs[i] && <div className="err" role="alert">{errs[i]}</div>}
                {l.kind === 'producto' && (l.qty ?? 0) > st + 1e-9 && <div className="banner bad" role="alert">No alcanza el inventario: hay {formatQty(st)} y pides {formatQty(l.qty ?? 0)}. El sistema rechazará la venta; registra primero la compra o ajusta la cantidad.</div>}
                {below && <div className="banner" role="alert">El precio neto por unidad ({formatMXN(Math.round(unitNet))}) queda por debajo del costo ({formatMXN(Math.round(uc))}): esta partida se vende con pérdida.</div>}
                {costs && l.kind === 'producto' && uc > 0 && !below && (l.qty ?? 0) > 0 && <div className="small muted">Costo unitario {formatMXN(Math.round(uc))} · margen de la partida {formatPct(marginPct(a.netCents, uc * (l.qty ?? 0)))}</div>}
              </div>
            )
          })}
        </div>

        <div className="stack">
          <h3>Totales</h3>
          <div className="mny-sum">
            <div className="mny-kv"><span>Venta neta (sin IVA)</span><span className="num">{formatMXN(tot.netCents)}</span></div>
            <div className="mny-kv"><span>IVA</span><span className="num">{formatMXN(tot.taxCents)}</span></div>
            <div className="mny-kv total"><span>Total</span><span className="num">{formatMXN(tot.totalCents)}</span></div>
          </div>
          {s.pricesIncludeTax && <div className="small muted">Los precios del catálogo ya incluyen IVA: el neto se obtiene dividiendo entre 1 + tasa.</div>}
        </div>

        <div className="stack">
          <h3>Cobro</h3>
          <div className="small muted">Registrar la venta y cobrarla son cosas distintas: lo que no cobres ahora queda como cuenta por cobrar.</div>
          <div className="mny-pickrow">
            <button type="button" className="btn small" disabled={tot.totalCents <= 0} onClick={payTotal}>Cobrar total ({formatMXN(tot.totalCents)})</button>
            <button type="button" className="btn small" onClick={addPay}>Agregar forma de pago</button>
            {pays.length > 0 && <button type="button" className="btn small ghost" onClick={() => setPays([])}>Dejar sin cobrar</button>}
          </div>
          {pays.map((p) => (
            <div className="mny-line" key={p.key}>
              <div className="grid2">
                <Field label="Forma de pago"><select value={p.methodId} onChange={(e) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, methodId: e.target.value } : x)))}>{s.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
                <Field label="Importe cobrado"><MoneyInput cents={p.amount} onChange={(v) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, amount: v } : x)))} aria-label="Importe cobrado" /></Field>
              </div>
              <div className="row"><div className="grow"><Field label="Referencia (opcional)"><input value={p.reference} onChange={(e) => setPays((ps) => ps.map((x) => (x.key === p.key ? { ...x, reference: e.target.value } : x)))} /></Field></div>
                <button type="button" className="btn small ghost" onClick={() => setPays((ps) => ps.filter((x) => x.key !== p.key))}>Quitar</button></div>
            </div>
          ))}
          <CashGate data={data} needed={anyCash} />
          {payErr && <div className="err" role="alert">{payErr}</div>}
          <div className="mny-sum">
            <div className="mny-kv"><span>Cobrado ahora</span><span className="num">{formatMXN(paid)}</span></div>
            <div className="mny-kv total"><span>Saldo por cobrar</span><span className="num">{formatMXN(Math.max(0, balance))}</span></div>
          </div>
          {balance > 0 && tot.totalCents > 0 && (
            <div className="stack-sm">
              <Field label="Vencimiento del saldo" error={dueErr} hint={due === data.today ? 'Hoy: si queda saldo, se considerará vencido mañana.' : undefined}><input type="date" value={due} min={data.today} onChange={(e) => e.target.value && setDue(e.target.value)} /></Field>
              <div className="mny-pickrow">{[0, 7, 15, 30].map((n) => <button type="button" key={n} className="chip" aria-pressed={due === addDays(data.today, n)} onClick={() => setDue(addDays(data.today, n))}>{n === 0 ? 'Hoy' : `${n} días`}</button>)}</div>
            </div>
          )}
          <Field label="Notas (opcional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </div>
    </Sheet>
  )
}
