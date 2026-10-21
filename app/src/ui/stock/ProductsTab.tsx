import { useMemo, useState } from 'react'
import { formatMXN, formatQty } from '../../domain/money'
import { Icon, Badge, DataTable, Empty, type Column } from '../ui'
import { useOpen } from '../create'
import type { Data } from '../data'
import { norm, useParam, useProductRows, useQParam, type PRow } from './helpers'
import { Pct } from './parts'
import { ALERT_BADGE, ALERT_TONE, priceLabel } from './helpers'

type Sort = 'nombre' | 'existencias' | 'margen' | 'valor'

export function ProductsTab({ data: d, openProduct }: { data: Data; openProduct: (id: string) => void }) {
  const open = useOpen()
  const canCost = d.can('costos.ver')
  const rows = useProductRows(d)
  const [q, setQ] = useQParam()
  const [state, setState] = useParam('e')
  const [cat, setCat] = useState('')
  const [sort, setSort] = useState<Sort>('nombre')
  const [inactive, setInactive] = useState(false)
  const cats = useMemo(() => [...new Set([...d.settings.productCategories, ...d.products.map((p) => p.category)])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')), [d.settings.productCategories, d.products])
  const list = useMemo(() => {
    const t = norm(q.trim())
    let r = rows.filter((x) => (inactive || x.p.active) && (!cat || x.p.category === cat))
    if (state === 'bajo') r = r.filter((x) => x.p.active && x.state === 'bajo')
    if (state === 'agotado') r = r.filter((x) => x.p.active && x.state === 'agotado')
    if (state === 'alerta') r = r.filter((x) => x.p.active && x.state !== 'ok')
    if (t) r = r.filter((x) => [x.p.sku, x.p.name, x.p.partNo, x.p.brand, x.p.barcode, x.p.category].some((s) => norm(s).includes(t)))
    const by: Record<Sort, (a: PRow, b: PRow) => number> = {
      nombre: (a, b) => a.p.name.localeCompare(b.p.name, 'es'), existencias: (a, b) => a.qty - b.qty || a.p.name.localeCompare(b.p.name, 'es'),
      margen: (a, b) => (a.margin ?? 1e9) - (b.margin ?? 1e9), valor: (a, b) => b.value - a.value,
    }
    return [...r].sort(by[sort])
  }, [rows, q, state, cat, sort, inactive])

  const stockCell = (x: PRow) => (
    <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <span className="num">{formatQty(x.qty)} {x.p.unit}</span>
      {x.p.active && x.state === 'agotado' && <Badge tone="bad">Agotado</Badge>}
      {x.p.active && x.state === 'bajo' && <Badge tone="warn">Bajo mínimo</Badge>}
    </span>
  )
  const cols: Column<PRow>[] = [
    { key: 'name', label: 'Producto', primary: true, render: (x) => <span><span className="stk-name">{x.p.name}</span>{!x.p.active && <> <Badge>Inactivo</Badge></>}<br /><span className="stk-sub"><span className="stk-mono">{x.p.sku}</span>{x.p.brand ? ` · ${x.p.brand}` : ''}</span></span> },
    { key: 'cat', label: 'Categoría', hideMobile: true, render: (x) => x.p.category },
    { key: 'qty', label: 'Existencias', align: 'r', render: stockCell },
    { key: 'price', label: priceLabel(d), align: 'r', render: (x) => <span className="num">{formatMXN(x.p.priceCents)}</span> },
    ...(canCost ? [
      { key: 'cost', label: 'Costo prom.', align: 'r', render: (x: PRow) => x.cost > 0 ? <span className="num" title={x.costIsLast ? 'Sin existencias: es el último costo de compra' : 'Valor del inventario ÷ existencias'}>{formatMXN(Math.round(x.cost))}{x.costIsLast ? '*' : ''}</span> : <span className="muted">—</span> },
      { key: 'margin', label: 'Margen', align: 'r', render: (x: PRow) => <Pct v={x.margin} /> },
      { key: 'markup', label: 'Markup', align: 'r', hideMobile: true, render: (x: PRow) => <Pct v={x.markup} /> },
      { key: 'alert', label: 'Rentabilidad', hideMobile: false, render: (x: PRow) => x.p.active && x.alert.kind ? <Badge tone={ALERT_TONE[x.alert.kind] || undefined}>{ALERT_BADGE[x.alert.kind]}</Badge> : <span className="muted">—</span> },
    ] as Column<PRow>[] : []),
  ]
  const hasCostFallback = canCost && list.some((x) => x.costIsLast && x.cost > 0)
  return (
    <div className="stack">
      <div className="stk-tools">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, nombre, parte, marca o código de barras" /></div></label>
        <label className="f">Categoría<select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Todas</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="f">Estado de existencias<select value={state} onChange={(e) => setState(e.target.value)}><option value="">Todos</option><option value="alerta">Bajo mínimo o agotado</option><option value="bajo">Bajo mínimo</option><option value="agotado">Agotado</option></select></label>
        <label className="f">Ordenar por<select value={sort} onChange={(e) => setSort(e.target.value as Sort)}><option value="nombre">Nombre</option><option value="existencias">Existencias (menor primero)</option>{canCost && <option value="margen">Margen (menor primero)</option>}{canCost && <option value="valor">Valor en inventario</option>}</select></label>
      </div>
      <label className="chk"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Mostrar productos inactivos</label>
      <DataTable rows={list} columns={cols} rowKey={(x) => x.p.id} onRow={(x) => openProduct(x.p.id)}
        empty={d.products.length === 0
          ? <Empty title="Aún no hay productos" text="Registra tu primera refacción o consumible para controlar existencias y márgenes." action={d.can('inventario.editar') ? <button className="btn primary" onClick={() => open({ k: 'product' })}>Nuevo producto</button> : undefined} />
          : <Empty title="Sin resultados" text="Prueba con otra búsqueda o quita los filtros." />} />
      <div className="small muted">{list.length} producto(s). {hasCostFallback && '* Sin existencias: se muestra el último costo de compra. '}{canCost && 'Costo promedio = valor del inventario ÷ existencias. Margen = utilidad ÷ precio neto; markup = utilidad ÷ costo.'}</div>
    </div>
  )
}
