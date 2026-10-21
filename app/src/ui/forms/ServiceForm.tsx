import { useState } from 'react'
import '../css/stock.css'
import { netPrice, taxRateOf } from '../../domain/alerts'
import { formatMXN, formatPct } from '../../domain/money'
import { marginPct, markupPct } from '../../domain/pricing'
import type { ServiceDef } from '../../domain/types'
import { saveService } from '../../services/catalog'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Pct } from '../stock/parts'
import { useLaborRate } from '../stock/helpers'
import { Badge, Field, MoneyInput, NumInput, Sheet, useBusy, useUi } from '../ui'

export function ServiceForm({ data: d, service, onClose }: { data: Data; service?: ServiceDef; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const s = d.settings, canCost = d.can('costos.ver')
  const rate = useLaborRate()
  const [f, setF] = useState({
    name: service?.name ?? '', category: service?.category ?? s.serviceCategories[0] ?? '', description: service?.description ?? '',
    stdHours: service?.stdHours as number | undefined, priceCents: service?.priceCents as number | undefined, taxId: service?.taxId ?? s.defaultTaxId,
    minMarginPct: service?.minMarginPct as number | undefined, active: service?.active ?? true,
  })
  const [tried, setTried] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const name = f.name.trim()
  const err = {
    name: !name ? 'El nombre es obligatorio.' : d.services.some((x) => x.id !== service?.id && x.name.toLowerCase() === name.toLowerCase()) ? 'Ya existe un servicio con ese nombre.' : undefined,
    hours: f.stdHours !== undefined && f.stdHours < 0 ? 'No puede ser negativo.' : undefined,
    price: f.priceCents === undefined ? 'Captura el precio.' : undefined,
    minMargin: f.minMarginPct !== undefined && !(f.minMarginPct >= 0 && f.minMarginPct < 100) ? 'Debe estar entre 0 y 99.9.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried || (k === 'name' && !!name)) ? err[k] : undefined
  const tax = taxRateOf(s, f.taxId), price = f.priceCents ?? 0
  const net = netPrice(price, tax, s.pricesIncludeTax), total = s.pricesIncludeTax ? price : Math.round(price * (1 + tax / 100))
  const cost = rate && f.stdHours ? f.stdHours * rate : 0
  const margin = cost > 0 ? marginPct(net, cost) : null
  const minM = f.minMarginPct ?? s.minMarginPct
  const save = () => guard(async () => {
    setTried(true)
    if (hasErr) { ui.toast('Revisa los campos marcados en rojo.', true); return }
    const r = await ui.run(() => saveService(ctx, { id: service?.id, name, category: f.category, description: f.description, stdHours: f.stdHours ?? 0, priceCents: f.priceCents, taxId: f.taxId, minMarginPct: f.minMarginPct, active: f.active }), service ? 'Servicio actualizado' : 'Servicio creado')
    if (r) onClose()
  })
  return (
    <Sheet title={service ? 'Editar servicio' : 'Nuevo servicio'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={save}>{service ? 'Guardar cambios' : 'Crear servicio'}</button>
    </>}>
      <div className="stack">
        <Field label="Nombre del servicio *" error={show('name')}><input value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!show('name') || undefined} autoComplete="off" /></Field>
        <div className="grid">
          <Field label="Categoría"><input list="stk-scats" value={f.category} onChange={(e) => set('category', e.target.value)} autoComplete="off" /></Field>
          <datalist id="stk-scats">{s.serviceCategories.map((c) => <option key={c} value={c} />)}</datalist>
          <Field label="Horas estándar" error={show('hours')} hint="Tiempo de referencia para cotizar y medir eficiencia"><NumInput value={f.stdHours} onChange={(v) => set('stdHours', v)} invalid={!!show('hours')} /></Field>
        </div>
        <Field label="Descripción"><textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} /></Field>
        <div className="grid">
          <Field label={`Precio (${s.pricesIncludeTax ? 'incluye IVA' : 'antes de IVA'}) *`} error={show('price')} hint={s.pricesIncludeTax ? `Sin IVA: ${formatMXN(net)}` : `Con IVA: ${formatMXN(total)}`}><MoneyInput cents={f.priceCents} onChange={(c) => set('priceCents', c)} invalid={!!show('price')} disabled={!!service && !d.can('precios.editar')} /></Field>
          <Field label="Impuesto"><select value={f.taxId} onChange={(e) => set('taxId', e.target.value)}>{s.taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rate} %)</option>)}</select></Field>
          <Field label="Margen mínimo propio (%)" error={show('minMargin')} hint={`Vacío = el global (${formatPct(s.minMarginPct)})`}><NumInput value={f.minMarginPct} onChange={(v) => set('minMarginPct', v)} invalid={!!show('minMargin')} /></Field>
        </div>
        {canCost && (
          <div className="card flat stack" aria-live="polite">
            <b>Vista previa de rentabilidad</b>
            {cost > 0 ? (
              <>
                <div className="row wrap" style={{ gap: 18 }}>
                  <span>Costo estimado <b className="num">{formatMXN(Math.round(cost))}</b></span>
                  <span>Margen <b><Pct v={margin} /></b></span>
                  <span>Markup <b><Pct v={markupPct(net, cost)} /></b></span>
                </div>
                {net < cost ? <Badge tone="bad">El precio queda por debajo del costo</Badge> : margin !== null && margin < minM ? <Badge tone="warn">Margen menor al mínimo ({formatPct(minM)})</Badge> : <Badge tone="ok">Cumple el margen mínimo</Badge>}
              </>
            ) : <div className="small muted">{rate === undefined ? 'Calculando…' : rate <= 0 ? 'Sin costo laboral registrado: captura el costo mensual de los mecánicos en Personal.' : 'Captura las horas estándar para estimar el costo (horas × costo laboral promedio).'}</div>}
          </div>
        )}
        {service && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Servicio activo</label>}
      </div>
    </Sheet>
  )
}
