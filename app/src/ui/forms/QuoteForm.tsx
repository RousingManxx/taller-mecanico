import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { taxRateOf } from '../../domain/alerts'
import { hourlyLaborCost } from '../../domain/labor'
import { lineAmounts } from '../../domain/lines'
import { formatMXN, formatNum, formatPct, round } from '../../domain/money'
import { ITEM_TYPE_LABEL } from '../../domain/orders'
import { currentVersion, quoteSummary } from '../../domain/quotes'
import type { ItemType, Quotation, QuoteItem } from '../../domain/types'
import { saveQuotation } from '../../services/quotations'
import { norm } from '../crm/lib'
import { useSubmit } from '../crm/hooks'
import { CustomerPicker, VehiclePicker } from '../crm/pickers'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Field, Icon, MoneyInput, NumInput, Seg, Sheet, useUi } from '../ui'

interface Draft { key: string; type: ItemType; refId?: string; description: string; qty: number | undefined; unitPriceCents: number | undefined; discountCents: number | undefined; taxRate: number; stdHours: number; estUnitCost: number | undefined; unit: string }
const newKey = () => crypto.randomUUID()
const ADD_TYPES: [ItemType, string][] = [['servicio', 'Servicio'], ['refaccion', 'Refacción'], ['consumible', 'Consumible'], ['externo', 'Externo'], ['otro', 'Otro']]

export function QuoteForm({ data, quote, customerId, vehicleId, onClose }: { data: Data; quote?: Quotation; customerId?: string; vehicleId?: string; onClose: () => void }) {
  const ctx = useCtx(), nav = useNavigate(), ui = useUi()
  const s = data.settings
  const showCost = data.can('costos.ver')
  const { busy, error, submit } = useSubmit()
  const cv = quote ? currentVersion(quote) : undefined
  const blocked = quote && ['aprobada', 'convertida'].includes(quote.status)
  const willVersion = !!quote && quote.status !== 'borrador' && !blocked

  const [f, setF] = useState({
    customerId: quote?.customerId ?? customerId ?? '', vehicleId: quote?.vehicleId ?? vehicleId ?? '',
    estimatedDays: (cv?.estimatedDays ?? 1) as number | undefined, validDays: s.quoteValidDays as number | undefined,
    notes: cv?.notes ?? '', terms: cv?.terms ?? s.quoteTerms, warranty: cv?.warranty ?? s.warrantyText,
  })
  const [items, setItems] = useState<Draft[]>(() => (cv?.items ?? []).map((i) => ({ key: newKey(), type: i.type, refId: i.refId, description: i.description, qty: i.qty, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents, taxRate: i.taxRate, stdHours: i.stdHours, estUnitCost: i.estUnitCost, unit: i.unit })))
  const [addType, setAddType] = useState<ItemType>('servicio')
  const [q, setQ] = useState('')
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const patch = (key: string, p: Partial<Draft>) => setItems((l) => l.map((d) => (d.key === key ? { ...d, ...p } : d)))

  /* Costo unitario estimado para la vista previa (solo con permiso de costos). El valor real lo calcula el servicio al guardar. */
  const avgHourly = useMemo(() => {
    const m = data.employees.filter((e) => e.active && e.isMechanic && e.monthlyCostCents > 0)
    return m.length ? round(m.reduce((a, e) => a + hourlyLaborCost(e, s), 0) / m.length) : 0
  }, [data.employees, s])
  const unitCost = (d: Draft): number => {
    if (!showCost) return 0
    if (d.refId && (d.type === 'refaccion' || d.type === 'consumible')) { const st = data.stock.get(d.refId); if (st && st.qty > 0) return st.valueCents / st.qty; return data.prodMap.get(d.refId)?.lastPurchaseCost ?? 0 }
    if (d.refId && d.type === 'servicio') return d.estUnitCost && d.estUnitCost > 0 ? d.estUnitCost : (d.stdHours || 0) * avgHourly
    return d.estUnitCost ?? 0
  }
  const asItems: QuoteItem[] = items.map((d) => ({ id: d.key, type: d.type, refId: d.refId, description: d.description, qty: d.qty ?? 0, unit: d.unit, unitPriceCents: d.unitPriceCents ?? 0, discountCents: d.discountCents ?? 0, taxRate: d.taxRate, estUnitCost: unitCost(d), stdHours: d.stdHours }))
  const sum = quoteSummary(asItems, s)
  const noCost = showCost ? items.filter((d) => unitCost(d) <= 0).length : 0

  const lineErr = (d: Draft): string => {
    if (!d.description.trim()) return 'Describe la partida.'
    if (!(d.qty !== undefined && d.qty > 0)) return 'La cantidad debe ser mayor que cero.'
    if ((d.unitPriceCents ?? 0) < 0) return 'El precio no puede ser negativo.'
    if ((d.discountCents ?? 0) < 0 || (d.discountCents ?? 0) > Math.round((d.qty ?? 0) * (d.unitPriceCents ?? 0))) return 'El descuento no puede ser negativo ni superar el importe de la partida.'
    return ''
  }
  const errs = {
    customerId: !f.customerId ? 'Elige al cliente.' : '', vehicleId: !f.vehicleId ? 'Elige el vehículo (o agrégalo con «Vehículo nuevo»).' : '',
    items: !items.length ? 'Agrega al menos una partida a la cotización.' : items.some((d) => lineErr(d)) ? 'Corrige las partidas marcadas.' : '',
    days: f.estimatedDays !== undefined && f.estimatedDays < 0 ? 'El tiempo estimado no puede ser negativo.' : '',
  }
  const hasErr = Object.values(errs).some(Boolean)
  const show = (k: keyof typeof errs) => (touched ? errs[k] : '')

  /* Catálogo */
  const t = norm(q.trim())
  const svcResults = useMemo(() => (addType !== 'servicio' ? [] : data.services.filter((x) => x.active && (!t || norm(x.name).includes(t) || norm(x.category).includes(t))).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 12)), [addType, t, data.services])
  const prodResults = useMemo(() => (addType !== 'refaccion' && addType !== 'consumible' ? [] : data.products.filter((p) => p.active && p.type === addType && (!t || norm(p.name).includes(t) || norm(p.sku).includes(t) || norm(p.partNo).includes(t) || norm(p.brand).includes(t))).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 12)), [addType, t, data.products])
  const addService = (id: string) => { const d = data.svcMap.get(id); if (d) setItems((l) => [...l, { key: newKey(), type: 'servicio', refId: d.id, description: d.name, qty: 1, unitPriceCents: d.priceCents, discountCents: 0, taxRate: taxRateOf(s, d.taxId), stdHours: d.stdHours, estUnitCost: undefined, unit: 'servicio' }]) }
  const addProduct = (id: string) => { const p = data.prodMap.get(id); if (p) setItems((l) => [...l, { key: newKey(), type: p.type, refId: p.id, description: p.name, qty: 1, unitPriceCents: p.priceCents, discountCents: 0, taxRate: taxRateOf(s, p.taxId), stdHours: 0, estUnitCost: undefined, unit: p.unit }]) }
  const addManual = () => setItems((l) => [...l, { key: newKey(), type: addType, description: '', qty: 1, unitPriceCents: undefined, discountCents: 0, taxRate: taxRateOf(s, s.defaultTaxId), stdHours: 0, estUnitCost: undefined, unit: addType === 'externo' ? 'servicio' : 'pza' }])

  const save = async () => {
    setTouched(true)
    if (hasErr || blocked) return
    const prev = quote?.currentVersion
    const r = await submit(() => saveQuotation(ctx, {
      customerId: f.customerId, vehicleId: f.vehicleId, notes: f.notes, terms: f.terms, warranty: f.warranty, estimatedDays: f.estimatedDays ?? 1, validDays: f.validDays,
      items: items.map((d) => ({ type: d.type, refId: d.refId, description: d.description, qty: d.qty ?? 0, unitPriceCents: d.unitPriceCents ?? 0, discountCents: d.discountCents ?? 0, taxRate: d.taxRate, stdHours: d.stdHours, ...(d.refId ? {} : { estUnitCost: d.estUnitCost ?? 0 }) })),
    }, quote?.id))
    if (r) {
      const q2 = r.value
      onClose()
      nav(`/cotizaciones/${q2.id}`)
      if (!quote) ui.toast(`Cotización ${q2.folio} creada`)
      else if (q2.currentVersion !== prev) ui.toast(`Se creó la versión ${q2.currentVersion} de ${q2.folio}; la anterior se conservó.`)
      else ui.toast(`Cotización ${q2.folio} actualizada`)
    }
  }

  return (
    <Sheet title={quote ? `Editar cotización ${quote.folio}` : 'Nueva cotización'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !!blocked} onClick={save}>{willVersion ? `Guardar como versión ${Math.max(...quote!.versions.map((v) => v.n)) + 1}` : quote ? 'Guardar cambios' : 'Guardar cotización'}</button></>}>
      <div className="stack-lg">
        {error && <div className="banner bad" role="alert">{error}</div>}
        {blocked && <div className="banner bad" role="alert">Una cotización {quote!.status === 'aprobada' ? 'aprobada' : 'convertida'} no se edita para no alterar lo que el cliente aceptó. Duplícala desde su detalle para crear otra.</div>}
        {willVersion && <div className="banner info" role="status">Esta cotización ya fue <b>{quote!.status}</b>. Al guardar se creará una <b>nueva versión</b> y se conservará la anterior en el historial; volverá a «Borrador» y habrá que marcarla como enviada otra vez.</div>}
        <section className="stack" aria-labelledby="qf-cliente">
          <h3 id="qf-cliente">Cliente y vehículo</h3>
          <CustomerPicker data={data} value={f.customerId} onChange={(id) => setF((x) => ({ ...x, customerId: id, vehicleId: id === x.customerId ? x.vehicleId : '' }))} error={show('customerId')} autoFocus={!f.customerId} />
          <VehiclePicker data={data} customerId={f.customerId} value={f.vehicleId} onChange={(id) => set('vehicleId', id)} error={show('vehicleId')} />
        </section>

        <section className="stack" aria-labelledby="qf-partidas">
          <h3 id="qf-partidas">Partidas</h3>
          {show('items') && <div className="err" role="alert">{errs.items}</div>}
          <div className="stack-sm">
            {items.map((d, idx) => {
              const a = lineAmounts({ qty: d.qty ?? 0, unitPriceCents: d.unitPriceCents ?? 0, discountCents: d.discountCents ?? 0, taxRate: d.taxRate }, s.pricesIncludeTax)
              const e = touched ? lineErr(d) : ''
              const stock = d.refId && d.type !== 'servicio' ? data.stock.get(d.refId)?.qty ?? 0 : undefined
              const rates = s.taxes.some((t) => t.rate === d.taxRate) ? s.taxes : [...s.taxes, { id: 'x', name: `${d.taxRate} %`, rate: d.taxRate }]
              return (
                <div className="crm-line" key={d.key} role="group" aria-label={`Partida ${idx + 1}: ${d.description || 'sin descripción'}`}>
                  <div className="row between"><span className="badge info">{ITEM_TYPE_LABEL[d.type]}</span><button type="button" className="btn small danger" onClick={() => setItems((l) => l.filter((x) => x.key !== d.key))} aria-label={`Quitar partida ${idx + 1}`}>Quitar</button></div>
                  <Field label="Descripción" error={e && !d.description.trim() ? e : ''}><input value={d.description} onChange={(ev) => patch(d.key, { description: ev.target.value })} autoComplete="off" /></Field>
                  <div className="crm-line-grid">
                    <Field label="Cantidad" hint={stock !== undefined ? `Existencias: ${formatNum(stock)} ${d.unit}` : undefined}><NumInput value={d.qty} onChange={(v) => patch(d.key, { qty: v })} invalid={!!e && !(d.qty !== undefined && d.qty > 0)} /></Field>
                    <Field label={s.pricesIncludeTax ? 'Precio unitario (IVA incluido)' : 'Precio unitario (sin IVA)'}><MoneyInput cents={d.unitPriceCents} onChange={(v) => patch(d.key, { unitPriceCents: v })} /></Field>
                    <Field label="Descuento de la partida"><MoneyInput cents={d.discountCents} onChange={(v) => patch(d.key, { discountCents: v })} /></Field>
                    <Field label="IVA"><select value={String(d.taxRate)} onChange={(ev) => patch(d.key, { taxRate: Number(ev.target.value) })}>{rates.map((t) => <option key={t.id + t.rate} value={t.rate}>{t.name.includes('%') ? t.name : `${t.name} (${t.rate} %)`}</option>)}</select></Field>
                  </div>
                  {!d.refId && showCost && <Field label="Costo estimado unitario (uso interno)" hint="Solo para calcular el margen previsto; no aparece en la cotización."><MoneyInput cents={d.estUnitCost === undefined ? undefined : Math.round(d.estUnitCost)} onChange={(v) => patch(d.key, { estUnitCost: v })} /></Field>}
                  {stock !== undefined && d.qty !== undefined && d.qty > stock && <div className="small" style={{ color: 'var(--warn)' }}>La cantidad supera las existencias: habrá que comprar la diferencia antes de instalar.</div>}
                  {e && d.description.trim() && <div className="err" role="alert">{e}</div>}
                  <div className="row between small"><span className="muted">Importe de la partida</span><b className="num">{formatMXN(a.totalCents)} <span className="muted" style={{ fontWeight: 400 }}>(neto {formatMXN(a.netCents)} + IVA {formatMXN(a.taxCents)})</span></b></div>
                </div>
              )
            })}
            {!items.length && <div className="muted small">Aún no hay partidas. Agrega servicios, refacciones o cargos con las opciones de abajo.</div>}
          </div>

          <div className="crm-add" role="group" aria-label="Agregar partida">
            <b>Agregar partida</b>
            <Seg value={addType} options={ADD_TYPES} onChange={(v) => { setAddType(v); setQ('') }} label="Tipo de partida" />
            {(addType === 'servicio' || addType === 'refaccion' || addType === 'consumible') ? (
              <>
                <div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={addType === 'servicio' ? 'Buscar servicio del catálogo' : 'Buscar por nombre, SKU o número de parte'} aria-label="Buscar en el catálogo" /></div>
                <div className="crm-results" role="group" aria-label="Resultados del catálogo">
                  {svcResults.map((x) => (
                    <button key={x.id} type="button" className="item" onClick={() => addService(x.id)}><div className="grow"><div className="ttl">{x.name}</div><div className="sub">{x.category}{x.stdHours ? ` · ${x.stdHours} h` : ''}</div></div><b className="num">{formatMXN(x.priceCents)}</b></button>
                  ))}
                  {prodResults.map((p) => {
                    const st = data.stock.get(p.id)?.qty ?? 0
                    return <button key={p.id} type="button" className="item" onClick={() => addProduct(p.id)}><div className="grow"><div className="ttl">{p.name}</div><div className="sub">{p.sku} · {st > 0 ? `${formatNum(st)} ${p.unit} en existencia` : 'Sin existencias'}</div></div><b className="num">{formatMXN(p.priceCents)}</b></button>
                  })}
                  {!svcResults.length && !prodResults.length && <div className="small muted">No hay coincidencias en el catálogo.</div>}
                </div>
              </>
            ) : <button type="button" className="btn" onClick={addManual}>+ Agregar {addType === 'externo' ? 'servicio externo' : 'otro cargo'}</button>}
          </div>
        </section>

        <section className="stack" aria-labelledby="qf-totales">
          <h3 id="qf-totales">Totales</h3>
          <div className="grid3" role="group" aria-label="Totales de la cotización">
            <div className="stat"><div className="l">Subtotal neto</div><div className="v num">{formatMXN(sum.netCents)}</div></div>
            <div className="stat"><div className="l">IVA</div><div className="v num">{formatMXN(sum.taxCents)}</div></div>
            <div className="stat"><div className="l">Total al cliente</div><div className="v num">{formatMXN(sum.totalCents)}</div></div>
          </div>
          {showCost && (
            <div className="card flat stack-sm" role="group" aria-label="Resumen interno de margen">
              <div className="row between wrap"><b>Resumen interno (margen previsto)</b><span className="badge warn">Uso interno, no aparece en la cotización del cliente</span></div>
              <div className="grid3">
                <div><div className="small muted">Costo estimado</div><div className="num"><b>{formatMXN(sum.estCostCents)}</b></div></div>
                <div><div className="small muted">Utilidad prevista</div><div className="num"><b>{formatMXN(sum.estProfitCents)}</b></div></div>
                <div><div className="small muted">Margen sobre venta neta</div><div className="num"><b>{formatPct(sum.estMarginPct)}</b></div><div className="small muted">Markup sobre costo: {formatPct(sum.estMarkupPct)}</div></div>
              </div>
              {noCost > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{noCost} partida(s) sin costo estimado disponible en esta vista previa: el margen puede verse mayor al real. El costo definitivo se calcula al guardar.</div>}
            </div>
          )}
        </section>

        <section className="stack" aria-labelledby="qf-cond">
          <h3 id="qf-cond">Condiciones</h3>
          <div className="grid2">
            <Field label="Tiempo estimado de trabajo (días)" error={show('days')}><NumInput value={f.estimatedDays} onChange={(v) => set('estimatedDays', v)} inputMode="decimal" invalid={!!show('days')} /></Field>
            {quote && quote.status === 'borrador'
              ? <Field label="Vigencia" hint="La vigencia de un borrador ya creado no cambia al editarlo."><input value={`Hasta el ${quote.validUntil}`} readOnly /></Field>
              : <Field label="Vigencia (días a partir de hoy)"><NumInput value={f.validDays} onChange={(v) => set('validDays', v)} inputMode="numeric" /></Field>}
          </div>
          <Field label="Notas para el cliente"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <Field label="Condiciones comerciales"><textarea value={f.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
          <Field label="Garantía"><textarea value={f.warranty} onChange={(e) => set('warranty', e.target.value)} /></Field>
        </section>
      </div>
    </Sheet>
  )
}
