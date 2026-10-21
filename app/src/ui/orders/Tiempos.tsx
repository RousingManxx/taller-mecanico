import { useState } from 'react'
import { formatMXN } from '../../domain/money'
import { STATUS_LABEL, timeSummary } from '../../domain/orders'
import type { TimeEntry, WorkOrder } from '../../domain/types'
import { startWork, stopWork } from '../../services/workorders'
import { useOpen } from '../create'
import { fmtDateTime, fmtHours, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, DataTable, Empty, Field, Stat, useBusy, useUi } from '../ui'
import { fmtClock, fmtDecHours, fmtSpan, isClosed, mechanicName, mechanicsOf, openWorkEntries, useNow, WORK_STATUSES } from './helpers'

export function TiemposTab({ data, order }: { data: Data; order: WorkOrder }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const ownOnly = !data.can('ordenes.ver_todas')
  const mechs = mechanicsOf(data).filter((m) => !ownOnly || m.id === ctx.user.employeeId)
  const [emp, setEmp] = useState(() => (ownOnly ? ctx.user.employeeId ?? '' : order.mechanicId ?? mechs[0]?.id ?? ''))
  const [item, setItem] = useState('')
  const running = openWorkEntries(order)
  const now = useNow(1000, running.length > 0)
  const nowIso = new Date(now).toISOString()
  const sum = timeSummary(order, nowIso)
  const costs = data.can('costos.ver')
  const canTime = data.can('ordenes.tiempos') && !isClosed(order)
  const services = order.items.filter((i) => i.type === 'servicio' && (i.status === 'autorizado' || i.status === 'ejecutado'))
  const stdMin = Math.round(order.items.filter((i) => i.type === 'servicio' && (i.status === 'autorizado' || i.status === 'ejecutado')).reduce((a, i) => a + i.stdHours * i.qty, 0) * 60)

  // Cronómetros abiertos del mismo mecánico en otras órdenes (iniciar aquí los pausa).
  const elsewhere = data.orders.filter((o) => o.id !== order.id).flatMap((o) => openWorkEntries(o).filter((t) => t.employeeId === emp).map((t) => ({ o, t })))
  const mineHere = running.some((t) => t.employeeId === emp)
  const statusOk = WORK_STATUSES.includes(order.status)
  const startBlock = !emp ? 'Elige al mecánico.' : mineHere ? 'Este mecánico ya tiene el cronómetro corriendo en esta orden.' : !statusOk ? `No se puede trabajar con la orden «${STATUS_LABEL[order.status]}»: autorízala o pásala a diagnóstico o reparación.` : ''
  const hadBefore = order.timeEntries.some((t) => t.kind === 'trabajo' && t.employeeId === emp)

  const start = () => guard(async () => { await ui.run(() => startWork(ctx, order.id, emp, item || undefined), 'Cronómetro iniciado') })
  const stop = (employeeId: string) => guard(async () => { await ui.run(() => stopWork(ctx, order.id, employeeId), 'Cronómetro detenido') })

  const entries = [...order.timeEntries].sort((a, b) => b.startAt.localeCompare(a.startAt))
  const mins = (t: TimeEntry) => (t.endAt ? t.minutes : Math.max(0, Math.round((now - new Date(t.startAt).getTime()) / 60000)))
  const cost = (t: TimeEntry) => (t.kind === 'espera' ? 0 : t.endAt ? t.costCents : Math.round((mins(t) / 60) * t.hourlyCostCents))
  const itemName = (id?: string) => (id ? order.items.find((i) => i.id === id)?.description ?? 'Partida eliminada' : 'Trabajo general')

  return (
    <div className="stack-lg">
      <div className="grid">
        <Stat label="Horas de mano de obra" value={fmtDecHours(sum.workMinutes)} hint={`${fmtHours(sum.workMinutes)} efectivas de trabajo`} />
        <Stat label="Tiempo de espera" value={fmtSpan(sum.waitMinutes)} hint="Esperando refacciones o autorización" />
        <Stat label="Transcurrido desde la recepción" value={fmtSpan(sum.elapsedMinutes)} hint="Tiempo de calendario, no son horas trabajadas" />
        {costs && <Stat label="Costo laboral" value={formatMXN(sum.laborCostCents)} hint="Minutos × costo por hora de cada mecánico" />}
      </div>
      {stdMin > 0 && <p className="small muted">Tiempo estándar de los servicios autorizados: {fmtDecHours(stdMin)}. Registrado hasta ahora: {fmtDecHours(sum.workMinutes)}{sum.workMinutes > stdMin ? ' (por encima del estándar)' : ''}.</p>}

      {running.length > 0 && (
        <section className="stack" aria-label="Cronómetros en curso">
          <h3>En curso</h3>
          {running.map((t) => (
            <div key={t.id} className="ord-run">
              <div><div className="small muted">{mechanicName(data, t.employeeId)} · {itemName(t.itemId)} · desde {fmtDateTime(t.startAt)}</div><div className="ord-timer" role="timer" aria-label={`Tiempo corrido ${fmtClock(now - new Date(t.startAt).getTime())}`}>{fmtClock(now - new Date(t.startAt).getTime())}</div></div>
              {data.can('ordenes.tiempos') && (!ownOnly || t.employeeId === ctx.user.employeeId) && <button className="btn" disabled={busy} onClick={() => stop(t.employeeId)}>Pausar / detener</button>}
            </div>
          ))}
        </section>
      )}

      {canTime && (
        <section className="card stack" aria-label="Iniciar cronómetro">
          <h3>Cronómetro de trabajo</h3>
          <div className="ord-form-grid">
            <Field label="Mecánico"><select value={emp} onChange={(e) => setEmp(e.target.value)} disabled={ownOnly}><option value="">Elige…</option>{mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Partida de servicio (opcional)"><select value={item} onChange={(e) => setItem(e.target.value)}><option value="">Trabajo general de la orden</option>{services.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}</select></Field>
          </div>
          {elsewhere.length > 0 && <div className="banner">Este mecánico tiene un cronómetro abierto en {elsewhere.map((x) => x.o.folio).join(', ')}: se pausará automáticamente al iniciar aquí.</div>}
          {startBlock && <div className="small muted" role="status">{startBlock}</div>}
          <div className="row wrap">
            <button className="btn primary" disabled={busy || !!startBlock} onClick={start}>{hadBefore ? 'Reanudar trabajo' : 'Iniciar trabajo'}</button>
            <button className="btn" onClick={() => open({ k: 'manualtime', orderId: order.id })}>Registrar tiempo manual</button>
          </div>
          <p className="small muted">Un mecánico solo puede tener un cronómetro corriendo: al iniciar uno se pausa cualquier otro suyo (aun en otra orden), así las horas nunca se cuentan dos veces. Al pasar la orden a «En pruebas» o «Lista para entrega» los cronómetros abiertos se detienen solos.</p>
        </section>
      )}

      {sum.byEmployee.length > 0 && (
        <section className="stack-sm" aria-label="Por mecánico">
          <h3>Por mecánico</h3>
          {sum.byEmployee.map((e) => <div key={e.employeeId} className="item" style={{ cursor: 'default' }}><div className="grow"><div className="ttl">{mechanicName(data, e.employeeId)}</div><div className="sub">{fmtHours(e.minutes)} · {fmtDecHours(e.minutes)}</div></div>{costs && <b className="num">{formatMXN(e.costCents)}</b>}</div>)}
        </section>
      )}

      <section className="stack" aria-label="Tramos de tiempo">
        <h3>Tramos registrados</h3>
        <DataTable rows={entries} rowKey={(t) => t.id} empty={<Empty title="Sin tiempos registrados" text={canTime ? 'Inicia el cronómetro o registra tiempo manual para calcular la mano de obra real de esta orden.' : 'Aún no hay tiempos en esta orden.'} />}
          columns={[
            { key: 'k', label: 'Tipo', primary: true, render: (t) => <span className="row wrap" style={{ gap: 6 }}><Badge tone={t.kind === 'espera' ? 'warn' : 'info'}>{t.kind === 'espera' ? 'Espera' : 'Trabajo'}</Badge>{!t.endAt && <Badge tone="ok">En curso</Badge>}</span> },
            { key: 'm', label: 'Mecánico', render: (t) => (t.kind === 'espera' ? <span className="muted">Orden en espera</span> : mechanicName(data, t.employeeId)) },
            { key: 'i', label: 'Partida', render: (t) => (t.kind === 'espera' ? '—' : itemName(t.itemId)) },
            { key: 's', label: 'Inicio', render: (t) => fmtDateTime(t.startAt) },
            { key: 'e', label: 'Fin', render: (t) => (t.endAt ? fmtDateTime(t.endAt) : 'En curso') },
            { key: 'd', label: 'Duración', align: 'r', render: (t) => fmtSpan(mins(t)) },
            ...(costs ? [{ key: 'c', label: 'Costo', align: 'r' as const, render: (t: TimeEntry) => (t.kind === 'espera' ? <span className="muted">—</span> : formatMXN(cost(t))) }] : []),
          ]} />
      </section>
    </div>
  )
}
