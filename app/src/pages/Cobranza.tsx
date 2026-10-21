import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { diffDays } from '../domain/dates'
import { AGING_LABEL, AGING_ORDER, agingTotals, payables, receivables, type DueRow } from '../domain/finance'
import { formatMXN } from '../domain/money'
import type { Customer } from '../domain/types'
import { HBars, type BarRow } from '../ui/charts'
import { fmtDate, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { telLink, waLink } from '../ui/money/helpers'
import { Badge, Empty, Seg, Stat } from '../ui/ui'

type Tab = 'cobrar' | 'pagar'

const agingBars = (rows: DueRow[]): BarRow[] => {
  const t = agingTotals(rows)
  return AGING_ORDER.map((b) => ({ id: b, label: AGING_LABEL[b], sub: `${rows.filter((r) => r.bucket === b).length} doc.`, value: t[b], display: formatMXN(t[b]) }))
}
const lateText = (r: DueRow) => (r.daysLate > 0 ? `${r.daysLate} día(s) de atraso` : r.dueDate === '' ? '' : `vence ${fmtDate(r.dueDate)}`)
const lateBadge = (r: DueRow) => (r.daysLate > 0 ? <Badge tone="bad">Vencido {r.daysLate} d</Badge> : <Badge>No vencido</Badge>)

export function Cobranza({ data }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const canR = data.can('ventas.ver'), canP = data.can('gastos.ver') || data.can('compras.ver')
  const want: Tab = sp.get('t') === 'pagar' ? 'pagar' : 'cobrar'
  const tab: Tab = want === 'pagar' && canP ? 'pagar' : want === 'cobrar' && canR ? 'cobrar' : canR ? 'cobrar' : 'pagar'
  const options: [Tab, string][] = []
  if (canR) options.push(['cobrar', 'Por cobrar'])
  if (canP) options.push(['pagar', 'Por pagar'])
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Cobranza</h1><div className="sub">Lo que te deben los clientes y lo que debes a proveedores y por gastos.</div></div></div>
      {options.length > 1 && <Seg<Tab> value={tab} onChange={(t) => setSp({ t }, { replace: true })} label="Cobranza" options={options} />}
      {tab === 'cobrar' ? <PorCobrar data={data} /> : <PorPagar data={data} />}
    </div>
  )
}

/* ───────── Por cobrar ───────── */
function Contact({ c, text }: { c?: Customer; text: string }) {
  if (!c) return <span className="small muted">Sin cliente registrado</span>
  const tel = c.phone ? telLink(c.phone) : null, wa = c.phone ? waLink(c.phone, text) : null
  if (!tel && !wa) return <span className="small muted">Sin teléfono</span>
  return <>{tel && <a className="btn small" href={tel}>Llamar</a>}{wa && <a className="btn small" href={wa} target="_blank" rel="noopener">WhatsApp</a>}</>
}

function PorCobrar({ data }: { data: Data }) {
  const open = useOpen()
  const [view, setView] = useState<'doc' | 'cliente'>('doc')
  const rows = useMemo(() => receivables(data.sales, data.ledger, data.today), [data.sales, data.ledger, data.today])
  const total = rows.reduce((a, r) => a + r.balanceCents, 0)
  const overdue = rows.filter((r) => r.daysLate > 0).reduce((a, r) => a + r.balanceCents, 0)
  const canPay = data.can('cobros.registrar')
  const biz = data.settings.businessName || 'el taller'

  const groups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; customerId: string; rows: DueRow[] }>()
    for (const r of rows) {
      const k = r.partyId || `n:${r.party}`
      const g = m.get(k) ?? { key: k, name: r.party, customerId: r.partyId, rows: [] }
      g.rows.push(r); m.set(k, g)
    }
    return [...m.values()].map((g) => ({ ...g, total: g.rows.reduce((a, r) => a + r.balanceCents, 0), maxLate: Math.max(...g.rows.map((r) => r.daysLate)) })).sort((a, b) => b.maxLate - a.maxLate || b.total - a.total)
  }, [rows])

  // Anticipos sin aplicar: cobros ligados a una orden cuya venta aún no los absorbe.
  const advances = useMemo(() => {
    const m = new Map<string, { orderId: string; cents: number; last: string; customerId?: string }>()
    for (const l of data.ledger) {
      if (!l.workOrderId || l.saleId || (l.kind !== 'cobro_cliente' && l.kind !== 'reembolso_cliente')) continue
      const o = data.orderMap.get(l.workOrderId)
      const sale = o?.saleId ? data.sales.find((s) => s.id === o.saleId) : undefined
      if (sale && sale.status === 'emitida') continue
      const g = m.get(l.workOrderId) ?? { orderId: l.workOrderId, cents: 0, last: l.date, customerId: l.customerId }
      g.cents += l.direction === 'in' ? l.amountCents : -l.amountCents
      if (l.date > g.last) g.last = l.date
      m.set(l.workOrderId, g)
    }
    return [...m.values()].filter((g) => g.cents > 0).sort((a, b) => b.last.localeCompare(a.last))
  }, [data.ledger, data.orderMap, data.sales])

  const reminder = (r: DueRow) => `Hola ${r.party}, te escribimos de ${biz}. Tienes un saldo pendiente de ${formatMXN(r.balanceCents)} de la venta ${r.folio}${r.daysLate > 0 ? ` (vencido hace ${r.daysLate} días)` : ''}. ¡Gracias!`
  const docRow = (r: DueRow, showParty: boolean) => {
    const c = r.partyId ? data.custMap.get(r.partyId) : undefined
    return (
      <div className="mny-doc" key={r.id}>
        <div className="grow" style={{ minWidth: 180 }}>
          <div className="row wrap" style={{ gap: 6 }}><Link to={`/ventas/${r.docId}`}><b>{r.folio}</b></Link>{lateBadge(r)}</div>
          <div className="small muted">{showParty ? `${r.party} · ` : ''}{fmtDate(r.date)} · {lateText(r)} · total {formatMXN(r.totalCents)}, cobrado {formatMXN(r.paidCents)}</div>
        </div>
        <b className="num">{formatMXN(r.balanceCents)}</b>
        <div className="mny-actions">
          {canPay && <button className="btn small primary" onClick={() => open({ k: 'payment', saleId: r.docId })}>Cobrar</button>}
          <Contact c={c} text={reminder(r)} />
          <Link className="btn small" to={`/ventas/${r.docId}`}>Ver venta</Link>
          {c && <Link className="btn small ghost" to={`/clientes/${c.id}`}>Ver cliente</Link>}
        </div>
      </div>
    )
  }

  return (
    <div className="stack-lg">
      <div className="grid">
        <Stat label="Total por cobrar" value={formatMXN(total)} hint={`${rows.length} venta(s) con saldo`} />
        <Stat label="Vencido" value={formatMXN(overdue)} tone={overdue > 0 ? 'bad' : 'ok'} hint={overdue > 0 ? 'Pasó su fecha de vencimiento' : 'Nada vencido'} />
        <Stat label="No vencido" value={formatMXN(total - overdue)} hint="Aún dentro de plazo" />
      </div>
      {rows.length === 0 ? <Empty title="No hay ventas por cobrar" text="Cuando una venta quede con saldo pendiente aparecerá aquí con su antigüedad." /> : (
        <>
          <section className="fcard" aria-label="Antigüedad de saldos"><h2>Antigüedad de saldos</h2><HBars rows={agingBars(rows)} /><div className="small muted">Días transcurridos desde la fecha de vencimiento. Una venta con saldo nunca se considera pagada.</div></section>
          <section className="stack" aria-label="Detalle por cobrar">
            <div className="row between wrap"><h2>Saldos pendientes</h2><Seg value={view} onChange={setView} label="Agrupar" options={[['doc', 'Por documento'], ['cliente', 'Por cliente']]} /></div>
            {view === 'doc' ? <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>{rows.map((r) => docRow(r, true))}</div> : (
              <div className="stack">{groups.map((g) => (
                <div className="card" key={g.key}>
                  <div className="row between wrap"><div><b>{g.customerId ? <Link to={`/clientes/${g.customerId}`}>{g.name}</Link> : g.name}</b><div className="small muted">{g.rows.length} documento(s){g.maxLate > 0 ? ` · el más atrasado: ${g.maxLate} día(s)` : ''}</div></div><b className="num" style={{ fontSize: '1.15rem' }}>{formatMXN(g.total)}</b></div>
                  {g.rows.map((r) => docRow(r, false))}
                </div>
              ))}</div>
            )}
          </section>
        </>
      )}
      <section className="stack" aria-label="Anticipos sin aplicar">
        <h2>Anticipos sin aplicar</h2>
        <div className="small muted">Dinero recibido de clientes por órdenes que todavía no tienen venta. Están identificados y no cuentan como venta ni como utilidad; la venta los absorberá al emitirse.</div>
        {advances.length === 0 ? <div className="banner info">No hay anticipos pendientes de aplicar.</div> : (
          <div className="stack">{advances.map((a) => {
            const o = data.orderMap.get(a.orderId), c = (o?.customerId ?? a.customerId) ? data.custMap.get((o?.customerId ?? a.customerId) as string) : undefined
            return (
              <div className="card" key={a.orderId}><div className="row between wrap"><div><b>{o ? <Link to={`/ordenes/${o.id}`}>{o.folio}</Link> : 'Orden'}</b> · {c?.name ?? '—'}<div className="small muted">Último anticipo: {fmtDate(a.last)}</div></div><b className="num">{formatMXN(a.cents)}</b></div></div>
            )
          })}<div className="small muted">Total en anticipos: <b className="num">{formatMXN(advances.reduce((a, x) => a + x.cents, 0))}</b></div></div>
        )}
      </section>
    </div>
  )
}

/* ───────── Por pagar ───────── */
function PorPagar({ data }: { data: Data }) {
  const open = useOpen()
  const rows = useMemo(() => payables(data.receipts, data.expenses, data.ledger, (id) => (id ? data.supMap.get(id)?.name ?? '—' : '—'), data.today), [data.receipts, data.expenses, data.ledger, data.supMap, data.today])
  const total = rows.reduce((a, r) => a + r.balanceCents, 0)
  const overdue = rows.filter((r) => r.daysLate > 0).reduce((a, r) => a + r.balanceCents, 0)
  const soon = rows.filter((r) => r.daysLate === 0 && diffDays(data.today, r.dueDate) <= 7).sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  const soonTotal = soon.reduce((a, r) => a + r.balanceCents, 0)
  const canSup = data.can('pagos_proveedor.registrar'), canExp = data.can('gastos.editar')
  const row = (r: (typeof rows)[number]) => (
    <div className="mny-doc" key={r.kind + r.id}>
      <div className="grow" style={{ minWidth: 180 }}>
        <div className="row wrap" style={{ gap: 6 }}><b>{r.kind === 'compra' ? `Compra ${r.folio}` : r.folio}</b><Badge tone={r.kind === 'compra' ? 'info' : ''}>{r.kind === 'compra' ? 'Compra' : 'Gasto'}</Badge>{lateBadge(r)}</div>
        <div className="small muted">{r.kind === 'compra' ? `${r.party} · ` : r.partyId ? `${r.party} · ` : ''}{fmtDate(r.date)} · {lateText(r)} · total {formatMXN(r.totalCents)}, pagado {formatMXN(r.paidCents)}</div>
      </div>
      <b className="num">{formatMXN(r.balanceCents)}</b>
      <div className="mny-actions">
        {r.kind === 'compra' ? (canSup && <button className="btn small primary" onClick={() => open({ k: 'supplierpay', receiptId: r.docId })}>Pagar compra</button>) : (canExp && <button className="btn small primary" onClick={() => open({ k: 'expensepay', expenseId: r.docId })}>Pagar gasto</button>)}
        {r.kind === 'compra' && <Link className="btn small" to="/compras?t=recepciones">Ver compras</Link>}
        {r.kind === 'gasto' && <Link className="btn small" to="/gastos?t=gastos">Ver gastos</Link>}
      </div>
    </div>
  )
  return (
    <div className="stack-lg">
      <div className="grid">
        <Stat label="Total por pagar" value={formatMXN(total)} hint={`${rows.length} documento(s)`} />
        <Stat label="Vencido" value={formatMXN(overdue)} tone={overdue > 0 ? 'bad' : 'ok'} hint={overdue > 0 ? 'Ya pasó su vencimiento' : 'Nada vencido'} />
        <Stat label="Vence en 7 días" value={formatMXN(soonTotal)} hint={`${soon.length} documento(s)`} />
      </div>
      {rows.length === 0 ? <Empty title="No hay pagos pendientes" text="Las compras recibidas y los gastos con saldo aparecerán aquí." /> : (
        <>
          <section className="fcard" aria-label="Antigüedad de saldos por pagar"><h2>Antigüedad de saldos</h2><HBars rows={agingBars(rows)} color="var(--ch-2)" /></section>
          {soon.length > 0 && <section className="stack" aria-label="Próximas a vencer"><h2>Próximas a vencer (7 días)</h2><div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>{soon.map(row)}</div></section>}
          <section className="stack" aria-label="Detalle por pagar"><h2>Todos los pendientes</h2><div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>{rows.map(row)}</div></section>
        </>
      )}
    </div>
  )
}
