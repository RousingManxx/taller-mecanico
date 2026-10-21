import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { costIncreased } from '../../domain/alerts'
import { diffDays } from '../../domain/dates'
import { formatMXN, formatNum, formatPct, formatQty } from '../../domain/money'
import { proposePrice } from '../../services/catalog'
import { useOpen } from '../create'
import { fmtDate, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Empty, useBusy, useUi } from '../ui'
import { MOVE_LABEL, signed, suggestQty, useProductRows, type PRow } from './helpers'

interface Item { id: string; row: PRow; detail: ReactNode; acts: ('comprar' | 'ajustar' | 'proponer' | 'movs')[]; key?: string }
interface Group { key: string; tone: 'bad' | 'warn' | 'info'; title: string; def: string; items: Item[] }

export function AlertsTab({ data: d, openProduct }: { data: Data; openProduct: (id: string) => void }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const [all, setAll] = useState<Set<string>>(new Set())
  const rows = useProductRows(d)
  const canCost = d.can('costos.ver')
  const groups = useMemo<Group[]>(() => {
    const act = rows.filter((r) => r.p.active)
    const g: Group[] = []
    const inconsistent = rows.filter((r) => r.qty < -1e-9 || (r.qty <= 1e-9 && Math.abs(r.value) > 0) || (r.qty > 0 && r.value < 0))
    const incIds = new Set(inconsistent.map((r) => r.p.id))
    g.push({ key: 'incons', tone: 'bad', title: 'Existencias inconsistentes', def: 'Existencias negativas, o valor de inventario sin existencias (o negativo). Corrígelo con un ajuste o un inventario físico.',
      items: inconsistent.map((r) => ({ id: r.p.id, row: r, detail: `${formatQty(r.qty)} ${r.p.unit}${canCost ? ` · valor ${formatMXN(r.value)}` : ''}`, acts: ['ajustar'] })) })
    g.push({ key: 'agotado', tone: 'bad', title: 'Agotados', def: 'Productos activos sin existencias.',
      items: act.filter((r) => r.state === 'agotado' && !incIds.has(r.p.id)).map((r) => ({ id: r.p.id, row: r, detail: `Mínimo ${formatQty(r.p.minStock)} ${r.p.unit}`, acts: ['comprar', 'ajustar'] })) })
    g.push({ key: 'bajo', tone: 'warn', title: 'Stock bajo', def: 'Existencias iguales o menores al mínimo configurado.',
      items: act.filter((r) => r.state === 'bajo').map((r) => ({ id: r.p.id, row: r, detail: `${formatQty(r.qty)} ${r.p.unit} (mínimo ${formatQty(r.p.minStock)})`, acts: ['comprar', 'ajustar'] })) })
    if (canCost) {
      g.push({ key: 'bajocosto', tone: 'bad', title: 'Precio por debajo del costo', def: 'El precio neto es menor que el costo vigente: cada venta pierde dinero.',
        items: act.filter((r) => r.alert.kind === 'bajo_costo').map((r) => ({ id: r.p.id, row: r, detail: `Precio neto ${formatMXN(r.net)} · costo ${formatMXN(Math.round(r.cost))} · margen ${formatPct(r.margin === null ? null : Math.round(r.margin * 10) / 10)}`, acts: ['proponer'] })) })
      g.push({ key: 'margen', tone: 'warn', title: 'Margen reducido', def: 'El margen está por debajo del mínimo configurado (propio del producto o global).',
        items: act.filter((r) => r.alert.kind === 'margen_bajo').map((r) => ({ id: r.p.id, row: r, detail: `Margen ${formatPct(Math.round((r.margin ?? 0) * 10) / 10)} (mínimo ${formatPct(r.alert.minMarginPct)}) · costo ${formatMXN(Math.round(r.cost))}`, acts: ['proponer'] })) })
      g.push({ key: 'costo', tone: 'warn', title: 'Costo aumentado', def: `El último costo de compra subió más de 5 % respecto al anterior y el margen quedó debajo del objetivo (${d.settings.targetMarginPct} %).`,
        items: act.filter((r) => costIncreased(r.p.prevPurchaseCost, r.p.lastPurchaseCost ?? 0) && (r.alert.marginPct ?? 100) < d.settings.targetMarginPct).map((r) => {
          const prev = r.p.prevPurchaseCost ?? 0, last = r.p.lastPurchaseCost ?? 0
          return { id: r.p.id, row: r, detail: `${formatMXN(Math.round(prev))} → ${formatMXN(Math.round(last))} (+${formatNum(((last - prev) / prev) * 100)} %) · margen ${formatPct(r.alert.marginPct === null ? null : Math.round(r.alert.marginPct * 10) / 10)}`, acts: ['proponer' as const] }
        }) })
    }
    const stale = act.filter((r) => r.qty > 0 && r.lastMove && diffDays(r.lastMove, d.today) > 90)
    const staleIds = new Set(stale.map((r) => r.p.id))
    g.push({ key: 'sinmov', tone: 'info', title: 'Sin movimiento en más de 90 días', def: 'Hay existencias, pero no se han movido en tres meses. Revisa si siguen siendo útiles.',
      items: stale.sort((a, b) => (a.lastMove ?? '').localeCompare(b.lastMove ?? '')).map((r) => ({ id: r.p.id, row: r, detail: `Último movimiento ${fmtDate(r.lastMove)} (hace ${diffDays(r.lastMove as string, d.today)} días) · ${formatQty(r.qty)} ${r.p.unit}${canCost ? ` · ${formatMXN(r.value)} inmovilizados` : ''}`, acts: ['ajustar', 'movs'] })) })
    if (canCost) {
      const withStock = act.filter((r) => r.qty > 0), avg = withStock.length ? withStock.reduce((a, r) => a + r.value, 0) / withStock.length : 0
      g.push({ key: 'rot', tone: 'info', title: 'Baja rotación con valor alto', def: 'En 60 días salió menos del 10 % de las existencias y el valor inmovilizado supera el promedio por producto.',
        items: withStock.filter((r) => !staleIds.has(r.p.id) && r.out60 / r.qty < 0.1 && r.value >= avg && r.value > 0).sort((a, b) => b.value - a.value).map((r) => ({ id: r.p.id, row: r, detail: `Salidas 60 días: ${formatQty(r.out60)} de ${formatQty(r.qty)} ${r.p.unit} · ${formatMXN(r.value)} en inventario`, acts: ['movs'] })) })
    }
    const recent = d.movements.filter((m) => m.type === 'inventario_fisico' && diffDays(m.date, d.today) <= 30).sort((a, b) => b.at.localeCompare(a.at))
    g.push({ key: 'conteo', tone: 'warn', title: 'Diferencias de inventario físico (últimos 30 días)', def: 'Ajustes generados por conteos físicos recientes: la existencia real era distinta a la del sistema.',
      items: recent.flatMap((m) => { const r = rows.find((x) => x.p.id === m.productId); return r ? [{ id: m.id, key: m.id, row: r, detail: `${fmtDate(m.date)} · ${MOVE_LABEL[m.type]} ${signed(m.qty)} ${r.p.unit}${canCost ? ` · ${formatMXN(m.totalCostCents)}` : ''}`, acts: ['movs' as const] }] : [] }) })
    return g.filter((x) => x.items.length)
  }, [rows, d, canCost])

  const buy = (r: PRow) => {
    const lead = (r.p.supplierId && d.supMap.get(r.p.supplierId)?.leadDays) || 0
    const q = suggestQty(r.p.minStock, r.qty, r.out60 / 60, lead) || Math.max(1, Math.ceil(r.p.minStock))
    open({ k: 'purchase', supplierId: r.p.supplierId, items: [{ productId: r.p.id, qty: q }] })
  }
  const propose = (r: PRow) => guard(async () => {
    if (!d.priceProposals.some((x) => x.kind === 'producto' && x.refId === r.p.id && x.status === 'pendiente')) {
      const pr = await ui.run(() => proposePrice(ctx, 'producto', r.p.id), 'Propuesta creada: revísala antes de aprobarla')
      if (!pr) return
    }
    openProduct(r.p.id)
  })
  if (!groups.length) return <Empty title="Sin alertas de inventario" text="Las existencias, los márgenes y las rotaciones están dentro de lo esperado." />
  const total = groups.reduce((a, g) => a + g.items.length, 0)
  return (
    <div className="stack-lg">
      <div className="small muted">{total} alerta(s) en {groups.length} categoría(s). Cada alerta tiene una acción: ninguna cambia precios ni existencias por sí sola.</div>
      {groups.map((g) => {
        const showAll = all.has(g.key), items = showAll ? g.items : g.items.slice(0, 8)
        return (
          <section key={g.key} className="stk-agrp" aria-label={g.title}>
            <header><Badge tone={g.tone}>{g.items.length}</Badge><h3>{g.title}</h3></header>
            <p className="def">{g.def}</p>
            {items.map((it) => (
              <div key={it.key ?? `${g.key}-${it.id}`} className="stk-arow">
                <div className="info"><button className="lnk" onClick={() => openProduct(it.row.p.id)}>{it.row.p.name}</button> <span className="stk-sub stk-mono">{it.row.p.sku}</span><div className="small muted">{it.detail}</div></div>
                <div className="stk-acts">
                  {it.acts.includes('comprar') && d.can('compras.editar') && <button className="btn small" onClick={() => buy(it.row)}>Comprar</button>}
                  {it.acts.includes('ajustar') && d.can('inventario.ajustar') && <button className="btn small" onClick={() => open({ k: 'adjust', productId: it.row.p.id })}>Ajustar</button>}
                  {it.acts.includes('proponer') && d.can('precios.editar') && <button className="btn small" disabled={busy} onClick={() => propose(it.row)}>Proponer precio</button>}
                  {it.acts.includes('movs') && <Link className="btn small" to={`/inventario?f=movimientos&p=${it.row.p.id}`}>Ver movimientos</Link>}
                </div>
              </div>
            ))}
            {g.items.length > 8 && <button className="btn small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setAll((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n })}>{showAll ? 'Mostrar menos' : `Mostrar las ${g.items.length}`}</button>}
          </section>
        )
      })}
    </div>
  )
}
