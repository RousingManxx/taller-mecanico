import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { addDays, bucketFor, bucketKeys, diffDays, endOfMonth, startOfWeek, type Bucket } from '../domain/dates'
import { agingTotals, cashFlow, incomeStatement, inventoryValueAt, payables, profitBy, receivables, receivablesAt, series } from '../domain/finance'
import { formatMXN, formatNum } from '../domain/money'
import { OPEN_STATUSES, STATUS_LABEL, STATUS_ORDER } from '../domain/orders'
import { buildAlerts } from '../ui/alerts'
import { CAT_COLORS, Donut, HBars, Legend, MarginChart, SeriesBars, toSlices, TrendChart } from '../ui/charts'
import { useOpen, type Sheet } from '../ui/create'
import { fmtDate, fmtDateTime, plateOf, type Data } from '../ui/data'
import { PeriodPicker, usePeriod } from '../ui/period'
import { useSession } from '../ui/session'
import { Badge, deltaText, Empty, Icon, Stat } from '../ui/ui'

const TYPE_LABEL: Record<string, string> = { servicio: 'Mano de obra', refaccion: 'Refacciones', consumible: 'Consumibles', externo: 'Servicios externos', otro: 'Otros cargos' }

function QuickActions({ data }: { data: Data }) {
  const open = useOpen()
  const A: { k: Sheet['k']; l: string; i: string; p: Parameters<Data['can']>[0] }[] = [
    { k: 'order', l: 'Crear orden de trabajo', i: 'wrench', p: 'ordenes.crear' }, { k: 'customer', l: 'Registrar cliente', i: 'user', p: 'clientes.editar' },
    { k: 'vehicle', l: 'Registrar vehículo', i: 'car', p: 'vehiculos.editar' }, { k: 'quote', l: 'Crear cotización', i: 'doc', p: 'cotizaciones.editar' },
    { k: 'sale', l: 'Registrar una venta', i: 'cash', p: 'ventas.crear' }, { k: 'purchase', l: 'Registrar compra', i: 'truck', p: 'compras.editar' },
    { k: 'expense', l: 'Registrar gasto', i: 'receipt', p: 'gastos.editar' }, { k: 'payment', l: 'Registrar pago', i: 'wallet', p: 'cobros.registrar' },
  ]
  const list = A.filter((a) => data.can(a.p))
  return (
    <section className="stack" aria-label="Acciones rápidas">
      <h2>Acciones rápidas</h2>
      <div className="morelist">
        {list.map((a) => <button key={a.k} className="item" style={{ flexDirection: 'column', textAlign: 'center', padding: '14px 8px' }} onClick={() => open({ k: a.k } as Sheet)}><Icon n={a.i} size={24} /><span className="small" style={{ fontWeight: 600 }}>{a.l}</span></button>)}
        {data.can('finanzas.ver') && <Link className="item" to="/rentabilidad" style={{ flexDirection: 'column', textAlign: 'center', padding: '14px 8px' }}><Icon n="pie" size={24} /><span className="small" style={{ fontWeight: 600 }}>Consultar rentabilidad</span></Link>}
      </div>
    </section>
  )
}

function Activity({ data }: { data: Data }) {
  const rows = useMemo(() => {
    const out: { at: string; icon: string; title: string; sub: string; to: string }[] = []
    if (data.can('ordenes.ver')) for (const o of data.orders) out.push({ at: o.createdAt, icon: 'wrench', title: `Orden ${o.folio} creada`, sub: `${data.custMap.get(o.customerId)?.name ?? ''} · ${plateOf(data.vehMap.get(o.vehicleId))}`, to: `/ordenes/${o.id}` })
    if (data.can('cotizaciones.ver')) for (const q of data.quotations) if (q.status === 'enviada' || q.status === 'vista') out.push({ at: q.updatedAt, icon: 'doc', title: `Cotización ${q.folio} pendiente de aprobación`, sub: data.custMap.get(q.customerId)?.name ?? '', to: `/cotizaciones/${q.id}` })
    if (data.can('ventas.ver')) for (const l of data.ledger) if (l.kind === 'cobro_cliente') out.push({ at: l.at, icon: 'wallet', title: `Pago registrado ${formatMXN(l.amountCents)}`, sub: l.note, to: l.saleId ? `/ventas/${l.saleId}` : '/ventas' })
    if (data.can('compras.ver')) for (const r of data.receipts) out.push({ at: r.createdAt, icon: 'truck', title: `Compra recibida ${r.folio}`, sub: `${data.supMap.get(r.supplierId)?.name ?? ''} · ${formatMXN(r.totalCents)}`, to: '/compras?t=recepciones' })
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)
  }, [data])
  if (!rows.length) return <Empty title="Sin actividad reciente" text="Aquí verás órdenes, pagos y compras en cuanto empieces a operar." />
  return <div className="stack-sm">{rows.map((r, i) => <Link key={i} className="item" to={r.to}><Icon n={r.icon} size={20} /><div className="grow"><div className="ttl">{r.title}</div><div className="sub">{r.sub} · {fmtDateTime(r.at)}</div></div></Link>)}</div>
}

function MechanicHome({ data }: { data: Data }) {
  const { user } = useSession()
  const mine = data.orders.filter((o) => OPEN_STATUSES.includes(o.status))
  const emp = data.empMap.get(user.employeeId ?? '')
  const running = mine.flatMap((o) => o.timeEntries.filter((t) => !t.endAt && t.kind === 'trabajo' && t.employeeId === user.employeeId).map(() => o))
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Hola, {user.name.split(' ')[0]}</h1><div className="sub">{emp?.specialty || 'Mecánico'} · tus órdenes asignadas</div></div></div>
      {running.length > 0 && <Link className="banner ok" to={`/ordenes/${running[0].id}`}>Tienes un cronómetro en marcha en la orden {running[0].folio}. Toca para abrirla.</Link>}
      <div className="grid"><Stat label="Órdenes abiertas" value={mine.length} to="/ordenes" /><Stat label="Por reparar" value={mine.filter((o) => ['autorizada', 'en_reparacion'].includes(o.status)).length} /><Stat label="Esperando refacciones" value={mine.filter((o) => o.status === 'esperando_refacciones').length} /></div>
      <section className="stack"><h2>Mis órdenes</h2>
        {!mine.length && <Empty title="No tienes órdenes abiertas" text="Cuando la recepción te asigne una orden aparecerá aquí." />}
        {mine.map((o) => <Link key={o.id} className="item" to={`/ordenes/${o.id}`}><div className="grow"><div className="ttl">{o.folio} · {plateOf(data.vehMap.get(o.vehicleId))}</div><div className="sub">{o.complaint}</div></div><Badge tone="info">{STATUS_LABEL[o.status]}</Badge></Link>)}
      </section>
    </div>
  )
}

export function Inicio({ data }: { data: Data }) {
  const { user } = useSession()
  const nav = useNavigate()
  const ps = usePeriod(data.today, 'mes')
  const canFin = data.can('finanzas.ver')
  const cats = data.settings.expenseCategories
  const st = useMemo(() => incomeStatement(data.sales, data.expenses, cats, ps.range), [data.sales, data.expenses, cats, ps.range])
  const prev = useMemo(() => incomeStatement(data.sales, data.expenses, cats, ps.prev), [data.sales, data.expenses, cats, ps.prev])
  const today = useMemo(() => incomeStatement(data.sales, data.expenses, cats, { from: data.today, to: data.today }), [data.sales, data.expenses, cats, data.today])
  const cf = useMemo(() => cashFlow(data.ledger, ps.range), [data.ledger, ps.range])
  const cfPrev = useMemo(() => cashFlow(data.ledger, ps.prev), [data.ledger, ps.prev])
  const ar = useMemo(() => receivables(data.sales, data.ledger, data.today), [data.sales, data.ledger, data.today])
  const ap = useMemo(() => payables(data.receipts, data.expenses, data.ledger, (id) => data.supMap.get(id ?? '')?.name ?? '—', data.today), [data.receipts, data.expenses, data.ledger, data.supMap, data.today])
  const invValue = useMemo(() => [...data.stock.values()].reduce((a, b) => a + b.valueCents, 0), [data.stock])
  const pts = useMemo(() => series(data.sales, data.ledger, data.expenses, cats, ps.range), [data.sales, data.ledger, data.expenses, cats, ps.range])
  const bucket: Bucket = bucketFor(ps.range)
  const evo = useMemo(() => {
    const keys = bucketKeys(ps.range, bucket)
    return keys.map((k) => {
      const end = [bucket === 'dia' ? k : bucket === 'semana' ? addDays(startOfWeek(k), 6) : endOfMonth(k), data.today].sort()[0]
      return { key: k, label: k.slice(5), ar: receivablesAt(data.sales, data.ledger, end), inv: inventoryValueAt(data.movements, end) }
    })
  }, [data.sales, data.ledger, data.movements, ps.range, bucket, data.today])
  const pctx = useMemo(() => ({ productCategory: (id?: string) => data.prodMap.get(id ?? '')?.category ?? 'Otros', serviceCategory: (id?: string) => data.svcMap.get(id ?? '')?.category ?? 'Otros', employeeName: (id?: string) => data.empMap.get(id ?? '')?.name ?? 'Sin asignar' }), [data])
  const byService = useMemo(() => profitBy(data.sales, ps.range, 'servicio', pctx).sort((a, b) => b.profitCents - a.profitCents).slice(0, 6), [data.sales, ps.range, pctx])
  const byProduct = useMemo(() => profitBy(data.sales, ps.range, 'producto', pctx).sort((a, b) => b.profitCents - a.profitCents).slice(0, 6), [data.sales, ps.range, pctx])
  const byCat = useMemo(() => profitBy(data.sales, ps.range, 'categoria', pctx).filter((r) => r.marginPct !== null).sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0)).slice(0, 8), [data.sales, ps.range, pctx])
  const byMech = useMemo(() => profitBy(data.sales, ps.range, 'mecanico', pctx).sort((a, b) => b.netCents - a.netCents).slice(0, 6), [data.sales, ps.range, pctx])
  const statusCounts = STATUS_ORDER.map((s) => ({ s, n: data.orders.filter((o) => o.status === s).length })).filter((x) => x.n > 0 && x.s !== 'cancelada')
  const openOrders = data.orders.filter((o) => OPEN_STATUSES.includes(o.status))
  const alerts = useMemo(() => buildAlerts(data), [data])
  const empty = data.orders.length === 0 && data.sales.length === 0
  const hasReal = data.customers.length > 0 || data.orders.length > 0
  const backupDays = data.settings.lastBackupAt ? diffDays(data.settings.lastBackupAt.slice(0, 10), data.today) : null
  const backupDue = hasReal && data.can('respaldo.exportar') && (backupDays === null || backupDays >= 7)
  const openCash = data.cashSessions.find((c) => c.status === 'abierta')
  const dd = (a: number, b: number, goodUp = true) => deltaText(a, b, true, goodUp)
  const ppDelta = (a: number | null, b: number | null) => (a === null || b === null ? null : { text: `${a - b >= 0 ? '▲ +' : '▼ −'}${Math.abs(a - b).toFixed(1)} puntos`, dir: (Math.abs(a - b) < 0.05 ? 'flat' : a > b ? 'up' : 'down') as 'up' | 'down' | 'flat' })
  const pl = ps.label.toLowerCase()

  if (!data.can('ordenes.ver_todas') && data.can('ordenes.tiempos') && !canFin) return <MechanicHome data={data} />

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>{data.settings.businessName || 'Inicio'}</h1><div className="sub">Hola, {user.name.split(' ')[0]} · {fmtDate(data.today)}</div></div></div>
      {backupDue && <Link to="/ajustes" className="banner">{data.settings.lastBackupAt ? `Tu última copia de seguridad fue hace ${backupDays} días.` : 'Aún no has hecho una copia de seguridad.'} Tus datos viven solo en este dispositivo: descarga una copia en Ajustes.</Link>}
      {openCash && data.can('caja.ver') && openCash.openedAt.slice(0, 10) < data.today && <Link to="/caja" className="banner bad">La caja abierta el {fmtDate(openCash.openedAt)} sigue abierta: ciérrala para cuadrar el efectivo.</Link>}
      {!data.settings.onboardingDone && empty && <Link to="/guia" className="banner info">Continúa tu guía de inicio: configura tu taller y registra tu primera orden en minutos →</Link>}

      <QuickActions data={data} />

      {canFin && (
        <section className="stack">
          <div className="row between wrap"><h2>Resumen financiero</h2><span className="small muted">{ps.label} · {fmtDate(ps.range.from)} – {fmtDate(ps.range.to)}</span></div>
          <PeriodPicker s={ps} compact />
          {empty && <div className="banner info">Todavía no hay ventas registradas: los indicadores aparecerán en cuanto cierres tu primera orden o venta.</div>}
          <div className="grid">
            <Stat label="Ventas de hoy" value={formatMXN(today.netSalesCents)} hint="Netas, antes de IVA" to="/ventas?f=hoy" />
            <Stat label={`Ventas netas (${pl})`} value={formatMXN(st.netSalesCents)} delta={dd(st.netSalesCents, prev.netSalesCents)} hint={`${st.salesCount} venta(s) · antes de IVA`} to="/ventas" />
            <Stat label="Costos directos" value={formatMXN(st.cogs.totalCents)} delta={dd(st.cogs.totalCents, prev.cogs.totalCents, false)} hint="Refacciones, consumibles, externos y mano de obra" />
            <Stat label="Utilidad bruta" value={st.netSalesCents ? formatMXN(st.grossProfitCents) : '—'} tone={st.grossProfitCents < 0 ? 'bad' : undefined} delta={dd(st.grossProfitCents, prev.grossProfitCents)} hint="Ventas netas − costos directos" />
            <Stat label="Margen bruto" value={st.grossMarginPct === null ? 'n/c' : formatNum(st.grossMarginPct) + ' %'} delta={ppDelta(st.grossMarginPct, prev.grossMarginPct)} hint="Utilidad ÷ venta neta" />
            <Stat label={`Gastos operativos (${pl})`} value={formatMXN(st.opex.totalCents)} delta={dd(st.opex.totalCents, prev.opex.totalCents, false)} hint="Devengados; sin compras de inventario" to="/gastos" />
            <Stat label="Utilidad operativa estimada" value={st.netSalesCents || st.opex.totalCents ? formatMXN(st.operatingProfitCents) : '—'} tone={st.operatingProfitCents < 0 ? 'bad' : st.operatingProfitCents > 0 ? 'ok' : undefined} delta={dd(st.operatingProfitCents, prev.operatingProfitCents)} hint="Estimación gerencial, no contabilidad" />
            <Stat label={`Dinero cobrado (${pl})`} value={formatMXN(cf.collectedCents)} delta={dd(cf.collectedCents, cfPrev.collectedCents)} hint="Cobros de clientes (≠ ventas)" to="/caja" />
            <Stat label="Por cobrar (hoy)" value={formatMXN(ar.reduce((a, r) => a + r.balanceCents, 0))} hint={`${ar.length} documento(s)${ar.some((r) => r.daysLate > 0) ? ' · hay vencidos' : ''}`} to="/cobranza" tone={ar.some((r) => r.daysLate > 30) ? 'bad' : undefined} />
            <Stat label="Por pagar (hoy)" value={formatMXN(ap.reduce((a, r) => a + r.balanceCents, 0))} hint={`${ap.length} obligación(es)`} to="/cobranza?t=pagar" />
            <Stat label="Valor del inventario" value={formatMXN(invValue)} hint="Costo promedio vigente" to="/inventario" />
            <Stat label="Órdenes abiertas" value={openOrders.length} hint={`${openOrders.filter((o) => o.status === 'lista_entrega').length} lista(s) para entrega`} to="/ordenes" />
          </div>
          {prev.netSalesCents === 0 && prev.cogs.totalCents === 0 && <p className="small muted">Aún no hay periodo anterior con ventas: las variaciones aparecerán cuando exista una base de comparación.</p>}
          {st.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
        </section>
      )}

      {canFin && !empty && (
        <section className="stack">
          <h2>Gráficas</h2>
          <div className="cols2">
            <div className="fcard"><h3>Ventas, costos y utilidad bruta</h3><Legend items={[{ label: 'Ventas netas', color: 'var(--ch-sales)' }, { label: 'Costos directos', color: 'var(--ch-cost)', kind: 'hatch' }, { label: 'Utilidad bruta', color: 'var(--ch-profit)', kind: 'line' }]} /><TrendChart points={pts} showCollected empty={<Empty title="Sin ventas en este periodo" />} /></div>
            <div className="fcard"><h3>Margen bruto</h3><MarginChart points={pts} empty={<Empty title="Sin ventas en este periodo" text="El margen no se calcula sin ventas." />} /></div>
            <div className="fcard"><h3>Ingresos: refacciones vs. mano de obra</h3>{st.netSalesCents > 0 ? <Donut centerLabel="ventas netas" title="Ingresos por tipo" slices={toSlices(Object.entries(st.salesByType).map(([k, v]) => ({ key: k, label: TYPE_LABEL[k], cents: v })))} /> : <Empty title="Sin ventas en este periodo" />}</div>
            <div className="fcard"><h3>Gastos por categoría</h3>{st.opex.totalCents > 0 ? <Donut centerLabel="gastos" title="Gastos por categoría" slices={toSlices([...st.opex.byCategory.map((x) => ({ key: x.categoryId, label: x.name, cents: x.cents })), ...(st.idleLaborCents ? [{ key: 'ocio', label: 'Capacidad ociosa de mano de obra', cents: st.idleLaborCents }] : [])])} /> : <Empty title="Sin gastos en este periodo" />}</div>
            <div className="fcard"><h3>Margen por categoría</h3>{byCat.length ? <HBars rows={byCat.map((r) => ({ id: r.key, label: r.label, sub: formatMXN(r.netCents), value: r.marginPct ?? 0, display: formatNum(r.marginPct ?? 0) + ' %' }))} color={CAT_COLORS[0]} /> : <Empty title="Sin datos" />}</div>
            <div className="fcard"><h3>Servicios más rentables</h3>{byService.length ? <HBars rows={byService.map((r) => ({ id: r.key, label: r.label, sub: r.marginPct === null ? 'n/c' : formatNum(r.marginPct) + ' %', value: r.profitCents, display: formatMXN(r.profitCents) }))} /> : <Empty title="Sin servicios vendidos" />}</div>
            <div className="fcard"><h3>Refacciones más rentables</h3>{byProduct.length ? <HBars rows={byProduct.map((r) => ({ id: r.key, label: r.label, sub: r.marginPct === null ? 'n/c' : formatNum(r.marginPct) + ' %', value: r.profitCents, display: formatMXN(r.profitCents) }))} color="var(--ch-3)" /> : <Empty title="Sin refacciones vendidas" />}</div>
            <div className="fcard"><h3>Ventas de mano de obra por mecánico</h3>{byMech.length ? <HBars rows={byMech.map((r) => ({ id: r.key, label: r.label, sub: `${formatNum(r.qty)} h`, value: r.netCents, display: formatMXN(r.netCents) }))} color="var(--ch-4)" /> : <Empty title="Sin datos" />}<p className="small muted">Ventas atribuidas ≠ beneficio generado por la persona.</p></div>
            <div className="fcard"><h3>Cuentas por cobrar (evolución)</h3><SeriesBars label="Por cobrar" points={evo.map((e) => ({ key: e.key, label: e.label, value: e.ar }))} color="var(--ch-2)" empty={<Empty title="Sin saldos por cobrar" />} /></div>
            <div className="fcard"><h3>Valor del inventario (evolución)</h3><SeriesBars label="Inventario" points={evo.map((e) => ({ key: e.key, label: e.label, value: e.inv }))} color="var(--ch-8)" empty={<Empty title="Sin inventario" />} /></div>
            <div className="fcard"><h3>Antigüedad de cuentas por cobrar</h3>{ar.length ? <HBars rows={Object.entries(agingTotals(ar)).map(([k, v]) => ({ id: k, label: ({ no_vencido: 'No vencido', d1_30: '1–30 días', d31_60: '31–60 días', d61_90: '61–90 días', d90_mas: 'Más de 90 días' } as Record<string, string>)[k], value: v, display: formatMXN(v) }))} color="var(--ch-2)" onSelect={() => nav('/cobranza')} /> : <Empty title="Todo cobrado" />}</div>
          </div>
        </section>
      )}

      <section className="stack"><h2>Órdenes por estado</h2>
        {statusCounts.length ? <HBars rows={statusCounts.map((x) => ({ id: x.s, label: STATUS_LABEL[x.s], value: x.n, display: String(x.n) }))} onSelect={(id) => nav(`/ordenes?estado=${id}`)} color="var(--ch-1)" /> : <Empty title="Sin órdenes todavía" text="Crea la primera con «Crear orden de trabajo»." />}
      </section>

      <div className="cols2">
        <section className="stack"><h2>Alertas</h2>
          {!alerts.length ? <div className="banner ok">Todo en orden: no hay alertas pendientes.</div> : alerts.slice(0, 7).map((a) => <Link key={a.id} className="item" to={a.to}><Badge tone={a.tone === 'bad' ? 'bad' : a.tone === 'warn' ? 'warn' : 'info'}>{a.tone === 'bad' ? 'Crítica' : a.tone === 'warn' ? 'Aviso' : 'Info'}</Badge><div className="grow"><div className="ttl">{a.title}</div><div className="sub">{a.detail}</div></div></Link>)}
        </section>
        <section className="stack"><h2>Actividad reciente</h2><Activity data={data} /></section>
      </div>
    </div>
  )
}
