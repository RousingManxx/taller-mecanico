import { useMemo, useState } from 'react'
import { formatMXN, formatQty, round } from '../../domain/money'
import { useOpen } from '../create'
import type { Data } from '../data'
import { Empty, NumInput } from '../ui'
import { suggestQty, supplierCost, useProductRows, type PRow } from './helpers'
import { unitCostOf } from '../alerts'

interface Line { r: PRow; supplierId: string; qty: number; suggested: number; unitCost: number | undefined; lead: number }

/** Propuesta de compra: productos bajo mínimo con cantidad sugerida editable, agrupados por proveedor. No compra nada: abre la orden precargada para revisión. */
export function ProposalTab({ data: d }: { data: Data }) {
  const open = useOpen()
  const canCost = d.can('costos.ver')
  const rows = useProductRows(d)
  const [edits, setEdits] = useState<Record<string, { qty?: number | null; sup?: string }>>({})
  const sups = useMemo(() => d.suppliers.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [d.suppliers])
  const lines = useMemo<Line[]>(() => rows.filter((r) => r.p.active && r.qty <= r.p.minStock).sort((a, b) => a.p.name.localeCompare(b.p.name, 'es')).map((r) => {
    const cheapest = d.supplierProducts.filter((x) => x.productId === r.p.id && d.supMap.get(x.supplierId)?.active).sort((a, b) => a.lastCostCents - b.lastCostCents)[0]
    const base = r.p.supplierId && d.supMap.get(r.p.supplierId)?.active ? r.p.supplierId : cheapest?.supplierId ?? ''
    const supplierId = edits[r.p.id]?.sup ?? base
    const lead = d.supMap.get(supplierId)?.leadDays ?? 0
    const suggested = suggestQty(r.p.minStock, r.qty, r.out60 / 60, lead)
    const e = edits[r.p.id]?.qty
    const cost = supplierCost(d, supplierId, r.p.id) ?? r.p.lastPurchaseCost ?? unitCostOf(d, r.p.id)
    return { r, supplierId, qty: e === undefined ? suggested : e ?? 0, suggested, unitCost: cost > 0 ? round(cost) : undefined, lead }
  }), [rows, edits, d])
  const groups = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of lines) m.set(l.supplierId, [...(m.get(l.supplierId) ?? []), l])
    return [...m].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : (d.supMap.get(a[0])?.name ?? '').localeCompare(d.supMap.get(b[0])?.name ?? '', 'es')))
  }, [lines, d])
  if (!lines.length) return <Empty title="Nada por reponer" text="Ningún producto activo está en su mínimo o por debajo. Cuando haya, aquí verás una propuesta de compra." />
  const setE = (id: string, p: { qty?: number | null; sup?: string }) => setEdits((x) => ({ ...x, [id]: { ...x[id], ...p } }))
  return (
    <div className="stack-lg">
      <div className="banner info">
        Cantidad sugerida = máx(0, mínimo × 2 + consumo diario × días de entrega del proveedor − existencias), redondeada hacia arriba. El consumo diario sale de las ventas y consumos de los últimos 60 días. Es solo una propuesta: edita las cantidades y revisa la orden antes de enviarla.
      </div>
      {groups.map(([sid, ls]) => {
        const sup = d.supMap.get(sid)
        const total = ls.reduce((a, l) => a + (l.unitCost !== undefined ? round(l.qty * l.unitCost) : 0), 0)
        const missing = ls.filter((l) => l.qty > 0 && l.unitCost === undefined).length
        const items = ls.filter((l) => l.qty > 0).map((l) => ({ productId: l.r.p.id, qty: l.qty }))
        return (
          <section key={sid || 'none'} className="card stack" aria-label={sup?.name ?? 'Sin proveedor'}>
            <div className="row between wrap">
              <div><h3>{sup?.name ?? 'Sin proveedor asignado'}</h3><div className="small muted">{sup ? `Entrega en ${sup.leadDays} día(s) · ${sup.paymentTermsDays > 0 ? `crédito ${sup.paymentTermsDays} días` : 'contado'}` : 'Elige un proveedor en cada producto para poder crear la orden.'}</div></div>
              {sup && <button className="btn primary" disabled={!items.length || !d.can('compras.editar')} title={!d.can('compras.editar') ? 'No tienes permiso para crear órdenes de compra' : undefined} onClick={() => open({ k: 'purchase', supplierId: sid, items })}>Crear orden de compra ({items.length})</button>}
            </div>
            <div>
              <div className="stk-prow head"><span>Producto</span><span>Existencias / mín.</span><span>Salidas 60 d</span><span>Cantidad a comprar</span><span>Proveedor</span><span className="r">Costo unit. est.</span><span className="r">Subtotal</span></div>
              {ls.map((l) => (
                <div key={l.r.p.id} className="stk-prow">
                  <div className="nm"><span className="stk-name">{l.r.p.name}</span><br /><span className="stk-sub stk-mono">{l.r.p.sku}</span></div>
                  <div><span className="lbl">Existencias / mín.</span><span className="num">{formatQty(l.r.qty)} / {formatQty(l.r.p.minStock)} {l.r.p.unit}</span></div>
                  <div><span className="lbl">Salidas 60 días</span><span className="num">{formatQty(l.r.out60)}</span></div>
                  <label className="f"><span className="lbl">Cantidad (sugerida {l.suggested})</span><NumInput aria-label={`Cantidad a comprar de ${l.r.p.name}`} value={edits[l.r.p.id]?.qty === null ? undefined : l.qty} onChange={(v) => setE(l.r.p.id, { qty: v === undefined ? null : v })} /></label>
                  <label className="f"><span className="lbl">Proveedor</span>
                    <select aria-label={`Proveedor de ${l.r.p.name}`} value={l.supplierId} onChange={(e) => setE(l.r.p.id, { sup: e.target.value })}><option value="">— Elegir —</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                  <div className="r"><span className="lbl">Costo unit. est.</span>{canCost ? (l.unitCost !== undefined ? <span className="num">{formatMXN(l.unitCost)}</span> : <span className="muted">Sin costo</span>) : <span className="muted">—</span>}</div>
                  <div className="r"><span className="lbl">Subtotal</span>{canCost ? (l.unitCost !== undefined ? <b className="num">{formatMXN(round(l.qty * l.unitCost))}</b> : <span className="muted">—</span>) : <span className="muted">—</span>}</div>
                </div>
              ))}
            </div>
            {canCost && <div className="row between wrap small"><span className="muted">Costo estimado al último costo de compra (sin IVA){missing ? ` · ${missing} partida(s) sin costo conocido` : ''}</span><b className="num">{formatMXN(total)}</b></div>}
          </section>
        )
      })}
    </div>
  )
}
