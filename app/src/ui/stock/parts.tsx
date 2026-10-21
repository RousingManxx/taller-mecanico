import { useState, type ReactNode } from 'react'
import '../css/stock.css'
import { netPrice, taxRateOf } from '../../domain/alerts'
import { formatMXN, formatPct } from '../../domain/money'
import { marginPct, markupPct } from '../../domain/pricing'
import { decideProposal, proposePrice } from '../../services/catalog'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Badge, Empty, Field, NumInput, useBusy, useMedia, useUi, type Column } from '../ui'

/** Lista adaptable con acciones en cada fila: tabla en escritorio, tarjetas en móvil. Las acciones son botones propios (no anidados en la fila clicable). */
export function ActionList<T>({ rows, columns, rowKey, onRow, actions, empty, pageSize = 50 }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; actions?: (r: T) => ReactNode; empty?: ReactNode; pageSize?: number
}) {
  const wide = useMedia('(min-width: 700px)')
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const cur = Math.min(page, pages - 1)
  if (!rows.length) return <>{empty ?? <Empty title="Sin registros" />}</>
  const shown = rows.slice(cur * pageSize, (cur + 1) * pageSize)
  const pager = pages > 1 && <div className="row between small"><span className="muted">{cur * pageSize + 1}–{Math.min(rows.length, (cur + 1) * pageSize)} de {rows.length}</span><span className="row"><button className="btn small" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Anterior</button><button className="btn small" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Siguiente</button></span></div>
  if (wide) return (
    <div className="stack">
      <div className="tablewrap"><table className="table"><thead><tr>{columns.map((c) => <th key={c.key} className={c.align}>{c.label}</th>)}{actions && <th><span className="sr-only">Acciones</span></th>}</tr></thead>
        <tbody>{shown.map((r) => (
          <tr key={rowKey(r)} className={onRow ? 'click' : ''} onClick={() => onRow?.(r)} tabIndex={onRow ? 0 : undefined} onKeyDown={(e) => { if (onRow && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r) } }}>
            {columns.map((c) => <td key={c.key} className={c.align}>{c.render(r)}</td>)}
            {actions && <td className="stk-actcell" onClick={(e) => e.stopPropagation()}><div className="stk-acts">{actions(r)}</div></td>}
          </tr>))}</tbody></table></div>{pager}</div>
  )
  const prim = columns.find((c) => c.primary) ?? columns[0]
  return (
    <div className="stack"><div className="cards">{shown.map((r) => (
      <div key={rowKey(r)} className="stk-card">
        {(() => {
          const body = <><div className="row between"><b>{prim.render(r)}</b></div>{columns.filter((c) => c !== prim && !c.hideMobile).map((c) => <div key={c.key} className="kv"><span>{c.label}</span><span className="num">{c.render(r)}</span></div>)}</>
          return onRow ? <button className="stk-cardmain" onClick={() => onRow(r)}>{body}</button> : <div className="stk-cardmain" style={{ cursor: 'default' }}>{body}</div>
        })()}
        {actions && <div className="stk-acts">{actions(r)}</div>}
      </div>))}</div>{pager}</div>
  )
}

/** Margen y markup con la regla de dominio (n/c cuando no se puede calcular). */
export const Pct = ({ v }: { v: number | null }) => <span className={v === null ? 'muted' : v < 0 ? 'neg' : ''}>{formatPct(v === null ? null : Math.round(v * 10) / 10)}</span>

/**
 * Propuesta de precio para un margen objetivo. Nunca cambia el precio por sí sola: la propuesta queda pendiente hasta que
 * alguien con permiso de aprobación la acepte o la rechace.
 */
export function PriceProposalPanel({ data, kind, refId, taxId, onDone }: { data: Data; kind: 'producto' | 'servicio'; refId: string; taxId: string; onDone?: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [margin, setMargin] = useState<number | undefined>(data.settings.targetMarginPct)
  const pending = data.priceProposals.filter((p) => p.kind === kind && p.refId === refId && p.status === 'pendiente').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const rate = taxRateOf(data.settings, taxId)
  const canPropose = data.can('precios.editar'), canDecide = data.can('precios.aprobar')
  const bad = margin === undefined || !(margin >= 0 && margin < 100)
  const propose = () => guard(async () => {
    if (bad) { ui.toast('El margen objetivo debe estar entre 0 y 99.9 %.', true); return }
    await ui.run(() => proposePrice(ctx, kind, refId, margin), 'Propuesta creada. Revísala y apruébala para cambiar el precio.')
  })
  const decide = (id: string, name: string, from: number, to: number, ok: boolean) => guard(async () => {
    if (ok && !(await ui.confirm(`El precio de «${name}» cambiará de ${formatMXN(from)} a ${formatMXN(to)}.`, 'Aprobar y cambiar precio'))) return
    if (!ok && !(await ui.confirm(`Se descartará la propuesta de ${formatMXN(to)} para «${name}». El precio no cambia.`, 'Rechazar propuesta'))) return
    const r = await ui.run(() => decideProposal(ctx, id, ok).then(() => true), ok ? 'Propuesta aprobada: precio actualizado' : 'Propuesta rechazada')
    if (r) onDone?.()
  })
  return (
    <div className="stack">
      {pending.map((pr) => {
        const net = netPrice(pr.proposedPriceCents, rate, data.settings.pricesIncludeTax)
        const res = pr.costBasis > 0 ? marginPct(net, pr.costBasis) : null, mk = pr.costBasis > 0 ? markupPct(net, pr.costBasis) : null
        const diff = pr.proposedPriceCents - pr.currentPriceCents
        return (
          <div key={pr.id} className="card flat stack">
            <div className="row between wrap"><b>Propuesta pendiente</b><Badge tone="warn">Pendiente de aprobación</Badge></div>
            <div className="grid">
              <div><div className="small muted">Precio actual</div><b className="num">{formatMXN(pr.currentPriceCents)}</b></div>
              <div><div className="small muted">Precio propuesto</div><b className="num">{formatMXN(pr.proposedPriceCents)}</b> <span className={`small ${diff < 0 ? 'neg' : ''}`}>{diff === 0 ? '(sin cambio)' : `(${diff > 0 ? '+' : '−'}${formatMXN(Math.abs(diff))})`}</span></div>
              <div><div className="small muted">Costo base</div><b className="num">{formatMXN(Math.round(pr.costBasis))}</b></div>
              <div><div className="small muted">Margen / markup resultante</div><b className="num"><Pct v={res} /> / <Pct v={mk} /></b></div>
            </div>
            <div className="small muted">Calculada con margen objetivo de {pr.targetMarginPct} % sobre el precio neto. {data.settings.pricesIncludeTax ? 'El precio propuesto incluye IVA.' : 'El precio propuesto es antes de IVA.'}{diff < 0 ? ' Ojo: el precio propuesto es menor al actual.' : ''}</div>
            {canDecide
              ? <div className="row wrap"><button className="btn primary" disabled={busy} onClick={() => decide(pr.id, pr.name, pr.currentPriceCents, pr.proposedPriceCents, true)}>Aprobar</button><button className="btn" disabled={busy} onClick={() => decide(pr.id, pr.name, pr.currentPriceCents, pr.proposedPriceCents, false)}>Rechazar</button></div>
              : <div className="small muted">Un usuario con permiso para aprobar precios debe aceptarla o rechazarla.</div>}
          </div>
        )
      })}
      {canPropose && (
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ width: 150 }}><Field label="Margen objetivo (%)" error={bad ? 'Entre 0 y 99.9' : undefined}><NumInput value={margin} onChange={setMargin} invalid={bad} /></Field></div>
          <button className="btn" disabled={busy || bad} onClick={propose}>Proponer precio para margen objetivo</button>
        </div>
      )}
      {!canPropose && !pending.length && <div className="small muted">No tienes permiso para proponer precios.</div>}
      <div className="small muted">La propuesta no cambia el precio por sí sola: queda pendiente hasta que se apruebe.</div>
    </div>
  )
}

export const Dl = ({ children }: { children: ReactNode }) => <dl className="stk-dl">{children}</dl>
export const Di = ({ k, children, wide }: { k: string; children: ReactNode; wide?: boolean }) => <div className={wide ? 'wide' : undefined}><dt>{k}</dt><dd>{children}</dd></div>
export const Sec = ({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) => <section className="stk-sec"><div className="row between wrap"><h3>{title}</h3>{right}</div>{children}</section>
