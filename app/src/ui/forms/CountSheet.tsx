import { useMemo, useState } from 'react'
import '../css/stock.css'
import { formatMXN, formatQty, round, round3 } from '../../domain/money'
import { physicalCount } from '../../services/inventory'
import { unitCostOf } from '../alerts'
import type { Data } from '../data'
import { useCtx } from '../session'
import { norm, signed } from '../stock/helpers'
import { Field, Icon, NumInput, Sheet, useBusy, useUi } from '../ui'

const PAGE = 80

export function CountSheet({ data: d, onClose }: { data: Data; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const canCost = d.can('costos.ver')
  const wh = d.warehouses.find((w) => w.isDefault) ?? d.warehouses[0]
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [only, setOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [counted, setCounted] = useState<Record<string, number | undefined>>({})
  const [reason, setReason] = useState('')
  const sys = useMemo(() => new Map(d.balances.filter((b) => !wh || b.warehouseId === wh.id).map((b) => [b.productId, b.qty])), [d.balances, wh])
  const prods = useMemo(() => d.products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [d.products])
  const cats = useMemo(() => [...new Set(prods.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'es')), [prods])
  const diffOf = (id: string) => { const c = counted[id]; return c === undefined ? null : round3(c - (sys.get(id) ?? 0)) }
  const list = useMemo(() => {
    const t = norm(q.trim())
    return prods.filter((p) => (!cat || p.category === cat) && (!t || [p.sku, p.name, p.partNo, p.barcode].some((s) => norm(s).includes(t))) && (!only || (counted[p.id] !== undefined && round3((counted[p.id] as number) - (sys.get(p.id) ?? 0)) !== 0)))
  }, [prods, q, cat, only, counted, sys])
  const changes = prods.flatMap((p) => { const df = diffOf(p.id); return df !== null && df !== 0 ? [{ p, diff: df, value: round(df * unitCostOf(d, p.id)) }] : [] })
  const touched = Object.values(counted).filter((v) => v !== undefined).length
  const approx = changes.reduce((a, c) => a + c.value, 0)
  const negative = Object.values(counted).some((v) => v !== undefined && v < 0)
  const save = () => guard(async () => {
    if (negative) { ui.toast('Las cantidades contadas no pueden ser negativas.', true); return }
    if (!changes.length) { ui.toast(touched ? 'Todo lo contado coincide con el sistema: no hay ajustes que registrar.' : 'Captura al menos una cantidad contada.', true); return }
    if (!(await ui.confirm(`Se registrarán ${changes.length} ajuste(s) de inventario${canCost ? ` por un valor aproximado de ${formatMXN(approx)}` : ''}. Los productos que no capturaste no se tocan.`, 'Registrar inventario físico'))) return
    const r = await ui.run(() => physicalCount(ctx, changes.map((c) => ({ productId: c.p.id, counted: counted[c.p.id] as number })), reason.trim() || 'Inventario físico'), `Inventario físico registrado: ${changes.length} ajuste(s)`)
    if (r) onClose()
  })
  return (
    <Sheet title="Inventario físico" wide onClose={onClose} footer={<>
      <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{touched} contado(s) · {changes.length} con diferencia{canCost && changes.length ? ` · ${formatMXN(approx)} aprox.` : ''}</span>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || !changes.length} onClick={save}>Registrar {changes.length ? `${changes.length} ajuste(s)` : 'ajustes'}</button>
    </>}>
      <div className="stack">
        <div className="banner info">Captura lo que contaste en cada producto. Solo se ajustan los que cambian: los que dejes en blanco no se tocan{wh ? ` (se cuenta el almacén «${wh.name}»)` : ''}.</div>
        <div className="grid">
          <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder="SKU, nombre o código" /></div></label>
          <label className="f">Categoría<select value={cat} onChange={(e) => { setCat(e.target.value); setLimit(PAGE) }}><option value="">Todas</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        </div>
        <label className="chk"><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />Ver solo los que tienen diferencia</label>
        <div>
          <div className="stk-count head"><span>Producto</span><span className="r">Sistema</span><span>Contado</span><span className="r">Diferencia</span>{canCost && <span className="r">Valor aprox.</span>}</div>
          {list.slice(0, limit).map((p) => {
            const s = sys.get(p.id) ?? 0, df = diffOf(p.id), v = df ? round(df * unitCostOf(d, p.id)) : 0
            return (
              <div key={p.id} className="stk-count">
                <div><span className="stk-name">{p.name}</span><br /><span className="stk-sub stk-mono">{p.sku}</span></div>
                <label className="f"><span className="sr-only">Contado de {p.name}</span><NumInput aria-label={`Contado de ${p.name}`} value={counted[p.id]} onChange={(x) => setCounted((c) => ({ ...c, [p.id]: x }))} placeholder="—" /></label>
                <div className="meta">
                  <span className="r num"><span className="pre">Sistema: </span>{formatQty(s)} {p.unit}</span>
                  <span className={`r num ${df ? (df < 0 ? 'neg' : 'pos') : 'muted'}`}>{df === null ? 'Sin contar' : df === 0 ? 'Coincide' : <><span className="pre">Dif. </span>{signed(df)}</>}</span>
                  {canCost && <span className="r num muted">{df ? formatMXN(v) : ''}</span>}
                </div>
              </div>
            )
          })}
          {!list.length && <div className="empty"><h3>Sin productos</h3><p>No hay productos con esos filtros.</p></div>}
          {list.length > limit && <button className="btn block" onClick={() => setLimit(limit + PAGE)}>Mostrar más ({list.length - limit} restantes)</button>}
        </div>
        <Field label="Motivo o nota del conteo" hint="Se guarda en cada ajuste. Si lo dejas vacío se usa «Inventario físico»."><input value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" /></Field>
        {negative && <div className="err" role="alert">Hay cantidades contadas negativas: corrígelas.</div>}
      </div>
    </Sheet>
  )
}
