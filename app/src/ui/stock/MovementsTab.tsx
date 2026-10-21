import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { formatMXN } from '../../domain/money'
import type { InventoryMovement, MovementType } from '../../domain/types'
import { useOpen } from '../create'
import { fmtDate, fmtDateTime, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Empty, Icon, type Column } from '../ui'
import { ActionList } from './parts'
import { MOVE_LABEL, MOVE_TONE, norm, signed, useParam, useQParam, useUserNames } from './helpers'
import { movementDoc } from './movdoc'

export function MovementsTab({ data: d, openProduct }: { data: Data; openProduct: (id: string) => void }) {
  const ctx = useCtx(), open = useOpen()
  const names = useUserNames(ctx)
  const canCost = d.can('costos.ver')
  const [q, setQ] = useQParam()
  const [pid, setPid] = useParam('p')
  const [type, setType] = useParam('tipo')
  const [from, setFrom] = useParam('desde')
  const [to, setTo] = useParam('hasta')
  const prods = useMemo(() => [...d.products].sort((a, b) => a.name.localeCompare(b.name, 'es')), [d.products])
  const list = useMemo(() => {
    const t = norm(q.trim())
    return d.movements.filter((m) => {
      if (pid && m.productId !== pid) return false
      if (type && m.type !== type) return false
      if (from && m.date < from) return false
      if (to && m.date > to) return false
      if (t) {
        const p = d.prodMap.get(m.productId)
        if (![p?.name, p?.sku, m.reason, movementDoc(d, m).label, MOVE_LABEL[m.type], names.get(m.userId)].some((s) => norm(s).includes(t))) return false
      }
      return true
    }).sort((a, b) => b.at.localeCompare(a.at))
  }, [d, q, pid, type, from, to, names])
  const cols: Column<InventoryMovement>[] = [
    { key: 'date', label: 'Fecha', render: (m) => <span title={fmtDateTime(m.at)}>{fmtDate(m.date)}</span> },
    { key: 'prod', label: 'Producto', primary: true, render: (m) => { const p = d.prodMap.get(m.productId); return <span>{p ? <button className="stk-lnk" onClick={() => openProduct(p.id)}>{p.name}</button> : <span className="stk-name">Producto eliminado</span>}<br /><span className="stk-sub stk-mono">{p?.sku}</span></span> } },
    { key: 'type', label: 'Tipo', render: (m) => <Badge tone={MOVE_TONE(m)}>{MOVE_LABEL[m.type]}</Badge> },
    { key: 'qty', label: 'Cantidad', align: 'r', render: (m) => <span className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{signed(m.qty)} {d.prodMap.get(m.productId)?.unit}</span> },
    ...(canCost ? [{ key: 'cost', label: 'Costo total', align: 'r', render: (m: InventoryMovement) => <span className="num">{formatMXN(m.totalCostCents)}</span> }] as Column<InventoryMovement>[] : []),
    { key: 'doc', label: 'Documento', render: (m) => { const x = movementDoc(d, m); return x.to ? <Link to={x.to}>{x.label}</Link> : <span>{x.label}</span> } },
    { key: 'user', label: 'Usuario', hideMobile: true, render: (m) => names.get(m.userId) ?? '—' },
    { key: 'why', label: 'Motivo', hideMobile: true, render: (m) => <span className="small">{m.reason || '—'}</span> },
  ]
  const filtered = !!(q || pid || type || from || to)
  return (
    <div className="stack">
      <div className="banner info">El historial es inmutable: un error no se edita ni se borra, se corrige con un movimiento compensatorio (un ajuste de entrada o salida con su motivo).</div>
      <div className="stk-tools t5">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, motivo o documento" /></div></label>
        <label className="f">Producto<select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Todos</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
        <label className="f">Tipo<select value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos</option>{(Object.keys(MOVE_LABEL) as MovementType[]).map((t) => <option key={t} value={t}>{MOVE_LABEL[t]}</option>)}</select></label>
        <label className="f">Desde<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="f">Hasta<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="row wrap">
        {d.can('inventario.ajustar') && <><button className="btn" onClick={() => open({ k: 'adjust', productId: pid || undefined })}>Ajuste</button><button className="btn" onClick={() => open({ k: 'count' })}>Inventario físico</button></>}
        {filtered && <button className="btn ghost" onClick={() => { setQ(''); setPid(''); setType(''); setFrom(''); setTo('') }}>Quitar filtros</button>}
        <span className="small muted">{list.length} movimiento(s)</span>
      </div>
      <ActionList rows={list} columns={cols} rowKey={(m) => m.id}
        empty={d.movements.length === 0 ? <Empty title="Sin movimientos" text="Las compras, ventas, consumos y ajustes aparecerán aquí." /> : <Empty title="Sin movimientos con esos filtros" />} />
    </div>
  )
}
