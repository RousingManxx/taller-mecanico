import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { priceAlert, productAlertFor, taxRateOf } from '../domain/alerts'
import { addDays, inRange } from '../domain/dates'
import { allocateOverhead, breakEvenFromStatement, incomeStatement, lossSales, OVERHEAD_HELP, OVERHEAD_LABEL, overheadPool, series } from '../domain/finance'
import { hourlyLaborCost } from '../domain/labor'
import { formatMXN, formatNum, formatPct } from '../domain/money'
import { estimatedLabor, orderEconomics, OPEN_STATUSES, STATUS_LABEL, timeSummary } from '../domain/orders'
import { breakEven, marginPct, markupPct, priceCalculator } from '../domain/pricing'
import type { OverheadMethod, Sale, SaleItem } from '../domain/types'
import { decideProposal, proposePrice, saveSettings } from '../services/catalog'
import { unitCostOf } from '../ui/alerts'
import { Donut, Legend, MarginChart, toSlices, TrendChart } from '../ui/charts'
import { fmtDate, type Data } from '../ui/data'
import { PeriodPicker, usePeriod } from '../ui/period'
import { useCtx } from '../ui/session'
import { Badge, DataTable, deltaText, Empty, Field, MoneyInput, NumInput, Seg, Stat, useBusy, useUi } from '../ui/ui'

type Tab = 'resumen' | 'ordenes' | 'refacciones' | 'servicios' | 'mano' | 'indirectos' | 'precios' | 'equilibrio'
const TABS: [Tab, string][] = [['resumen', 'Resumen'], ['ordenes', 'Por orden'], ['refacciones', 'Refacciones'], ['servicios', 'Servicios'], ['mano', 'Mano de obra'], ['indirectos', 'Indirectos'], ['precios', 'Precios'], ['equilibrio', 'Equilibrio']]

interface Filters { customerId: string; mechanicId: string; category: string; serviceId: string }
const NOF: Filters = { customerId: '', mechanicId: '', category: '', serviceId: '' }

/** Partidas de ventas emitidas del periodo que cumplen los filtros (para el análisis por orden/producto/servicio). */
function useItems(d: Data, range: { from: string; to: string }, f: Filters) {
  return useMemo(() => {
    const out: { sale: Sale; item: SaleItem; net: number; cost: number; qty: number }[] = []
    for (const s of d.sales) {
      if (s.status !== 'emitida' || !inRange(s.date, range)) continue
      if (f.customerId && s.customerId !== f.customerId) continue
      for (const i of s.items) {
        if (f.mechanicId && (i.type !== 'servicio' || i.mechanicId !== f.mechanicId)) continue
        if (f.serviceId && !(i.type === 'servicio' && i.refId === f.serviceId)) continue
        if (f.category) {
          const cat = i.type === 'servicio' ? d.svcMap.get(i.refId ?? '')?.category : d.prodMap.get(i.refId ?? '')?.category
          if (cat !== f.category) continue
        }
        const ret = s.returns.filter((r) => r.itemId === i.id)
        out.push({ sale: s, item: i, net: i.netCents - ret.reduce((a, r) => a + r.netCents, 0), cost: i.costCents - ret.reduce((a, r) => a + r.costRecoveredCents, 0), qty: i.qty - ret.reduce((a, r) => a + r.qty, 0) })
      }
    }
    return out
  }, [d, range, f])
}

function FilterBar({ d, f, setF }: { d: Data; f: Filters; setF: (f: Filters) => void }) {
  const cats = [...new Set([...d.products.map((p) => p.category), ...d.services.map((s) => s.category)])].sort()
  const active = Object.values(f).some(Boolean)
  return (
    <div className="stack-sm">
      <div className="grid">
        <label className="f">Cliente<select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Todos</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="f">Mecánico<select value={f.mechanicId} onChange={(e) => setF({ ...f, mechanicId: e.target.value })}><option value="">Todos</option>{d.employees.filter((e) => e.isMechanic).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="f">Categoría<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Todas</option>{cats.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Servicio<select value={f.serviceId} onChange={(e) => setF({ ...f, serviceId: e.target.value })}><option value="">Todos</option>{d.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      {active && <div className="row"><Badge tone="info">Filtros activos</Badge><button className="btn small ghost" onClick={() => setF(NOF)}>Quitar filtros</button></div>}
    </div>
  )
}

const mpct = (net: number, cost: number) => formatPct(marginPct(net, cost))
const tone = (n: number) => (n < 0 ? 'neg' : '')

/* ───────────────────────── Resumen ───────────────────────── */
function Resumen({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const cats = d.settings.expenseCategories
  const st = useMemo(() => incomeStatement(d.sales, d.expenses, cats, ps.range), [d.sales, d.expenses, cats, ps.range])
  const pv = useMemo(() => incomeStatement(d.sales, d.expenses, cats, ps.prev), [d.sales, d.expenses, cats, ps.prev])
  const pts = useMemo(() => series(d.sales, d.ledger, d.expenses, cats, ps.range), [d.sales, d.ledger, d.expenses, cats, ps.range])
  const losses = lossSales(d.sales, ps.range)
  const lines: { l: string; v: number; p: number; bold?: boolean; goodUp?: boolean; indent?: boolean }[] = [
    { l: 'Ventas netas (antes de IVA)', v: st.netSalesCents, p: pv.netSalesCents, bold: true },
    { l: 'Refacciones', v: -st.cogs.partsCents, p: -pv.cogs.partsCents, indent: true }, { l: 'Consumibles y otros', v: -(st.cogs.consumablesCents + st.cogs.otherCents), p: -(pv.cogs.consumablesCents + pv.cogs.otherCents), indent: true },
    { l: 'Servicios externos', v: -st.cogs.externalCents, p: -pv.cogs.externalCents, indent: true }, { l: 'Mano de obra imputada', v: -st.cogs.laborCents, p: -pv.cogs.laborCents, indent: true },
    { l: 'Utilidad bruta', v: st.grossProfitCents, p: pv.grossProfitCents, bold: true },
    ...st.opex.byCategory.map((x) => ({ l: x.name, v: -x.cents, p: -(pv.opex.byCategory.find((y) => y.categoryId === x.categoryId)?.cents ?? 0), indent: true })),
    ...(st.idleLaborCents || pv.idleLaborCents ? [{ l: 'Capacidad ociosa de mano de obra (nómina − imputado)', v: -st.idleLaborCents, p: -pv.idleLaborCents, indent: true }] : []),
    { l: 'Utilidad operativa estimada', v: st.operatingProfitCents, p: pv.operatingProfitCents, bold: true },
  ]
  return (
    <div className="stack-lg">
      <div className="grid">
        <Stat label="Ventas netas" value={formatMXN(st.netSalesCents)} delta={deltaText(st.netSalesCents, pv.netSalesCents)} hint={`${st.salesCount} venta(s)`} />
        <Stat label="Utilidad bruta" value={st.netSalesCents ? formatMXN(st.grossProfitCents) : '—'} tone={st.grossProfitCents < 0 ? 'bad' : undefined} delta={deltaText(st.grossProfitCents, pv.grossProfitCents)} hint={`Margen bruto ${formatPct(st.grossMarginPct)}`} />
        <Stat label="Utilidad operativa estimada" value={formatMXN(st.operatingProfitCents)} tone={st.operatingProfitCents < 0 ? 'bad' : st.operatingProfitCents > 0 ? 'ok' : undefined} delta={deltaText(st.operatingProfitCents, pv.operatingProfitCents)} hint={`Margen operativo ${formatPct(st.operatingMarginPct)}`} />
      </div>
      {st.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
      <div className="fcard">
        <h3>Estado de resultados gerencial</h3>
        <p className="small muted">Periodo {fmtDate(ps.range.from)} – {fmtDate(ps.range.to)} comparado con {fmtDate(ps.prev.from)} – {fmtDate(ps.prev.to)}. Reconocimiento por devengado: ventas en su fecha de emisión, gastos en su fecha. Es una vista gerencial, no sustituye contabilidad ni declaración fiscal.</p>
        <div className="tablewrap"><table className="table"><thead><tr><th>Concepto</th><th className="r">Periodo</th><th className="r">Anterior</th><th className="r">Variación</th></tr></thead>
          <tbody>{lines.map((x) => <tr key={x.l} style={x.bold ? { fontWeight: 700, background: 'var(--surface-3)' } : undefined}><td style={{ paddingLeft: x.indent ? 28 : undefined }}>{x.l}</td><td className={`r num ${tone(x.v)}`}>{formatMXN(x.v)}</td><td className="r num muted">{formatMXN(x.p)}</td><td className="r num small muted">{x.p === 0 ? 'sin base' : (((x.v - x.p) / Math.abs(x.p)) * 100 >= 0 ? '+' : '−') + Math.abs(((x.v - x.p) / Math.abs(x.p)) * 100).toFixed(1) + ' %'}</td></tr>)}</tbody></table></div>
        <p className="small muted"><b>Cómo se calcula:</b> la mano de obra de cada orden se imputa con las horas reales × costo por hora productiva. La nómina de mecánicos que registres como gasto <b>no se resta otra vez</b>: solo se resta la parte no absorbida por horas facturadas (capacidad ociosa). Las compras de inventario no son gasto: entran como activo y se reconocen como costo al consumirse.</p>
      </div>
      <div className="cols2">
        <div className="fcard"><h3>Ventas, costos y utilidad</h3><Legend items={[{ label: 'Ventas netas', color: 'var(--ch-sales)' }, { label: 'Costos directos', color: 'var(--ch-cost)', kind: 'hatch' }, { label: 'Utilidad bruta', color: 'var(--ch-profit)', kind: 'line' }]} /><TrendChart points={pts} showCollected empty={<Empty title="Sin ventas en este periodo" />} /></div>
        <div className="fcard"><h3>Margen bruto</h3><MarginChart points={pts} empty={<Empty title="Sin ventas en este periodo" />} /></div>
        <div className="fcard"><h3>Distribución de costos directos</h3>{st.cogs.totalCents > 0 ? <Donut centerLabel="costos" title="Costos directos" slices={toSlices([{ key: 'p', label: 'Refacciones', cents: st.cogs.partsCents }, { key: 'l', label: 'Mano de obra', cents: st.cogs.laborCents }, { key: 'c', label: 'Consumibles y otros', cents: st.cogs.consumablesCents + st.cogs.otherCents }, { key: 'e', label: 'Servicios externos', cents: st.cogs.externalCents }])} /> : <Empty title="Sin costos en el periodo" />}</div>
        <div className="fcard"><h3>Trabajos vendidos por debajo de su costo</h3>{losses.length ? <div className="stack-sm">{losses.slice(0, 8).map((s) => <Link key={s.id} className="item" to={`/ventas/${s.id}`}><div className="grow"><div className="ttl">{s.folio} · {s.customerName}</div><div className="sub">{fmtDate(s.date)}</div></div><b className="neg num">{formatMXN(s.netCents - s.costCents)}</b></Link>)}</div> : <Empty title="Ninguna venta con pérdida" text="En este periodo ninguna venta costó más de lo que se vendió." />}</div>
      </div>
    </div>
  )
}

/* ───────────────────────── Por orden ───────────────────────── */
function PorOrden({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const [f, setF] = useState(NOF)
  const items = useItems(d, ps.range, f)
  const bySale = useMemo(() => {
    const m = new Map<string, { sale: Sale; net: number; cost: number; parts: number; labor: number; ext: number; est: boolean }>()
    for (const x of items) {
      const r = m.get(x.sale.id) ?? { sale: x.sale, net: 0, cost: 0, parts: 0, labor: 0, ext: 0, est: false }
      r.net += x.net; r.cost += x.cost; r.est ||= x.item.costEstimated
      if (x.item.type === 'servicio') r.labor += x.cost; else if (x.item.type === 'externo') r.ext += x.cost; else r.parts += x.cost
      m.set(x.sale.id, r)
    }
    return [...m.values()].sort((a, b) => b.sale.date.localeCompare(a.sale.date))
  }, [items])
  const pool = overheadPool(d.expenses, d.settings.expenseCategories, ps.range)
  const alloc = useMemo(() => allocateOverhead(pool, d.settings.overheadMethod, d.sales.filter((s) => inRange(s.date, ps.range))), [pool, d.settings.overheadMethod, d.sales, ps.range])
  const [nowIso] = useState(() => new Date().toISOString())
  const open = useMemo(() => d.orders.filter((o) => OPEN_STATUSES.includes(o.status) && o.items.some((i) => i.status === 'autorizado' || i.status === 'ejecutado')).map((o) => {
    const t = timeSummary(o, nowIso)
    return { o, e: orderEconomics(o, d.settings, t.laborCostCents, estimatedLabor(o, d.employees, d.settings)) }
  }), [d.orders, d.settings, d.employees, nowIso])
  const tot = bySale.reduce((a, r) => ({ net: a.net + r.net, cost: a.cost + r.cost }), { net: 0, cost: 0 })
  return (
    <div className="stack-lg">
      <FilterBar d={d} f={f} setF={setF} />
      <section className="stack"><h3>Órdenes y ventas del periodo</h3>
        <DataTable rows={bySale} rowKey={(r) => r.sale.id} onRow={(r) => { location.hash = `/ventas/${r.sale.id}` }}
          columns={[
            { key: 'f', label: 'Venta', primary: true, render: (r) => <>{r.sale.folio}{r.est && <span title="Incluye costo estimado"> *</span>}</> },
            { key: 'c', label: 'Cliente', render: (r) => r.sale.customerName }, { key: 'd', label: 'Fecha', render: (r) => fmtDate(r.sale.date), hideMobile: true },
            { key: 'n', label: 'Venta neta', align: 'r', render: (r) => formatMXN(r.net) }, { key: 'p', label: 'Refacciones', align: 'r', hideMobile: true, render: (r) => formatMXN(r.parts) },
            { key: 'l', label: 'Mano de obra', align: 'r', hideMobile: true, render: (r) => formatMXN(r.labor) }, { key: 'k', label: 'Costo directo', align: 'r', render: (r) => formatMXN(r.cost) },
            { key: 'u', label: 'Utilidad', align: 'r', render: (r) => <span className={tone(r.net - r.cost)}>{formatMXN(r.net - r.cost)}</span> }, { key: 'm', label: 'Margen', align: 'r', render: (r) => mpct(r.net, r.cost) },
            ...(d.settings.overheadMethod !== 'ninguno' ? [{ key: 'i', label: 'Tras indirectos', align: 'r' as const, hideMobile: true, render: (r: { sale: Sale; net: number; cost: number }) => <span className={tone(r.net - r.cost - (alloc.get(r.sale.id) ?? 0))}>{formatMXN(r.net - r.cost - (alloc.get(r.sale.id) ?? 0))}</span> }] : []),
          ]}
          footer={<tr><td>Total</td><td /><td /><td className="r num">{formatMXN(tot.net)}</td><td /><td /><td className="r num">{formatMXN(tot.cost)}</td><td className="r num">{formatMXN(tot.net - tot.cost)}</td><td className="r">{mpct(tot.net, tot.cost)}</td></tr>}
          empty={<Empty title="Sin ventas en el periodo" text="Cuando entregues órdenes o vendas refacciones verás aquí su rentabilidad real." />} />
        <p className="small muted">* contiene partidas con costo <b>estimado</b> (sin tiempos reales), no observado. {d.settings.overheadMethod !== 'ninguno' && <>Los indirectos se asignan con el método «{OVERHEAD_LABEL[d.settings.overheadMethod]}» (asignación analítica; el fondo se resta una sola vez en el resultado global).</>}</p>
      </section>
      <section className="stack"><h3>Órdenes en proceso (resultado provisional)</h3>
        {!open.length ? <Empty title="No hay órdenes abiertas con trabajos autorizados" /> : (
          <div className="stack-sm">{open.map(({ o, e }) => (
            <Link key={o.id} className="item" to={`/ordenes/${o.id}`} style={{ alignItems: 'flex-start' }}>
              <div className="grow"><div className="ttl">{o.folio} · {d.custMap.get(o.customerId)?.name} <Badge tone="warn">Provisional</Badge></div>
                <div className="sub">{STATUS_LABEL[o.status]} · venta {formatMXN(e.netCents)} · costo {formatMXN(e.directCostCents)} (ref. {formatMXN(e.partsCostCents)} · m. de obra {formatMXN(e.laborCostCents)} · ext. {formatMXN(e.externalCostCents)})</div>
                {e.missing.map((m) => <div key={m} className="small muted">• {m}</div>)}</div>
              <div className="right"><b className={`num ${tone(e.profitCents)}`}>{formatMXN(e.profitCents)}</b><div className="small muted">{formatPct(e.marginPct)}</div></div>
            </Link>))}</div>)}
      </section>
    </div>
  )
}

/* ───────────────────────── Por refacción ───────────────────────── */
function Refacciones({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const ctx = useCtx(), ui = useUi()
  const [f, setF] = useState(NOF)
  const items = useItems(d, ps.range, f)
  const rows = useMemo(() => {
    const m = new Map<string, { id: string; qty: number; net: number; cost: number; disc: number; ret: number }>()
    for (const x of items) {
      if (x.item.type === 'servicio' || !x.item.refId) continue
      const r = m.get(x.item.refId) ?? { id: x.item.refId, qty: 0, net: 0, cost: 0, disc: 0, ret: 0 }
      r.qty += x.qty; r.net += x.net; r.cost += x.cost; r.disc += x.item.discountCents; r.ret += x.sale.returns.filter((q) => q.itemId === x.item.id).reduce((a, q) => a + q.netCents, 0)
      m.set(x.item.refId, r)
    }
    return [...m.values()].map((r) => {
      const p = d.prodMap.get(r.id)
      const cost = unitCostOf(d, r.id), alert = p ? productAlertFor(p, cost, d.settings) : null
      return { ...r, name: p?.name ?? '—', p, cost1: cost, alert, util: r.net - r.cost, rot: d.stock.get(r.id)?.valueCents ?? 0 }
    }).sort((a, b) => b.util - a.util)
  }, [items, d])
  const [busy, guard] = useBusy()
  const propose = (id: string) => guard(async () => {
    const pr = await ui.run(() => proposePrice(ctx, 'producto', id), 'Propuesta creada: revísala en la pestaña Precios')
    return pr
  })
  return (
    <div className="stack-lg">
      <FilterBar d={d} f={f} setF={setF} />
      <DataTable rows={rows} rowKey={(r) => r.id}
        columns={[
          { key: 'n', label: 'Refacción', primary: true, render: (r) => r.name }, { key: 'q', label: 'Vendidas', align: 'r', render: (r) => formatNum(r.qty) },
          { key: 'v', label: 'Venta neta', align: 'r', render: (r) => formatMXN(r.net) }, { key: 'k', label: 'Costo', align: 'r', render: (r) => formatMXN(r.cost) },
          { key: 'u', label: 'Utilidad', align: 'r', render: (r) => <span className={tone(r.util)}>{formatMXN(r.util)}</span> }, { key: 'm', label: 'Margen', align: 'r', render: (r) => mpct(r.net, r.cost) },
          { key: 'mk', label: 'Markup', align: 'r', hideMobile: true, render: (r) => formatPct(markupPct(r.net, r.cost)) }, { key: 'd', label: 'Descuentos', align: 'r', hideMobile: true, render: (r) => formatMXN(r.disc) },
          { key: 'r', label: 'Devol.', align: 'r', hideMobile: true, render: (r) => formatMXN(r.ret) }, { key: 'cv', label: 'Costo vigente', align: 'r', hideMobile: true, render: (r) => (r.cost1 ? formatMXN(Math.round(r.cost1)) : 'n/c') },
          { key: 'a', label: 'Precio actual', render: (r) => r.alert ? (r.alert.kind === 'bajo_costo' ? <Badge tone="bad">Bajo costo</Badge> : r.alert.kind === 'margen_bajo' ? <Badge tone="warn">Margen {formatPct(r.alert.marginPct)} &lt; {r.alert.minMarginPct} %</Badge> : r.alert.kind === 'sin_costo' ? <Badge>Sin costo</Badge> : <Badge tone="ok">{formatPct(r.alert.marginPct)}</Badge>) : '—' },
          { key: 'x', label: '', hideMobile: true, render: (r) => r.alert && (r.alert.kind === 'bajo_costo' || r.alert.kind === 'margen_bajo') && d.can('precios.editar') ? <button className="btn small" disabled={busy} onClick={(e) => { e.stopPropagation(); propose(r.id) }}>Proponer precio</button> : null },
        ]}
        empty={<Empty title="Sin refacciones vendidas en el periodo" />} />
      <p className="small muted">Margen = utilidad ÷ venta neta · Markup = utilidad ÷ costo. «Precio actual» compara el precio vigente de catálogo con el costo promedio vigente. Las propuestas nunca cambian el precio sin aprobación.</p>
    </div>
  )
}

/* ───────────────────────── Por servicio ───────────────────────── */
function Servicios({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const [f, setF] = useState(NOF)
  const items = useItems(d, ps.range, f)
  const rows = useMemo(() => {
    const m = new Map<string, { key: string; name: string; cat: string; qty: number; net: number; cost: number; std: number; real: number; est: boolean; n: number }>()
    for (const x of items) {
      if (x.item.type !== 'servicio') continue
      const key = x.item.refId ?? x.item.description
      const r = m.get(key) ?? { key, name: x.item.description, cat: d.svcMap.get(x.item.refId ?? '')?.category ?? 'Otros', qty: 0, net: 0, cost: 0, std: 0, real: 0, est: false, n: 0 }
      r.qty += x.qty; r.net += x.net; r.cost += x.cost; r.std += x.item.stdHours * x.item.qty; r.real += x.item.hours; r.est ||= x.item.costEstimated; r.n++
      m.set(key, r)
    }
    return [...m.values()].sort((a, b) => b.net - a.net)
  }, [items, d.svcMap])
  return (
    <div className="stack-lg">
      <FilterBar d={d} f={f} setF={setF} />
      <DataTable rows={rows} rowKey={(r) => r.key}
        columns={[
          { key: 'n', label: 'Servicio', primary: true, render: (r) => <>{r.name}{r.est && <span title="Incluye costo estimado"> *</span>}</> }, { key: 'c', label: 'Categoría', hideMobile: true, render: (r) => r.cat },
          { key: 'q', label: 'Veces', align: 'r', render: (r) => r.qty }, { key: 'v', label: 'Venta neta', align: 'r', render: (r) => formatMXN(r.net) }, { key: 'k', label: 'Costo de mano de obra', align: 'r', render: (r) => formatMXN(r.cost) },
          { key: 'u', label: 'Utilidad', align: 'r', render: (r) => <span className={tone(r.net - r.cost)}>{formatMXN(r.net - r.cost)}</span> }, { key: 'm', label: 'Margen', align: 'r', render: (r) => mpct(r.net, r.cost) },
          { key: 'e', label: 'Horas estándar', align: 'r', hideMobile: true, render: (r) => formatNum(r.std) }, { key: 'rr', label: 'Horas reales', align: 'r', hideMobile: true, render: (r) => formatNum(r.real) },
          { key: 'df', label: 'Dif. real − estándar', align: 'r', hideMobile: true, render: (r) => <span className={r.real - r.std > 0.01 ? 'neg' : 'pos'}>{(r.real - r.std >= 0 ? '+' : '−') + formatNum(Math.abs(r.real - r.std))} h</span> },
        ]}
        empty={<Empty title="Sin servicios vendidos en el periodo" />} />
      <p className="small muted">* costo estimado con el tiempo estándar (no hubo tiempos reales). Compara servicios de una misma categoría para detectar los que dejan menos margen.</p>
    </div>
  )
}

/* ───────────────────────── Mano de obra ───────────────────────── */
function ManoObra({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const canSal = d.can('personal.salarios')
  const rows = useMemo(() => d.employees.filter((e) => e.isMechanic && e.active).map((e) => {
    let worked = 0, billed = 0
    for (const o of d.orders) {
      for (const t of o.timeEntries) if (t.kind === 'trabajo' && t.endAt && t.employeeId === e.id && inRange(t.endAt.slice(0, 10), ps.range)) worked += t.minutes / 60
    }
    for (const s of d.sales) if (s.status === 'emitida' && inRange(s.date, ps.range)) for (const i of s.items) if (i.type === 'servicio' && i.mechanicId === e.id) billed += i.stdHours * i.qty
    return { e, hourly: hourlyLaborCost(e, d.settings), worked, billed }
  }), [d, ps.range])
  return (
    <div className="stack-lg">
      <div className="card flat stack-sm"><b>Metodología</b>
        <p className="small">Costo laboral por hora productiva = costo mensual × (1 + carga %) ÷ horas productivas del mes. Ahora: <b>{d.settings.labor.loadPct} %</b> de cargas y <b>{d.settings.labor.productiveHoursPerMonth} h</b> productivas al mes (configurable en Ajustes y por empleado). Horas pagadas ≠ horas productivas ≠ horas facturables.</p></div>
      {!canSal && <div className="banner info">El costo laboral es información salarial: tu rol solo ve horas, no importes.</div>}
      <DataTable rows={rows} rowKey={(r) => r.e.id}
        columns={[
          { key: 'n', label: 'Mecánico', primary: true, render: (r) => r.e.name }, { key: 'h', label: 'Costo por hora', align: 'r', render: (r) => (canSal ? (r.e.monthlyCostCents > 0 ? formatMXN(r.hourly) : 'sin captura') : '—') },
          { key: 'c', label: 'Tarifa comercial / h', align: 'r', hideMobile: true, render: (r) => formatMXN(r.e.commercialRateCents) }, { key: 'w', label: 'Horas trabajadas', align: 'r', render: (r) => formatNum(r.worked) },
          { key: 'b', label: 'Horas facturadas (estándar)', align: 'r', render: (r) => formatNum(r.billed) }, { key: 'e', label: 'Eficiencia', align: 'r', render: (r) => (r.worked > 0 ? formatNum((r.billed / r.worked) * 100) + ' %' : 'n/c') },
          { key: 'cc', label: 'Costo laboral de las horas', align: 'r', hideMobile: true, render: (r) => (canSal ? formatMXN(Math.round(r.worked * r.hourly)) : '—') },
          { key: 'mg', label: 'Tarifa − costo / h', align: 'r', hideMobile: true, render: (r) => (canSal && r.e.monthlyCostCents > 0 && r.e.commercialRateCents > 0 ? formatMXN(r.e.commercialRateCents - r.hourly) : 'n/c') },
        ]}
        empty={<Empty title="No hay mecánicos registrados" text="Agrégalos en Personal y captura su costo laboral." />} />
      <p className="small muted">Eficiencia = horas estándar facturadas ÷ horas realmente trabajadas. Una eficiencia &gt; 100 % indica que el trabajo se hizo en menos tiempo que el estándar; mide tiempo, no calidad ni tipo de servicio.</p>
    </div>
  )
}

/* ───────────────────────── Indirectos ───────────────────────── */
function Indirectos({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const ctx = useCtx(), ui = useUi()
  const method = d.settings.overheadMethod
  const pool = overheadPool(d.expenses, d.settings.expenseCategories, ps.range)
  const live = d.sales.filter((s) => s.status === 'emitida' && inRange(s.date, ps.range))
  const sim = (m: OverheadMethod) => allocateOverhead(pool, m, live)
  const alloc = sim(method)
  const direct = live.reduce((a, s) => a + s.netCents - s.costCents, 0), assigned = [...alloc.values()].reduce((a, b) => a + b, 0)
  const set = async (m: OverheadMethod) => { await ui.run(() => saveSettings(ctx, { overheadMethod: m }), 'Método actualizado') }
  return (
    <div className="stack-lg">
      <div className="card stack">
        <h3>Método de asignación de costos indirectos</h3>
        <Field label="Método"><select value={method} onChange={(e) => set(e.target.value as OverheadMethod)} disabled={!d.can('config.editar')}>{(Object.keys(OVERHEAD_LABEL) as OverheadMethod[]).map((m) => <option key={m} value={m}>{OVERHEAD_LABEL[m]}</option>)}</select></Field>
        <p className="small muted">{OVERHEAD_HELP[method]}</p>
        <p className="small muted">El fondo de indirectos son los gastos operativos marcados como «asignables» en sus categorías (renta, luz, agua, herramientas…). La asignación es <b>analítica</b>: el resultado operativo global ya resta los gastos una sola vez, así que nada se duplica.</p>
      </div>
      <div className="grid">
        <Stat label="Fondo de indirectos del periodo" value={formatMXN(pool)} hint={`${fmtDate(ps.range.from)} – ${fmtDate(ps.range.to)}`} />
        <Stat label="Utilidad directa (antes de indirectos)" value={formatMXN(direct)} tone={direct < 0 ? 'bad' : undefined} hint="Observada: ventas netas − costos directos" />
        <Stat label="Resultado tras indirectos asignados" value={formatMXN(direct - assigned)} tone={direct - assigned < 0 ? 'bad' : 'ok'} hint={method === 'ninguno' ? 'Sin asignación: análisis global' : 'Estimado con el método elegido'} />
      </div>
      {method !== 'ninguno' && live.length > 0 && (
        <DataTable rows={live} rowKey={(s) => s.id} onRow={(s) => { location.hash = `/ventas/${s.id}` }}
          columns={[{ key: 'f', label: 'Venta', primary: true, render: (s) => s.folio }, { key: 'n', label: 'Venta neta', align: 'r', render: (s) => formatMXN(s.netCents) }, { key: 'u', label: 'Utilidad directa', align: 'r', render: (s) => formatMXN(s.netCents - s.costCents) }, { key: 'i', label: 'Indirecto asignado', align: 'r', render: (s) => formatMXN(alloc.get(s.id) ?? 0) }, { key: 'r', label: 'Resultado', align: 'r', render: (s) => { const v = s.netCents - s.costCents - (alloc.get(s.id) ?? 0); return <span className={tone(v)}>{formatMXN(v)}</span> } }]} />
      )}
      <div className="fcard"><h3>Comparación de métodos (mismo fondo)</h3>
        <div className="tablewrap"><table className="table"><thead><tr><th>Método</th><th className="r">Ventas con resultado negativo</th></tr></thead>
          <tbody>{(['porcentaje_ventas', 'hora_productiva', 'por_orden'] as OverheadMethod[]).map((m) => { const a = sim(m); const neg = live.filter((s) => s.netCents - s.costCents - (a.get(s.id) ?? 0) < 0).length; return <tr key={m}><td>{OVERHEAD_LABEL[m]}</td><td className="r num">{neg} de {live.length}</td></tr> })}</tbody></table></div>
        <p className="small muted">Distintos métodos cambian qué ventas parecen perder dinero después de indirectos, no el resultado total del taller.</p>
      </div>
    </div>
  )
}

/* ───────────────────────── Precios ───────────────────────── */
function Precios({ d }: { d: Data }) {
  const ctx = useCtx(), ui = useUi()
  const [cost, setCost] = useState<number | undefined>(50000), [extra, setExtra] = useState<number | undefined>(0), [labor, setLabor] = useState<number | undefined>(0)
  const [margin, setMargin] = useState<number | undefined>(d.settings.targetMarginPct), [taxId, setTaxId] = useState(d.settings.defaultTaxId), [disc, setDisc] = useState<number | undefined>(0)
  const rate = taxRateOf(d.settings, taxId)
  const r = priceCalculator({ purchaseCostCents: cost ?? 0, extraCostCents: extra ?? 0, laborCostCents: labor ?? 0, targetMarginPct: margin ?? 0, taxRate: rate, discountPct: disc ?? 0 })
  const history = useLiveQuery(() => ctx.db.priceHistory.toArray(), [ctx.db]) ?? []
  const [busy, guard] = useBusy()
  const pending = d.priceProposals.filter((p) => p.status === 'pendiente')
  const low = d.products.filter((p) => p.active && (d.stock.get(p.id)?.qty ?? 0) > 0).map((p) => ({ p, a: productAlertFor(p, unitCostOf(d, p.id), d.settings) })).filter((x) => x.a.kind === 'bajo_costo' || x.a.kind === 'margen_bajo' || (x.a.marginPct !== null && x.a.marginPct < d.settings.targetMarginPct))
  const effect = (refId: string, at: string) => {
    const from = at.slice(0, 10), before = { from: addDays(from, -30), to: addDays(from, -1) }, after = { from, to: addDays(from, 30) }
    const agg = (rg: { from: string; to: string }) => { let q = 0, n = 0, c = 0; for (const s of d.sales) if (s.status === 'emitida' && inRange(s.date, rg)) for (const i of s.items) if (i.refId === refId) { q += i.qty; n += i.netCents; c += i.costCents }; return { q, n, c } }
    return { b: agg(before), a: agg(after), future: after.to > d.today }
  }
  const generate = () => guard(async () => {
    let n = 0
    for (const x of low.slice(0, 20)) {
      if (d.priceProposals.some((q) => q.status === 'pendiente' && q.refId === x.p.id)) continue
      try { await proposePrice(ctx, 'producto', x.p.id); n++ } catch { /* sin costo calculable */ }
    }
    ui.toast(n ? `${n} propuesta(s) creada(s) para revisión` : 'No hubo propuestas nuevas')
  })
  return (
    <div className="stack-lg">
      <div className="card stack"><h3>Calculadora de precios</h3>
        <div className="grid">
          <Field label="Costo de compra"><MoneyInput cents={cost} onChange={setCost} /></Field><Field label="Gastos adicionales (flete, etc.)"><MoneyInput cents={extra} onChange={setExtra} /></Field><Field label="Costo laboral o de preparación"><MoneyInput cents={labor} onChange={setLabor} /></Field>
          <Field label="Margen objetivo (%)" hint="Sobre la venta neta"><NumInput value={margin} onChange={setMargin} /></Field>
          <Field label="Impuesto"><select value={taxId} onChange={(e) => setTaxId(e.target.value)}>{d.settings.taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Descuento previsto (%)"><NumInput value={disc} onChange={setDisc} /></Field>
        </div>
        {r.suggestedNetCents === null ? <div className="banner bad">No calculable: indica un costo mayor que cero y un margen menor a 100 %.</div> : (
          <div className="grid">
            <Stat label="Costo total estimado" value={formatMXN(r.totalCostCents)} /><Stat label="Precio de lista sugerido (sin IVA)" value={formatMXN(r.suggestedNetCents)} hint={disc ? `Después de ${disc} % de descuento: ${formatMXN(r.netAfterDiscountCents!)}` : undefined} />
            <Stat label="Utilidad prevista" value={formatMXN(r.profitCents!)} /><Stat label="Margen resultante" value={formatPct(r.marginPct)} /><Stat label="Markup" value={formatPct(r.markupPct)} />
            <Stat label="Precio final con impuestos" value={formatMXN(r.finalPriceWithTaxCents!)} hint={`${rate} % de impuesto`} />
          </div>)}
        <div className="tablewrap"><table className="table"><thead><tr><th>Margen objetivo</th>{[20, 30, 40, 50].map((m) => <th key={m} className="r">{m} %</th>)}</tr></thead>
          <tbody><tr><td>Precio sin IVA</td>{[20, 30, 40, 50].map((m) => { const x = priceCalculator({ purchaseCostCents: cost ?? 0, extraCostCents: extra ?? 0, laborCostCents: labor ?? 0, targetMarginPct: m, taxRate: rate, discountPct: disc ?? 0 }); return <td key={m} className="r num">{x.suggestedNetCents === null ? 'n/c' : formatMXN(x.suggestedNetCents)}</td> })}</tr>
            <tr><td>Markup equivalente</td>{[20, 30, 40, 50].map((m) => <td key={m} className="r num">{formatPct((m / (100 - m)) * 100)}</td>)}</tr></tbody></table></div>
        <p className="small muted">Es un simulador: nunca modifica precios reales. Para aplicar un precio, crea una propuesta y apruébala.</p>
      </div>

      <section className="stack"><div className="row between wrap"><h3>Propuestas de precio {pending.length > 0 && <Badge tone="warn">{pending.length} pendiente(s)</Badge>}</h3>{d.can('precios.editar') && low.length > 0 && <button className="btn small" disabled={busy} onClick={generate}>Generar propuestas ({low.length} bajo el margen objetivo)</button>}</div>
        {!pending.length ? <Empty title="Sin propuestas pendientes" text="Genera propuestas para los productos por debajo del margen objetivo o créalas desde la ficha del producto." /> : (
          <DataTable rows={pending} rowKey={(p) => p.id} columns={[
            { key: 'n', label: 'Artículo', primary: true, render: (p) => p.name }, { key: 'a', label: 'Precio actual', align: 'r', render: (p) => formatMXN(p.currentPriceCents) }, { key: 'p', label: 'Propuesto', align: 'r', render: (p) => formatMXN(p.proposedPriceCents) },
            { key: 'd', label: 'Cambio', align: 'r', render: (p) => (p.currentPriceCents ? ((p.proposedPriceCents - p.currentPriceCents) / p.currentPriceCents * 100 >= 0 ? '+' : '−') + Math.abs((p.proposedPriceCents - p.currentPriceCents) / p.currentPriceCents * 100).toFixed(1) + ' %' : 'n/c') },
            { key: 'c', label: 'Costo base', align: 'r', hideMobile: true, render: (p) => formatMXN(Math.round(p.costBasis)) }, { key: 'm', label: 'Margen obj.', align: 'r', hideMobile: true, render: (p) => p.targetMarginPct + ' %' },
            { key: 'x', label: '', render: (p) => d.can('precios.aprobar') ? <span className="row"><button className="btn small primary" disabled={busy} onClick={(e) => { e.stopPropagation(); guard(() => ui.run(() => decideProposal(ctx, p.id, true), 'Precio actualizado')) }}>Aprobar</button><button className="btn small" disabled={busy} onClick={(e) => { e.stopPropagation(); guard(() => ui.run(() => decideProposal(ctx, p.id, false), 'Propuesta rechazada')) }}>Rechazar</button></span> : <span className="small muted">Requiere aprobación</span> },
          ]} />)}
      </section>

      <section className="stack"><h3>Historial de precios y efecto posterior</h3>
        {!history.length ? <Empty title="Aún no hay cambios de precio" /> : (
          <DataTable rows={[...history].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60)} rowKey={(h) => h.id} columns={[
            { key: 'f', label: 'Fecha', render: (h) => fmtDate(h.at) }, { key: 'n', label: 'Artículo', primary: true, render: (h) => (h.kind === 'producto' ? d.prodMap.get(h.refId)?.name : d.svcMap.get(h.refId)?.name) ?? '—' },
            { key: 'o', label: 'Anterior', align: 'r', render: (h) => formatMXN(h.oldPriceCents) }, { key: 'w', label: 'Nuevo', align: 'r', render: (h) => formatMXN(h.newPriceCents) }, { key: 'r', label: 'Motivo', hideMobile: true, render: (h) => h.reason },
            { key: 'e', label: 'Efecto (30 d antes → 30 d después)', hideMobile: true, render: (h) => { if (h.kind !== 'producto') return 'n/c'; const e = effect(h.refId, h.at); return e.future ? 'Aún no hay 30 días posteriores' : `${formatNum(e.b.q)} → ${formatNum(e.a.q)} uds · margen ${formatPct(marginPct(e.b.n, e.b.c))} → ${formatPct(marginPct(e.a.n, e.a.c))}` } },
          ]} />)}
      </section>
      <p className="small muted">Artículos con precio por debajo del costo: {d.products.filter((p) => p.active && priceAlert(p.priceCents, unitCostOf(d, p.id), taxRateOf(d.settings, p.taxId), d.settings, p.minMarginPct).kind === 'bajo_costo').length} bajo costo. Cada cambio queda en el historial y la auditoría.</p>
    </div>
  )
}

/* ───────────────────────── Punto de equilibrio ───────────────────────── */
function Equilibrio({ d, ps }: { d: Data; ps: ReturnType<typeof usePeriod> }) {
  const st = useMemo(() => incomeStatement(d.sales, d.expenses, d.settings.expenseCategories, ps.range), [d, ps.range])
  const real = useMemo(() => breakEvenFromStatement(st), [st])
  const [fixed, setFixed] = useState<number | undefined>(undefined), [varPct, setVarPct] = useState<number | undefined>(undefined), [actual, setActual] = useState<number | undefined>(undefined)
  const fx = fixed ?? real.fixedCostsCents, vp = varPct ?? Math.round(real.variableCostPct * 10) / 10, ac = actual ?? st.netSalesCents
  const sim = breakEven({ fixedCostsCents: fx, variableCostPct: vp, actualSalesCents: ac })
  const days = Math.max(1, Math.round((new Date(ps.range.to).getTime() - new Date(ps.range.from).getTime()) / 86400000) + 1)
  const touched = fixed !== undefined || varPct !== undefined || actual !== undefined
  return (
    <div className="stack-lg">
      <div className="grid">
        <Stat label="Costos fijos del periodo" value={formatMXN(real.fixedCostsCents)} hint="Gastos operativos + nómina de mecánicos" />
        <Stat label="Costos variables" value={formatPct(real.variableCostPct)} hint="De las ventas: refacciones, consumibles y externos" />
        <Stat label="Margen de contribución" value={formatPct(real.contributionMarginPct)} />
        <Stat label="Punto de equilibrio (ventas netas)" value={real.breakEvenSalesCents === null ? 'No alcanzable' : formatMXN(real.breakEvenSalesCents)} hint={real.message} tone={real.reachable && (real.gapCents ?? 0) < 0 ? 'bad' : undefined} />
        <Stat label="Ventas netas reales" value={formatMXN(st.netSalesCents)} delta={real.gapCents === null ? null : { text: real.gapCents >= 0 ? `Superan el equilibrio por ${formatMXN(real.gapCents)}` : `Faltan ${formatMXN(-real.gapCents)}`, dir: real.gapCents >= 0 ? 'up' : 'down' }} />
        <Stat label="Costo de mantener abierto un día" value={formatMXN(Math.round(real.fixedCostsCents / days))} hint={`Costos fijos ÷ ${days} día(s) calendario`} />
        {real.breakEvenSalesCents !== null && <Stat label="Venta neta diaria necesaria" value={formatMXN(Math.round(real.breakEvenSalesCents / days))} hint="Para cubrir los costos del periodo" />}
      </div>
      <div className="card stack"><div className="row between wrap"><h3>Simulador de escenarios</h3>{touched && <button className="btn small ghost" onClick={() => { setFixed(undefined); setVarPct(undefined); setActual(undefined) }}>Volver a datos reales</button>}</div>
        <div className="grid3"><Field label="Costos fijos"><MoneyInput cents={fx} onChange={setFixed} /></Field><Field label="Costos variables (% de ventas)"><NumInput value={vp} onChange={setVarPct} /></Field><Field label="Ventas netas a comparar"><MoneyInput cents={ac} onChange={setActual} /></Field></div>
        <div className={`banner ${sim.reachable ? (sim.gapCents !== null && sim.gapCents >= 0 ? 'ok' : '') : 'bad'}`}><b>{sim.reachable ? `Punto de equilibrio: ${formatMXN(sim.breakEvenSalesCents!)}` : 'Sin punto de equilibrio'}</b> — {sim.message}{sim.coveredPct !== null && ` (${formatNum(sim.coveredPct)} % cubierto)`}</div>
        <p className="small muted">Es una <b>proyección</b> con los supuestos que indiques, no un resultado real. Punto de equilibrio = costos fijos ÷ margen de contribución.</p>
      </div>
    </div>
  )
}

export function Rentabilidad({ data }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('t') as Tab) || 'resumen'
  const ps = usePeriod(data.today, 'mes')
  const costos = data.can('costos.ver')
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Costos y rentabilidad</h1><div className="sub">Cuánto cuesta vender, cuánto ganas y dónde pierdes dinero · {ps.label}</div></div></div>
      {!costos && <div className="banner">Tu rol no tiene permiso para ver costos y márgenes.</div>}
      {costos && <>
        <Seg value={tab} onChange={(t) => setSp({ t }, { replace: true })} options={TABS} label="Sección" />
        {tab !== 'precios' && <PeriodPicker s={ps} />}
        {tab === 'resumen' && <Resumen d={data} ps={ps} />}
        {tab === 'ordenes' && <PorOrden d={data} ps={ps} />}
        {tab === 'refacciones' && <Refacciones d={data} ps={ps} />}
        {tab === 'servicios' && <Servicios d={data} ps={ps} />}
        {tab === 'mano' && <ManoObra d={data} ps={ps} />}
        {tab === 'indirectos' && <Indirectos d={data} ps={ps} />}
        {tab === 'precios' && <Precios d={data} />}
        {tab === 'equilibrio' && <Equilibrio d={data} ps={ps} />}
        <p className="small muted">Definiciones: <b>Venta</b> = importe neto de documentos emitidos · <b>Cobro</b> = dinero recibido · <b>Costo de ventas</b> = costo congelado de lo vendido · <b>Utilidad bruta</b> = venta − costo directo · <b>Utilidad operativa</b> = utilidad bruta − gastos operativos · <b>Margen</b> = utilidad ÷ venta neta · <b>Markup</b> = utilidad ÷ costo.</p>
      </>}
    </div>
  )
}
