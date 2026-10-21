import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { inRange } from '../domain/dates'
import { expenseBalance, expensePaid, expenseTotal, LEDGER_LABEL } from '../domain/finance'
import { formatMXN } from '../domain/money'
import type { Expense, RecurringExpense } from '../domain/types'
import { cancelExpense, forecastRecurring, generateRecurring, saveRecurring } from '../services/expenses'
import { Donut, toSlices } from '../ui/charts'
import { fmtDate, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { PeriodPicker } from '../ui/money/common'
import { initPer, methodName, rangeOf, rangeText, type PerState } from '../ui/money/helpers'
import { useCtx } from '../ui/session'
import { Badge, Chips, DataTable, Empty, Seg, Sheet, Stat, useBusy, useUi } from '../ui/ui'

type Tab = 'gastos' | 'recurrentes'
type StFilter = 'todos' | 'pendiente' | 'parcial' | 'pagado' | 'cancelado'
type St = Exclude<StFilter, 'todos'>
const ST_LABEL: Record<St, string> = { pendiente: 'Pendiente', parcial: 'Pago parcial', pagado: 'Pagado', cancelado: 'Cancelado' }
const ST_TONE: Record<St, '' | 'ok' | 'warn' | 'bad' | 'info'> = { pendiente: 'warn', parcial: 'info', pagado: 'ok', cancelado: '' }

export function Gastos({ data }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('t') === 'recurrentes' ? 'recurrentes' : 'gastos'
  const setTab = (t: Tab) => setSp({ t }, { replace: true })
  const canEdit = data.can('gastos.editar')
  const open = useOpen()
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Gastos</h1><div className="sub">Lo que el taller gasta para operar. Registrar un gasto no es pagarlo: el pago es otro movimiento.</div></div>
        {canEdit && <button className="btn primary" onClick={() => open({ k: 'expense' })}>Registrar gasto</button>}
      </div>
      <Seg<Tab> value={tab} onChange={setTab} label="Secciones de gastos" options={[['gastos', 'Gastos'], ['recurrentes', 'Recurrentes']]} />
      {tab === 'gastos' ? <GastosTab data={data} /> : <Recurrentes data={data} />}
    </div>
  )
}

function GastosTab({ data }: { data: Data }) {
  const open = useOpen()
  const [per, setPer] = useState<PerState>(() => initPer('mes', data.today))
  const [cat, setCat] = useState('')
  const [st, setSt] = useState<StFilter>('todos')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const range = useMemo(() => rangeOf(per, data.today), [per, data.today])
  const catName = (id: string) => data.settings.expenseCategories.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const supName = (id?: string) => (id ? data.supMap.get(id)?.name ?? '—' : '—')
  const statusOf = (e: Expense): St => (e.cancelled ? 'cancelado' : expenseBalance(e, data.ledger) <= 0 ? 'pagado' : expensePaid(e, data.ledger) > 0 ? 'parcial' : 'pendiente')

  const period = useMemo(() => data.expenses.filter((e) => inRange(e.date, range)), [data.expenses, range])
  const live = period.filter((e) => !e.cancelled)
  const accrued = live.reduce((a, e) => a + expenseTotal(e), 0), accruedNet = live.reduce((a, e) => a + e.amountCents, 0)
  const paid = live.reduce((a, e) => a + expensePaid(e, data.ledger), 0)
  const pending = live.reduce((a, e) => a + expenseBalance(e, data.ledger), 0)
  const slices = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of live) m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amountCents)
    return toSlices([...m].map(([k, cents]) => ({ key: k, label: data.settings.expenseCategories.find((c) => c.id === k)?.name ?? 'Sin categoría', cents })))
  }, [live, data.settings.expenseCategories])
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    return period.filter((e) => {
      if (cat && e.categoryId !== cat) return false
      const s = e.cancelled ? 'cancelado' : expenseBalance(e, data.ledger) <= 0 ? 'pagado' : expensePaid(e, data.ledger) > 0 ? 'parcial' : 'pendiente'
      if (st !== 'todos' && s !== st) return false
      if (t && !(`${e.concept} ${catName(e.categoryId)} ${supName(e.supplierId)}`.toLowerCase().includes(t))) return false
      return true
    }).sort((a, b) => b.date.localeCompare(a.date))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, cat, st, q, data.ledger, data.supMap, data.settings.expenseCategories])
  const selected = sel ? data.expenses.find((e) => e.id === sel) : undefined

  return (
    <div className="stack-lg">
      <PeriodPicker value={per} onChange={setPer} today={data.today} all />
      <div className="grid">
        <Stat label="Gastos registrados (devengado)" value={formatMXN(accrued)} hint={`Incluye IVA. Reconocido en resultados: ${formatMXN(accruedNet)} sin IVA`} />
        <Stat label="Pagado" value={formatMXN(paid)} hint="De los gastos de este periodo" />
        <Stat label="Pendiente de pago" value={formatMXN(pending)} tone={pending > 0 ? 'bad' : undefined} hint="Obligaciones abiertas" to="/cobranza?t=pagar" />
      </div>
      {slices.length > 0 && (
        <section className="fcard" aria-label="Gastos por categoría">
          <h2>Por categoría <span className="small muted">(sin IVA · {rangeText(per, range)})</span></h2>
          <Donut slices={slices} centerLabel="gastos" title="Gastos por categoría" />
        </section>
      )}
      <div className="stack">
        <div className="row wrap">
          <div className="grow" style={{ minWidth: 200 }}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar concepto, categoría o proveedor" aria-label="Buscar gastos" /></div>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría" style={{ width: 'auto', minWidth: 200 }}><option value="">Todas las categorías</option>{data.settings.expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </div>
        <Chips value={st} onChange={setSt} options={[['todos', 'Todos'], ['pendiente', 'Pendientes'], ['parcial', 'Pago parcial'], ['pagado', 'Pagados'], ['cancelado', 'Cancelados']]} />
        <DataTable
          rows={rows} rowKey={(e) => e.id} onRow={(e) => setSel(e.id)}
          empty={<Empty title={data.expenses.length === 0 ? 'Aún no hay gastos' : 'Sin gastos con estos filtros'} text={data.expenses.length === 0 ? 'Registra la renta, la luz, la nómina y otros gastos para conocer la utilidad real del taller.' : 'Cambia el periodo o los filtros.'} action={data.can('gastos.editar') && data.expenses.length === 0 ? <button className="btn primary" onClick={() => open({ k: 'expense' })}>Registrar el primer gasto</button> : undefined} />}
          columns={[
            { key: 'c', label: 'Concepto', primary: true, render: (e) => <span>{e.concept}{e.recurringId && <span className="small muted"> · recurrente</span>}</span> },
            { key: 'd', label: 'Fecha', render: (e) => fmtDate(e.date) },
            { key: 'k', label: 'Categoría', render: (e) => catName(e.categoryId) },
            { key: 's', label: 'Proveedor', hideMobile: true, render: (e) => supName(e.supplierId) },
            { key: 'a', label: 'Importe', align: 'r', render: (e) => formatMXN(e.amountCents) },
            { key: 'i', label: 'IVA', align: 'r', hideMobile: true, render: (e) => formatMXN(e.taxCents) },
            { key: 'p', label: 'Pagado', align: 'r', render: (e) => formatMXN(expensePaid(e, data.ledger)) },
            { key: 'b', label: 'Saldo', align: 'r', render: (e) => formatMXN(expenseBalance(e, data.ledger)) },
            { key: 'st', label: 'Estado', render: (e) => { const s = statusOf(e); const late = !e.cancelled && expenseBalance(e, data.ledger) > 0 && (e.dueDate ?? e.date) < data.today; return <span className="row" style={{ gap: 4 }}><Badge tone={ST_TONE[s]}>{ST_LABEL[s]}</Badge>{late && <Badge tone="bad">Vencido</Badge>}</span> } },
          ]}
          footer={<tr><td colSpan={4}>{rows.filter((e) => !e.cancelled).length} gasto(s) vigentes</td><td className="r">{formatMXN(rows.filter((e) => !e.cancelled).reduce((a, e) => a + e.amountCents, 0))}</td><td className="r">{formatMXN(rows.filter((e) => !e.cancelled).reduce((a, e) => a + e.taxCents, 0))}</td><td className="r">{formatMXN(rows.filter((e) => !e.cancelled).reduce((a, e) => a + expensePaid(e, data.ledger), 0))}</td><td className="r">{formatMXN(rows.filter((e) => !e.cancelled).reduce((a, e) => a + expenseBalance(e, data.ledger), 0))}</td><td /></tr>}
        />
      </div>
      <div className="card flat stack-sm small">
        <b>Cómo leer estas cifras</b>
        <span><b>Registrado (devengado):</b> el gasto ya ocurrió, aunque no se haya pagado.</span>
        <span><b>Pagado:</b> dinero que ya salió de caja o banco.</span>
        <span><b>Obligaciones pendientes:</b> gastos registrados con saldo por pagar.</span>
        <span><b>Estimaciones:</b> la previsión de gastos recurrentes (pestaña Recurrentes) no es gasto real hasta que se genera.</span>
      </div>
      {selected && <ExpenseSheet data={data} e={selected} catName={catName(selected.categoryId)} supName={supName(selected.supplierId)} onClose={() => setSel(null)} />}
    </div>
  )
}

function ExpenseSheet({ data, e, catName, supName, onClose }: { data: Data; e: Expense; catName: string; supName: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const paid = expensePaid(e, data.ledger), bal = expenseBalance(e, data.ledger)
  const pays = data.ledger.filter((l) => l.expenseId === e.id).sort((a, b) => a.at.localeCompare(b.at))
  const edit = data.can('gastos.editar')
  const cancel = () => guard(async () => {
    const why = await ui.askReason('Cancelar gasto', 'Motivo de la cancelación', 'Cancelar gasto')
    if (!why) return
    const r = await ui.run(() => cancelExpense(ctx, e.id, why).then(() => true), 'Gasto cancelado')
    if (r) onClose()
  })
  return (
    <Sheet title={e.concept} onClose={onClose} footer={
      <>
        {edit && !e.cancelled && <button className="btn danger" disabled={busy} onClick={cancel}>Cancelar gasto</button>}
        <span className="grow" />
        {edit && !e.cancelled && <button className="btn" onClick={() => { onClose(); open({ k: 'expense', v: e }) }}>Editar</button>}
        {edit && !e.cancelled && bal > 0 && <button className="btn primary" onClick={() => { onClose(); open({ k: 'expensepay', expenseId: e.id }) }}>Pagar</button>}
      </>
    }>
      <div className="stack">
        {e.cancelled && <div className="banner bad">Gasto cancelado. Ya no cuenta en resultados ni en obligaciones.</div>}
        <div className="mny-sum">
          <div className="mny-kv"><span>Categoría</span><span>{catName}</span></div>
          <div className="mny-kv"><span>Proveedor</span><span>{supName}</span></div>
          <div className="mny-kv"><span>Fecha</span><span>{fmtDate(e.date)}</span></div>
          <div className="mny-kv"><span>Vence</span><span>{e.dueDate ? fmtDate(e.dueDate) : 'Sin vencimiento (vencido desde su fecha)'}</span></div>
          {e.costCenter && <div className="mny-kv"><span>Centro de costo</span><span>{e.costCenter}</span></div>}
          <div className="mny-kv"><span>Importe sin IVA</span><span className="num">{formatMXN(e.amountCents)}</span></div>
          <div className="mny-kv"><span>IVA</span><span className="num">{formatMXN(e.taxCents)}</span></div>
          <div className="mny-kv total"><span>Total</span><span className="num">{formatMXN(expenseTotal(e))}</span></div>
          <div className="mny-kv"><span>Pagado</span><span className="num">{formatMXN(paid)}</span></div>
          <div className="mny-kv"><span>Saldo</span><b className="num">{formatMXN(bal)}</b></div>
        </div>
        {e.notes && <div className="small muted">Notas: {e.notes}</div>}
        <h3>Pagos</h3>
        {pays.length === 0 ? <div className="small muted">Sin pagos registrados.</div> : (
          <div className="stack-sm">{pays.map((l) => <div key={l.id} className="row between small"><span>{fmtDate(l.date)} · {methodName(data, l.methodId)}{l.reference ? ` · ref. ${l.reference}` : ''} · {LEDGER_LABEL[l.kind]}</span><b className="num">{l.direction === 'out' ? '' : '− '}{formatMXN(l.amountCents)}</b></div>)}</div>
        )}
        {paid > 0 && !e.cancelled && <div className="small muted">Un gasto con pagos no se puede cancelar: el movimiento de dinero se conserva.</div>}
      </div>
    </Sheet>
  )
}

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

function Recurrentes({ data }: { data: Data }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const edit = data.can('gastos.editar')
  const forecast = useMemo(() => forecastRecurring(data.recurring, data.today, 3), [data.recurring, data.today])
  const catName = (id: string) => data.settings.expenseCategories.find((c) => c.id === id)?.name ?? 'Sin categoría'
  const gen = () => guard(async () => {
    const n = await ui.run(() => generateRecurring(ctx))
    if (n !== undefined) ui.toast(n > 0 ? `Se generaron ${n} gasto(s) vencido(s). Revísalos en la lista de gastos.` : 'No había gastos vencidos por generar: todo está al día.')
  })
  const toggle = (r: RecurringExpense) => guard(async () => { await ui.run(() => saveRecurring(ctx, { ...r, active: !r.active }), r.active ? 'Plantilla pausada' : 'Plantilla activada') })
  const sorted = [...data.recurring].sort((a, b) => Number(b.active) - Number(a.active) || a.concept.localeCompare(b.concept))
  return (
    <div className="stack-lg">
      <div className="banner info">Las plantillas no son gastos. «Generar vencidos» crea los gastos reales que ya tocan (cada periodo se crea una sola vez, aunque lo repitas). Lo demás es solo una estimación.</div>
      <div className="row wrap">
        {edit && <button className="btn primary" onClick={() => open({ k: 'recurring' })}>Nueva plantilla</button>}
        {edit && <button className="btn" disabled={busy || data.recurring.length === 0} onClick={gen}>Generar vencidos</button>}
      </div>
      {sorted.length === 0 ? <Empty title="Sin gastos recurrentes" text="Crea plantillas para la renta, internet, nómina u otros pagos periódicos y genera sus gastos con un clic." action={edit ? <button className="btn primary" onClick={() => open({ k: 'recurring' })}>Nueva plantilla</button> : undefined} /> : (
        <div className="stack">{sorted.map((r) => (
          <div key={r.id} className="card" style={r.active ? undefined : { opacity: 0.75 }}>
            <div className="row between wrap">
              <div>
                <b>{r.concept}</b> {r.active ? <Badge tone="ok">Activa</Badge> : <Badge>Pausada</Badge>}
                <div className="small muted">{catName(r.categoryId)} · {r.frequency === 'mensual' ? `mensual, día ${r.dayOfMonth}` : 'semanal'} · desde {fmtDate(r.startDate)}{r.supplierId ? ` · ${data.supMap.get(r.supplierId)?.name ?? ''}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}><b className="num">{formatMXN(r.amountCents + r.taxCents)}</b><div className="small muted">{formatMXN(r.amountCents)} + IVA {formatMXN(r.taxCents)}</div></div>
            </div>
            {edit && <div className="mny-actions" style={{ marginTop: 8 }}><button className="btn small" onClick={() => open({ k: 'recurring', v: r })}>Editar</button><button className="btn small" disabled={busy} onClick={() => toggle(r)}>{r.active ? 'Pausar' : 'Activar'}</button></div>}
          </div>
        ))}</div>
      )}
      <section className="stack" aria-label="Previsión">
        <h2>Previsión de los próximos 3 meses</h2>
        <div className="banner">Estimación, no es gasto real: es lo que generarán las plantillas activas. Se vuelve gasto cuando llega su fecha y generas los vencidos.</div>
        <div className="tablewrap"><table className="table">
          <thead><tr><th>Mes</th><th className="r">Estimado (con IVA)</th></tr></thead>
          <tbody>{forecast.map((f) => <tr key={f.month}><td style={{ textTransform: 'capitalize' }}>{monthLabel(f.month)}</td><td className="r">{formatMXN(f.cents)}</td></tr>)}</tbody>
          <tfoot><tr><td>Total estimado</td><td className="r">{formatMXN(forecast.reduce((a, f) => a + f.cents, 0))}</td></tr></tfoot>
        </table></div>
      </section>
    </div>
  )
}
