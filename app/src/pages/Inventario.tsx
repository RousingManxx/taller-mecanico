import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import '../ui/css/stock.css'
import { formatMXN } from '../domain/money'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { Icon, Seg, Stat } from '../ui/ui'
import { AlertsTab } from '../ui/stock/AlertsTab'
import { MarginTab } from '../ui/stock/MarginTab'
import { MovementsTab } from '../ui/stock/MovementsTab'
import { ProductSheet, ServiceSheet } from '../ui/stock/ProductSheets'
import { ProductsTab } from '../ui/stock/ProductsTab'
import { ProposalTab } from '../ui/stock/ProposalTab'
import { ServicesTab } from '../ui/stock/ServicesTab'

type Tab = 'productos' | 'servicios' | 'movimientos' | 'alertas' | 'margen' | 'propuesta'

export function Inventario({ data: d }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const open = useOpen()
  const canCost = d.can('costos.ver')
  const tabs: [Tab, string][] = [['productos', 'Productos'], ['servicios', 'Servicios'], ['movimientos', 'Movimientos'], ['alertas', 'Alertas'], ...(canCost ? [['margen', 'Margen'] as [Tab, string]] : []), ['propuesta', 'Propuesta de compra']]
  const raw = sp.get('f') as Tab | null
  const f: Tab = raw && tabs.some(([k]) => k === raw) ? raw : 'productos'
  const setF = (v: Tab) => setSp({ f: v }, { replace: true })
  const productId = sp.get('id'), serviceId = sp.get('sid')
  const setParam = (k: string, v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const openProduct = (id: string) => setParam('id', id)
  const openService = (id: string) => setParam('sid', id)

  const kpi = useMemo(() => {
    const act = d.products.filter((p) => p.active)
    let value = 0
    for (const s of d.stock.values()) value += s.valueCents
    return {
      value, count: act.length,
      out: act.filter((p) => (d.stock.get(p.id)?.qty ?? 0) <= 0).length,
      low: act.filter((p) => { const q = d.stock.get(p.id)?.qty ?? 0; return q > 0 && q <= p.minStock }).length,
    }
  }, [d.products, d.stock])

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Refacciones e inventario</h1><div className="sub">Existencias, costos, márgenes y movimientos de tu almacén.</div></div>
        <div className="row wrap">
          {d.can('inventario.editar') && <button className="btn primary" onClick={() => open({ k: 'product' })}><Icon n="plus" size={18} />Nuevo producto</button>}
          {d.can('inventario.ajustar') && <button className="btn" onClick={() => open({ k: 'adjust' })}>Ajuste</button>}
          {d.can('inventario.ajustar') && <button className="btn" onClick={() => open({ k: 'count' })}>Inventario físico</button>}
        </div>
      </div>

      <div className="grid" role="group" aria-label="Resumen de inventario">
        {canCost && <Stat label="Valor del inventario" value={formatMXN(kpi.value)} hint="A costo promedio, todos los almacenes" />}
        <Stat label="Productos activos" value={kpi.count} to="/inventario?f=productos" />
        <Stat label="Agotados" value={kpi.out} tone={kpi.out ? 'bad' : undefined} to="/inventario?f=productos&e=agotado" hint="Sin existencias" />
        <Stat label="Bajo mínimo" value={kpi.low} tone={kpi.low ? 'warn' : undefined} to="/inventario?f=productos&e=bajo" hint="En o por debajo del mínimo" />
      </div>

      <Seg<Tab> value={f} options={tabs} onChange={setF} label="Secciones de inventario" />

      {f === 'productos' && <ProductsTab data={d} openProduct={openProduct} />}
      {f === 'servicios' && <ServicesTab data={d} openService={openService} />}
      {f === 'movimientos' && <MovementsTab data={d} openProduct={openProduct} />}
      {f === 'alertas' && <AlertsTab data={d} openProduct={openProduct} />}
      {f === 'margen' && canCost && <MarginTab data={d} openProduct={openProduct} />}
      {f === 'propuesta' && <ProposalTab data={d} />}

      {productId && <ProductSheet data={d} id={productId} onClose={() => setParam('id', null)} />}
      {serviceId && <ServiceSheet data={d} id={serviceId} onClose={() => setParam('sid', null)} />}
    </div>
  )
}
