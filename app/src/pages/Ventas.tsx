import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { inRange } from '../domain/dates'
import { cashFlow, incomeStatement, PAY_LABEL, payStatus, receivables, saleBalance, salePaid, type PayStatus } from '../domain/finance'
import { toCsv } from '../domain/csv'
import { formatMXN, formatPct } from '../domain/money'
import type { Sale } from '../domain/types'
import { download, fmtDate, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { PayBadge, PeriodPicker } from '../ui/money/common'
import { initPer, pesosStr, rangeOf, rangeText, type PerState } from '../ui/money/helpers'
import { Chips, DataTable, Empty, Stat } from '../ui/ui'

type PayFilter = 'todas' | 'pendientes' | 'pagada' | 'cancelada'
type KindFilter = 'todos' | 'orden' | 'mostrador'

export function Ventas({ data }: { data: Data }) {
  const open = useOpen(), nav = useNavigate()
  const [sp] = useSearchParams()
  const f = sp.get('f')
  const [per, setPer] = useState<PerState>(() => initPer(f === 'pendientes' ? 'todo' : f === 'hoy' ? 'hoy' : 'mes', data.today))
  const [pay, setPay] = useState<PayFilter>(f === 'pendientes' ? 'pendientes' : 'todas')
  const [kind, setKind] = useState<KindFilter>('todos')
  const [q, setQ] = useState('')
  const costs = data.can('costos.ver')
  const range = useMemo(() => rangeOf(per, data.today), [per, data.today])

  const st = useMemo(() => incomeStatement(data.sales, data.expenses, data.settings.expenseCategories, range), [data.sales, data.expenses, data.settings.expenseCategories, range])
  const collected = useMemo(() => cashFlow(data.ledger, range).collectedCents, [data.ledger, range])
  const due = useMemo(() => receivables(data.sales, data.ledger, data.today), [data.sales, data.ledger, data.today])
  const dueTotal = due.reduce((a, r) => a + r.balanceCents, 0)
  const overdue = due.filter((r) => r.daysLate > 0).reduce((a, r) => a + r.balanceCents, 0)

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return data.sales.filter((s) => {
      if (!inRange(s.date, range)) return false
      if (kind !== 'todos' && s.kind !== kind) return false
      const ps = payStatus(s, data.ledger)
      if (pay === 'pendientes' && ps !== 'pendiente' && ps !== 'parcial') return false
      if (pay === 'pagada' && ps !== 'pagada') return false
      if (pay === 'cancelada' && ps !== 'cancelada') return false
      if (t && !(s.folio.toLowerCase().includes(t) || s.customerName.toLowerCase().includes(t))) return false
      return true
    }).sort((a, b) => b.date.localeCompare(a.date) || b.folio.localeCompare(a.folio))
  }, [data.sales, data.ledger, range, kind, pay, q])
  const status = (s: Sale): PayStatus => payStatus(s, data.ledger)
  const listTotals = useMemo(() => rows.reduce((a, s) => (s.status === 'cancelada' ? a : { total: a.total + s.totalCents, paid: a.paid + salePaid(s, data.ledger), bal: a.bal + Math.max(0, saleBalance(s, data.ledger)) }), { total: 0, paid: 0, bal: 0 }), [rows, data.ledger])

  const exportCsv = () => {
    const head = ['folio', 'fecha', 'cliente', 'tipo', 'estado_de_pago', 'venta_neta_mxn', 'iva_mxn', 'total_mxn', 'cobrado_mxn', 'saldo_mxn', ...(costs ? ['costo_directo_mxn', 'utilidad_bruta_mxn', 'margen_pct'] : [])]
    const body = rows.map((s) => [s.folio, s.date, s.customerName, s.kind === 'orden' ? 'Orden' : 'Mostrador', PAY_LABEL[status(s)], pesosStr(s.netCents), pesosStr(s.taxCents), pesosStr(s.totalCents), pesosStr(salePaid(s, data.ledger)), pesosStr(saleBalance(s, data.ledger)),
      ...(costs ? [pesosStr(s.costCents), pesosStr(s.netCents - s.costCents), s.netCents > 0 ? (((s.netCents - s.costCents) / s.netCents) * 100).toFixed(1) : 'n/c'] : [])])
    download(`ventas_${range.from}_${range.to}.csv`.replace('2000-01-01_2999-12-31', 'historial'), toCsv(head, body), 'text/csv;charset=utf-8')
  }

  const canPay = data.can('cobros.registrar'), canSell = data.can('ventas.crear')
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Ventas y cobros</h1><div className="sub">{rangeText(per, range)} · una venta no es un cobro: el dinero se registra al cobrar.</div></div>
        <div className="row wrap">
          {canPay && <button className="btn" onClick={() => open({ k: 'payment' })}>Registrar cobro</button>}
          {canSell && <button className="btn primary" onClick={() => open({ k: 'sale' })}>Nueva venta</button>}
        </div>
      </div>

      <PeriodPicker value={per} onChange={setPer} today={data.today} all />

      <div className="grid">
        <Stat label="Ventas netas" value={formatMXN(st.netSalesCents)} hint="Antes de IVA y menos devoluciones" />
        <Stat label="Cobrado en el periodo" value={formatMXN(collected)} hint="Dinero recibido (puede ser de ventas anteriores)" />
        <Stat label="Por cobrar (hoy)" value={formatMXN(dueTotal)} tone={overdue > 0 ? 'bad' : undefined} hint={overdue > 0 ? `Vencido: ${formatMXN(overdue)}` : 'Sin saldos vencidos'} to="/cobranza?t=cobrar" />
        <Stat label="Número de ventas" value={String(st.salesCount)} hint="Emitidas, sin canceladas" />
        <Stat label="Ticket promedio" value={st.salesCount ? formatMXN(Math.round(st.netSalesCents / st.salesCount)) : 'n/c'} hint="Venta neta ÷ número de ventas" />
        {costs && <Stat label="Utilidad bruta" value={formatMXN(st.grossProfitCents)} tone={st.grossProfitCents < 0 ? 'bad' : undefined} hint="Venta neta − costo directo" />}
        {costs && <Stat label="Margen bruto" value={formatPct(st.grossMarginPct)} hint="Utilidad ÷ venta neta" />}
      </div>
      {costs && st.estimatedCostLines > 0 && <div className="banner info">{st.estimatedCostLines} partida(s) del periodo usan un costo estimado (no observado): la utilidad y el margen son aproximados.</div>}

      <div className="stack">
        <div className="row wrap">
          <div className="grow" style={{ minWidth: 220 }}><div className="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" /></svg><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por folio o cliente" aria-label="Buscar ventas" /></div></div>
          <button className="btn" onClick={exportCsv} disabled={!rows.length}>Exportar CSV</button>
        </div>
        <Chips value={pay} onChange={setPay} options={[['todas', 'Todas'], ['pendientes', 'Con saldo'], ['pagada', 'Pagadas'], ['cancelada', 'Canceladas']]} />
        <Chips value={kind} onChange={setKind} options={[['todos', 'Todos los tipos'], ['orden', 'De orden'], ['mostrador', 'Mostrador']]} />
        <DataTable
          rows={rows} rowKey={(s) => s.id} onRow={(s) => nav(`/ventas/${s.id}`)}
          empty={<Empty title={data.sales.length === 0 ? 'Aún no hay ventas' : 'Sin ventas con estos filtros'} text={data.sales.length === 0 ? 'Las ventas se generan al entregar una orden de trabajo o desde el mostrador.' : 'Cambia el periodo o los filtros.'} action={canSell && data.sales.length === 0 ? <button className="btn primary" onClick={() => open({ k: 'sale' })}>Nueva venta de mostrador</button> : undefined} />}
          columns={[
            { key: 'folio', label: 'Folio', primary: true, render: (s) => s.folio },
            { key: 'date', label: 'Fecha', render: (s) => fmtDate(s.date) },
            { key: 'cust', label: 'Cliente', render: (s) => s.customerName },
            { key: 'kind', label: 'Tipo', hideMobile: true, render: (s) => (s.kind === 'orden' ? 'Orden' : 'Mostrador') },
            { key: 'total', label: 'Total', align: 'r', render: (s) => formatMXN(s.totalCents) },
            { key: 'paid', label: 'Cobrado', align: 'r', render: (s) => (s.status === 'cancelada' ? '—' : formatMXN(salePaid(s, data.ledger))) },
            { key: 'bal', label: 'Saldo', align: 'r', render: (s) => (s.status === 'cancelada' ? '—' : formatMXN(Math.max(0, saleBalance(s, data.ledger)))) },
            { key: 'st', label: 'Pago', render: (s) => <PayBadge status={status(s)} /> },
          ]}
          footer={<tr><td colSpan={4}>Total de {rows.filter((s) => s.status !== 'cancelada').length} venta(s) vigentes</td><td className="r">{formatMXN(listTotals.total)}</td><td className="r">{formatMXN(listTotals.paid)}</td><td className="r">{formatMXN(listTotals.bal)}</td><td /></tr>}
        />
      </div>
    </div>
  )
}
