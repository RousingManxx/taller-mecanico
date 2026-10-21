import { useMemo, useState } from 'react'
import { serviceAlertFor } from '../../domain/alerts'
import { formatMXN, formatNum } from '../../domain/money'
import { markupPct } from '../../domain/pricing'
import { netPrice, taxRateOf } from '../../domain/alerts'
import type { ServiceDef } from '../../domain/types'
import { useOpen } from '../create'
import type { Data } from '../data'
import { Badge, DataTable, Empty, Icon, type Column } from '../ui'
import { norm, useLaborRate, useQParam } from './helpers'
import { Pct } from './parts'
import { ALERT_BADGE, ALERT_TONE, priceLabel } from './helpers'

export function ServicesTab({ data: d, openService }: { data: Data; openService: (id: string) => void }) {
  const open = useOpen()
  const canCost = d.can('costos.ver')
  const rate = useLaborRate()
  const [q, setQ] = useQParam()
  const [cat, setCat] = useState('')
  const [inactive, setInactive] = useState(false)
  const cats = useMemo(() => [...new Set([...d.settings.serviceCategories, ...d.services.map((s) => s.category)])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')), [d.settings.serviceCategories, d.services])
  const list = useMemo(() => {
    const t = norm(q.trim())
    return d.services.filter((s) => (inactive || s.active) && (!cat || s.category === cat) && (!t || norm(s.name).includes(t) || norm(s.category).includes(t) || norm(s.description).includes(t))).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [d.services, q, cat, inactive])
  const calc = (s: ServiceDef) => {
    if (rate === undefined || !(rate > 0) || !(s.stdHours > 0)) return null
    const cost = s.stdHours * rate, al = serviceAlertFor(s, cost, d.settings)
    return { cost, margin: al.marginPct, markup: markupPct(netPrice(s.priceCents, taxRateOf(d.settings, s.taxId), d.settings.pricesIncludeTax), cost), kind: al.kind }
  }
  const cols: Column<ServiceDef>[] = [
    { key: 'name', label: 'Servicio', primary: true, render: (s) => <span><span className="stk-name">{s.name}</span>{!s.active && <> <Badge>Inactivo</Badge></>}<br /><span className="stk-sub">{s.category}</span></span> },
    { key: 'hours', label: 'Horas estándar', align: 'r', render: (s) => <span className="num">{formatNum(s.stdHours)} h</span> },
    { key: 'price', label: priceLabel(d), align: 'r', render: (s) => <span className="num">{formatMXN(s.priceCents)}</span> },
    ...(canCost ? [
      { key: 'cost', label: 'Costo estimado', align: 'r', render: (s: ServiceDef) => { const c = calc(s); return c ? <span className="num">{formatMXN(Math.round(c.cost))}</span> : <span className="muted">n/c</span> } },
      { key: 'margin', label: 'Margen', align: 'r', render: (s: ServiceDef) => <Pct v={calc(s)?.margin ?? null} /> },
      { key: 'alert', label: 'Rentabilidad', render: (s: ServiceDef) => { const k = s.active ? calc(s)?.kind : null; return k ? <Badge tone={ALERT_TONE[k] || undefined}>{ALERT_BADGE[k]}</Badge> : <span className="muted">—</span> } },
    ] as Column<ServiceDef>[] : []),
  ]
  return (
    <div className="stack">
      <div className="stk-tools t3">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o categoría del servicio" /></div></label>
        <label className="f">Categoría<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        {d.can('precios.editar') && <button className="btn primary" onClick={() => open({ k: 'service' })}><Icon n="plus" size={18} />Nuevo servicio</button>}
      </div>
      <label className="chk"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Mostrar servicios inactivos</label>
      <DataTable rows={list} columns={cols} rowKey={(s) => s.id} onRow={(s) => openService(s.id)}
        empty={d.services.length === 0 ? <Empty title="Aún no hay servicios" text="El catálogo de mano de obra agiliza cotizaciones y órdenes." action={d.can('precios.editar') ? <button className="btn primary" onClick={() => open({ k: 'service' })}>Nuevo servicio</button> : undefined} /> : <Empty title="Sin resultados" />} />
      <div className="small muted">
        {canCost && (rate === undefined ? 'Calculando costo laboral…' : rate > 0 ? `Costo estimado = horas estándar × costo laboral promedio de los mecánicos (${formatMXN(rate)} por hora). Margen = utilidad ÷ precio neto.` : 'Sin costo laboral registrado: captura el costo mensual de los mecánicos en Personal para estimar costos y márgenes.')}
      </div>
    </div>
  )
}
