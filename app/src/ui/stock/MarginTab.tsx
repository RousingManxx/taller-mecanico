import { useMemo, useState } from 'react'
import { costIncreased } from '../../domain/alerts'
import { formatMXN } from '../../domain/money'
import type { Data } from '../data'
import { Badge, Chips, DataTable, Empty, type Column } from '../ui'
import { useProductRows, type PRow } from './helpers'
import { Pct } from './parts'
import { ALERT_BADGE, ALERT_TONE } from './helpers'

type F = 'alerta' | 'bajo_costo' | 'margen_bajo' | 'sin_costo' | 'costo' | 'todos'

/** Rentabilidad por producto: precio neto contra costo vigente. Solo con permiso de costos. */
export function MarginTab({ data: d, openProduct }: { data: Data; openProduct: (id: string) => void }) {
  const rows = useProductRows(d)
  const [f, setF] = useState<F>('alerta')
  const act = useMemo(() => rows.filter((r) => r.p.active), [rows])
  const inc = (r: PRow) => costIncreased(r.p.prevPurchaseCost, r.p.lastPurchaseCost ?? 0) && (r.alert.marginPct ?? 100) < d.settings.targetMarginPct
  const test: Record<F, (r: PRow) => boolean> = { alerta: (r) => !!r.alert.kind && r.alert.kind !== 'sin_costo' || inc(r), bajo_costo: (r) => r.alert.kind === 'bajo_costo', margen_bajo: (r) => r.alert.kind === 'margen_bajo', sin_costo: (r) => r.alert.kind === 'sin_costo', costo: inc, todos: () => true }
  const count = (k: F) => act.filter(test[k]).length
  const list = useMemo(() => act.filter(test[f]).sort((a, b) => (a.margin ?? 1e9) - (b.margin ?? 1e9) || a.p.name.localeCompare(b.p.name, 'es')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act, f, d.settings.targetMarginPct])
  const cols: Column<PRow>[] = [
    { key: 'name', label: 'Producto', primary: true, render: (r) => <span><span className="stk-name">{r.p.name}</span><br /><span className="stk-sub stk-mono">{r.p.sku}</span></span> },
    { key: 'net', label: 'Precio neto', align: 'r', render: (r) => <span className="num">{formatMXN(r.net)}</span> },
    { key: 'cost', label: 'Costo vigente', align: 'r', render: (r) => r.cost > 0 ? <span className="num">{formatMXN(Math.round(r.cost))}{r.costIsLast ? '*' : ''}</span> : <span className="muted">—</span> },
    { key: 'profit', label: 'Utilidad por unidad', align: 'r', hideMobile: true, render: (r) => r.cost > 0 ? <span className={`num ${r.net - r.cost < 0 ? 'neg' : ''}`}>{formatMXN(Math.round(r.net - r.cost))}</span> : <span className="muted">n/c</span> },
    { key: 'margin', label: 'Margen', align: 'r', render: (r) => <Pct v={r.margin} /> },
    { key: 'markup', label: 'Markup', align: 'r', hideMobile: true, render: (r) => <Pct v={r.markup} /> },
    { key: 'min', label: 'Mínimo', align: 'r', hideMobile: true, render: (r) => <span className="num">{r.alert.minMarginPct} %</span> },
    { key: 'st', label: 'Estado', render: (r) => <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{r.alert.kind ? <Badge tone={ALERT_TONE[r.alert.kind] || undefined}>{ALERT_BADGE[r.alert.kind]}</Badge> : <Badge tone="ok">Sano</Badge>}{inc(r) && <Badge tone="warn">Costo subió</Badge>}</span> },
  ]
  return (
    <div className="stack">
      <div className="small muted">Margen = utilidad ÷ precio neto (antes de IVA); markup = utilidad ÷ costo. El costo vigente es el promedio del inventario (o el último costo de compra si no hay existencias, marcado con *). Ordenado de menor a mayor margen.</div>
      <Chips<F> value={f} onChange={setF} options={[['alerta', `Con alerta (${count('alerta')})`], ['bajo_costo', `Bajo costo (${count('bajo_costo')})`], ['margen_bajo', `Margen bajo (${count('margen_bajo')})`], ['costo', `Costo subió (${count('costo')})`], ['sin_costo', `Sin costo (${count('sin_costo')})`], ['todos', `Todos (${count('todos')})`]]} />
      <DataTable rows={list} columns={cols} rowKey={(r) => r.p.id} onRow={(r) => openProduct(r.p.id)} empty={<Empty title={f === 'alerta' ? 'Sin productos con alerta de margen' : 'Sin productos en esta vista'} text="Los precios cubren el costo y el margen mínimo." />} />
    </div>
  )
}
