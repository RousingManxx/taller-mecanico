import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Data } from './data'
import { Icon } from './ui'

interface Hit { id: string; group: string; title: string; sub: string; to: string }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Búsqueda global: clientes, vehículos, órdenes, cotizaciones, ventas, productos y proveedores. Respeta los permisos. */
export function useSearch(d: Data, q: string): Hit[] {
  return useMemo(() => {
    const t = norm(q.trim())
    if (t.length < 2) return []
    const has = (...s: (string | undefined | number)[]) => s.some((x) => x !== undefined && norm(String(x)).includes(t))
    const out: Hit[] = []
    const push = (h: Hit) => { if (out.filter((x) => x.group === h.group).length < 6) out.push(h) }
    if (d.can('clientes.ver')) for (const c of d.customers) if (has(c.name, c.phone, c.email, c.taxId)) push({ id: c.id, group: 'Clientes', title: c.name, sub: c.phone || c.email, to: `/clientes/${c.id}` })
    if (d.can('vehiculos.ver')) for (const v of d.vehicles) if (has(v.plate, v.vin, v.make, v.model)) push({ id: v.id, group: 'Vehículos', title: `${v.make} ${v.model} ${v.year ?? ''}`.trim(), sub: `${v.plate} · ${d.custMap.get(v.customerId)?.name ?? ''}`, to: `/vehiculos/${v.id}` })
    if (d.can('ordenes.ver')) for (const o of d.orders) if (has(o.folio, o.complaint)) push({ id: o.id, group: 'Órdenes', title: o.folio, sub: `${d.custMap.get(o.customerId)?.name ?? ''} · ${d.vehMap.get(o.vehicleId)?.plate ?? ''}`, to: `/ordenes/${o.id}` })
    if (d.can('cotizaciones.ver')) for (const x of d.quotations) if (has(x.folio)) push({ id: x.id, group: 'Cotizaciones', title: x.folio, sub: d.custMap.get(x.customerId)?.name ?? '', to: `/cotizaciones/${x.id}` })
    if (d.can('ventas.ver')) for (const s of d.sales) if (has(s.folio, s.customerName)) push({ id: s.id, group: 'Ventas', title: s.folio, sub: `${s.customerName} · ${s.date}`, to: `/ventas/${s.id}` })
    if (d.can('inventario.ver')) for (const p of d.products) if (has(p.sku, p.name, p.partNo, p.barcode, p.brand)) push({ id: p.id, group: 'Productos', title: p.name, sub: `${p.sku} · ${d.stock.get(p.id)?.qty ?? 0} ${p.unit}`, to: `/inventario?q=${encodeURIComponent(p.sku)}` })
    if (d.can('compras.ver')) for (const s of d.suppliers) if (has(s.name, s.contact, s.phone)) push({ id: s.id, group: 'Proveedores', title: s.name, sub: s.phone, to: '/compras' })
    return out
  }, [d, q])
}

export function SearchPanel({ data, onPick, autoFocus }: { data: Data; onPick: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const hits = useSearch(data, q)
  const nav = useNavigate()
  const groups = [...new Set(hits.map((h) => h.group))]
  return (
    <div className="stack">
      <div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, placas, folio, SKU…" aria-label="Búsqueda global" autoFocus={autoFocus} /></div>
      {q.trim().length >= 2 && !hits.length && <div className="muted small">Sin resultados para «{q}».</div>}
      {groups.map((g) => (
        <div key={g} className="stack-sm"><div className="small muted" style={{ fontWeight: 700 }}>{g}</div>
          {hits.filter((h) => h.group === g).map((h) => <button key={h.id} className="item" onClick={() => { nav(h.to); onPick() }}><div className="grow"><div className="ttl">{h.title}</div><div className="sub">{h.sub}</div></div><Icon n="chevron" size={16} /></button>)}
        </div>
      ))}
    </div>
  )
}
