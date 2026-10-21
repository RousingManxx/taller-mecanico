import '../css/money.css'
import { useMemo, useState } from 'react'
import { PAY_LABEL, type PayStatus } from '../../domain/finance'
import { PERIOD_LABEL } from '../../domain/dates'
import { formatMXN } from '../../domain/money'
import type { Customer } from '../../domain/types'
import { openSession } from '../../services/cash'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Badge, Field, MoneyInput, Seg, useBusy, useUi } from '../ui'
import { lastCounted, openSessionOf, PAY_TONE, type Per, type PerState } from './helpers'

export const PayBadge = ({ status }: { status: PayStatus }) => <Badge tone={PAY_TONE[status]}>{PAY_LABEL[status]}</Badge>

/** Formulario de apertura de caja (se usa en la hoja y dentro de otros formularios, sin perder lo capturado). */
export function OpenCashInline({ data, onDone }: { data: Data; onDone?: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [cents, setCents] = useState<number | undefined>(() => lastCounted(data))
  const go = () => guard(async () => {
    if (cents === undefined) { ui.toast('Indica el saldo inicial (puede ser 0).', true); return }
    const r = await ui.run(() => openSession(ctx, cents), 'Caja abierta')
    if (r) onDone?.()
  })
  return (
    <div className="stack">
      <Field label="Efectivo inicial en caja" hint={`Sugerido: ${formatMXN(lastCounted(data))}, el último efectivo contado al cerrar.`}><MoneyInput cents={cents} onChange={setCents} aria-label="Efectivo inicial" /></Field>
      <button className="btn primary" disabled={busy} onClick={go}>Abrir caja ahora</button>
    </div>
  )
}

/** Aviso cuando se necesita efectivo y no hay caja abierta; permite abrirla ahí mismo. */
export function CashGate({ data, needed }: { data: Data; needed: boolean }) {
  const [on, setOn] = useState(false)
  if (!needed || openSessionOf(data)) return null
  const can = data.can('caja.operar')
  return (
    <div className="banner bad stack" role="alert">
      <div><b>No hay una caja abierta.</b> Los movimientos en efectivo exigen una caja abierta para quedar registrados en el corte.{!can && ' Pide a alguien con permiso que la abra o usa un método bancario.'}</div>
      {can && !on && <button type="button" className="btn small" onClick={() => setOn(true)}>Abrir caja</button>}
      {can && on && <div style={{ color: 'var(--text)' }}><OpenCashInline data={data} /></div>}
    </div>
  )
}

/** Selector de forma de pago. */
export function MethodSelect({ data, value, onChange, label = 'Forma de pago' }: { data: Data; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>{data.settings.paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.account === 'caja' ? 'efectivo en caja' : 'banco'})</option>)}</select>
    </Field>
  )
}

export function PeriodPicker({ value, onChange, today, all }: { value: PerState; onChange: (v: PerState) => void; today: string; all?: boolean }) {
  const opts: [Per, string][] = [['hoy', PERIOD_LABEL.hoy], ['semana', PERIOD_LABEL.semana], ['mes', PERIOD_LABEL.mes], ['mes_anterior', PERIOD_LABEL.mes_anterior], ['custom', 'Rango']]
  if (all) opts.push(['todo', 'Todo'])
  return (
    <div className="stack">
      <Seg value={value.p} options={opts} onChange={(p) => onChange({ ...value, p })} label="Periodo" />
      {value.p === 'custom' && (
        <div className="grid2">
          <Field label="Desde"><input type="date" value={value.from} max={today > value.to ? today : value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} /></Field>
          <Field label="Hasta"><input type="date" value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} /></Field>
        </div>
      )}
    </div>
  )
}

export function CustomerPick({ customers, value, onChange }: { customers: Customer[]; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('')
  const sel = customers.find((c) => c.id === value)
  const res = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return customers.filter((c) => c.active && (c.name.toLowerCase().includes(t) || c.phone.includes(t))).slice(0, 6)
  }, [q, customers])
  if (sel) return <div className="row between card flat" style={{ padding: '8px 12px' }}><span><b>{sel.name}</b>{sel.phone && <span className="small muted"> · {sel.phone}</span>}</span><button type="button" className="btn small ghost" onClick={() => onChange('')}>Quitar</button></div>
  return (
    <div className="stack-sm">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente por nombre o teléfono (opcional)" aria-label="Buscar cliente" />
      {res.length > 0 && <div className="mny-results">{res.map((c) => <button type="button" key={c.id} className="mny-res" onClick={() => { onChange(c.id); setQ('') }}><b>{c.name}</b><span className="small muted">{c.phone || 'Sin teléfono'}</span></button>)}</div>}
      {q.trim() && res.length === 0 && <span className="small muted">Sin coincidencias. Puedes escribir un nombre libre abajo.</span>}
    </div>
  )
}
