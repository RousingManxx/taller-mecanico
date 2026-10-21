import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek } from '../domain/dates'
import type { Appointment, AppointmentStatus } from '../domain/types'
import { setAppointmentStatus } from '../services/people'
import { APPT_LABEL, APPT_PENDING, APPT_TONE, apptEnd, apptFlags, cap, dayOf, fmtLong, noon, timeOf } from '../ui/crm/lib'
import { useNow } from '../ui/crm/hooks'
import { Info } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { plateOf, type Data } from '../ui/data'
import { useCtx } from '../ui/session'
import { Badge, Empty, Icon, Seg, Sheet, useBusy, useMedia, useUi } from '../ui/ui'
import '../ui/css/crm.css'

type View = 'dia' | 'semana' | 'mes' | 'proximos'
const VIEWS: [View, string][] = [['dia', 'Día'], ['semana', 'Semana'], ['mes', 'Mes'], ['proximos', 'Próximos']]
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const shortDate = (s: string) => noon(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })

export function Agenda({ data }: { data: Data }) {
  const open = useOpen()
  const wide = useMedia('(min-width: 900px)')
  const [view, setView] = useState<View>(() => (matchMedia('(min-width: 900px)').matches ? 'semana' : 'dia'))
  const [cursor, setCursor] = useState(data.today)
  const [mech, setMech] = useState('')
  const [selId, setSelId] = useState<string | null>(null)
  const tz = data.settings.timezone
  const mechanics = data.employees.filter((e) => e.isMechanic)

  const appts = useMemo(() => data.appointments.filter((a) => !mech || a.mechanicId === mech).sort((a, b) => a.start.localeCompare(b.start)), [data.appointments, mech])
  const byDay = useMemo(() => { const m = new Map<string, Appointment[]>(); for (const a of appts) { const d = dayOf(a.start, tz); m.set(d, [...(m.get(d) ?? []), a]) } return m }, [appts, tz])
  const sel = selId ? data.appointments.find((a) => a.id === selId) : undefined

  const step = (dir: 1 | -1) => setCursor((c) => (view === 'dia' ? addDays(c, dir) : view === 'semana' ? addDays(c, 7 * dir) : addMonths(startOfMonth(c), dir)))
  const weekStart = startOfWeek(cursor)
  const title = view === 'dia' ? cap(fmtLong(cursor)) : view === 'semana' ? `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6))} ${noon(addDays(weekStart, 6)).getFullYear()}` : view === 'mes' ? cap(noon(cursor).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })) : 'Próximos servicios'
  const canEdit = data.can('agenda.editar')
  const goDay = (d: string) => { setCursor(d); setView('dia') }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Agenda</h1><div className="sub">Citas del taller por día, semana o mes</div></div>
        {canEdit && <button className="btn primary" onClick={() => open({ k: 'appointment', start: view === 'proximos' ? data.today : cursor })}>Agendar cita</button>}
      </div>
      <div className="stack">
        <Seg<View> value={view} options={VIEWS} onChange={setView} label="Vista de la agenda" />
        <div className="crm-agenda-bar">
          {view !== 'proximos' && (
            <div className="row" role="group" aria-label="Navegación de fechas">
              <button className="btn small" onClick={() => step(-1)} aria-label="Periodo anterior">‹ Anterior</button>
              <button className="btn small" onClick={() => setCursor(data.today)}>Hoy</button>
              <button className="btn small" onClick={() => step(1)} aria-label="Periodo siguiente">Siguiente ›</button>
            </div>
          )}
          <h2 className="crm-agenda-title" aria-live="polite">{title}</h2>
          <label className="f crm-mech"><span className="sr-only">Filtrar por mecánico</span>
            <select value={mech} onChange={(e) => setMech(e.target.value)} aria-label="Filtrar por mecánico"><option value="">Todos los mecánicos</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
          </label>
        </div>
        <div className="small muted">Torque no envía recordatorios por su cuenta: los avisos por WhatsApp, SMS o correo requieren una integración externa configurada.</div>
      </div>

      {view === 'dia' && <DayView data={data} day={cursor} list={byDay.get(cursor) ?? []} onPick={setSelId} />}
      {view === 'semana' && <WeekView data={data} start={weekStart} byDay={byDay} wide={wide} onPick={setSelId} goDay={goDay} />}
      {view === 'mes' && <MonthView data={data} cursor={cursor} byDay={byDay} wide={wide} onPick={setSelId} goDay={goDay} />}
      {view === 'proximos' && <UpcomingView data={data} appts={appts} onPick={setSelId} />}
      {sel && <Detail data={data} a={sel} onClose={() => setSelId(null)} />}
    </div>
  )
}

/* ───────── Tarjeta de cita ───────── */
function ApptCard({ data, a, onPick, compact }: { data: Data; a: Appointment; onPick: (id: string) => void; compact?: boolean }) {
  const tz = data.settings.timezone, now = useNow()
  const f = apptFlags(a, data.today, tz, now)
  const cust = data.custMap.get(a.customerId)?.name ?? 'Cliente'
  const time = `${timeOf(a.start, tz)}–${timeOf(new Date(apptEnd(a)).toISOString(), tz)}`
  const veh = a.vehicleId ? plateOf(data.vehMap.get(a.vehicleId)) : ''
  const mech = a.mechanicId ? data.empMap.get(a.mechanicId)?.name : undefined
  const dim = a.status === 'cancelada' || a.status === 'no_asistio'
  const cls = `crm-appt ${f.overdue ? 'overdue' : f.today ? 'today' : ''} ${dim ? 'dim' : ''} ${compact ? 'compact' : ''}`
  return (
    <button type="button" className={cls} onClick={() => onPick(a.id)} aria-label={`Cita ${time}, ${cust}. ${a.reason}. ${APPT_LABEL[a.status]}${f.overdue ? '. Atrasada' : f.today ? '. Hoy' : ''}`}>
      <div className="row between wrap" style={{ gap: 4 }}><b className="num">{time}</b><span className="row" style={{ gap: 4 }}>{f.overdue && <Badge tone="bad">Atrasada</Badge>}{f.today && !f.overdue && <Badge tone="info">Hoy</Badge>}</span></div>
      <div className="crm-appt-name">{cust}</div>
      {!compact && (<>
        {veh && <div className="small muted">{veh}</div>}
        <div className="small">{a.reason}</div>
        {mech && <div className="small muted">Mecánico: {mech}</div>}
      </>)}
      <div><Badge tone={APPT_TONE[a.status]}>{APPT_LABEL[a.status]}</Badge></div>
    </button>
  )
}

function DayView({ data, day, list, onPick }: { data: Data; day: string; list: Appointment[]; onPick: (id: string) => void }) {
  const open = useOpen()
  if (!list.length) return <Empty title={day === data.today ? 'Sin citas para hoy' : 'Sin citas este día'} text="No hay citas agendadas en esta fecha." action={data.can('agenda.editar') ? <button className="btn primary" onClick={() => open({ k: 'appointment', start: day })}>Agendar cita</button> : undefined} />
  return <div className="crm-daylist" aria-label={`Citas del ${fmtLong(day)}`}>{list.map((a) => <ApptCard key={a.id} data={data} a={a} onPick={onPick} />)}</div>
}

function WeekView({ data, start, byDay, wide, onPick, goDay }: { data: Data; start: string; byDay: Map<string, Appointment[]>; wide: boolean; onPick: (id: string) => void; goDay: (d: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="crm-week" aria-label="Citas de la semana">
      {days.map((d, i) => {
        const list = byDay.get(d) ?? []
        return (
          <section key={d} className={`crm-daycol ${d === data.today ? 'today' : ''}`} aria-label={fmtLong(d)}>
            <h3><button type="button" className="crm-dayhead" onClick={() => goDay(d)} aria-label={`Ver el día ${fmtLong(d)}`}><span>{WEEKDAYS[i]}</span> <b>{noon(d).getDate()}</b>{d === data.today && <Badge tone="info">Hoy</Badge>}</button><span className="small muted">{list.length ? `${list.length} cita${list.length === 1 ? '' : 's'}` : 'Sin citas'}</span></h3>
            <div className="stack-sm">{list.map((a) => <ApptCard key={a.id} data={data} a={a} onPick={onPick} compact={wide} />)}</div>
          </section>
        )
      })}
    </div>
  )
}

function MonthView({ data, cursor, byDay, wide, onPick, goDay }: { data: Data; cursor: string; byDay: Map<string, Appointment[]>; wide: boolean; onPick: (id: string) => void; goDay: (d: string) => void }) {
  const now = useNow()
  const first = startOfWeek(startOfMonth(cursor)), last = endOfMonth(cursor)
  const days: string[] = []
  for (let d = first; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d)
  const month = cursor.slice(0, 7)
  return (
    <div className="crm-month" role="grid" aria-label="Citas del mes">
      {WEEKDAYS.map((w) => <div key={w} className="crm-mhead" role="columnheader">{w}</div>)}
      {days.map((d) => {
        const list = byDay.get(d) ?? []
        const other = d.slice(0, 7) !== month
        return (
          <div key={d} role="gridcell" className={`crm-cell ${other ? 'other' : ''} ${d === data.today ? 'today' : ''}`}>
            <button type="button" className="crm-celldate" onClick={() => goDay(d)} aria-label={`${fmtLong(d)}: ${list.length} cita${list.length === 1 ? '' : 's'}. Abrir el día`}><span>{noon(d).getDate()}</span>{!wide && list.length > 0 && <span className="crm-dot" aria-hidden="true">{list.length}</span>}</button>
            {wide && list.slice(0, 3).map((a) => { const f = apptFlags(a, data.today, data.settings.timezone, now); return <button key={a.id} type="button" className={`crm-pill ${f.overdue ? 'overdue' : ''} ${a.status === 'cancelada' || a.status === 'no_asistio' ? 'dim' : ''}`} onClick={() => onPick(a.id)} title={`${APPT_LABEL[a.status]}: ${a.reason}`}>{timeOf(a.start, data.settings.timezone)} {data.custMap.get(a.customerId)?.name ?? ''}</button> })}
            {wide && list.length > 3 && <button type="button" className="crm-more" onClick={() => goDay(d)}>+{list.length - 3} más</button>}
          </div>
        )
      })}
    </div>
  )
}

function UpcomingView({ data, appts, onPick }: { data: Data; appts: Appointment[]; onPick: (id: string) => void }) {
  const tz = data.settings.timezone, now = useNow()
  const pending = appts.filter((a) => APPT_PENDING.includes(a.status))
  const overdue = pending.filter((a) => apptEnd(a) < now)
  const upcoming = pending.filter((a) => apptEnd(a) >= now)
  const days = [...new Set(upcoming.map((a) => dayOf(a.start, tz)))]
  if (!pending.length) return <Empty title="Sin servicios próximos" text="No hay citas por atender. Las citas confirmadas, solicitadas o en recepción aparecerán aquí." />
  return (
    <div className="stack-lg">
      {overdue.length > 0 && (
        <section className="stack" aria-label="Citas atrasadas">
          <div className="banner bad" role="status"><b>{overdue.length} cita{overdue.length === 1 ? '' : 's'} atrasada{overdue.length === 1 ? '' : 's'}</b>: su hora ya pasó y siguen sin atenderse. Confirma si asistieron, conviértelas en orden o márcalas como «No asistió».</div>
          <div className="crm-daylist">{overdue.map((a) => <ApptCard key={a.id} data={data} a={a} onPick={onPick} />)}</div>
        </section>
      )}
      {days.map((d) => (
        <section key={d} className="stack" aria-label={fmtLong(d)}>
          <h3>{cap(fmtLong(d))}{d === data.today && <> <Badge tone="info">Hoy</Badge></>}</h3>
          <div className="crm-daylist">{upcoming.filter((a) => dayOf(a.start, tz) === d).map((a) => <ApptCard key={a.id} data={data} a={a} onPick={onPick} />)}</div>
        </section>
      ))}
    </div>
  )
}

/* ───────── Detalle y acciones ───────── */
function Detail({ data, a, onClose }: { data: Data; a: Appointment; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), open = useOpen()
  const [busy, guard] = useBusy()
  const tz = data.settings.timezone
  const cust = data.custMap.get(a.customerId), veh = a.vehicleId ? data.vehMap.get(a.vehicleId) : undefined
  const f = apptFlags(a, data.today, tz, useNow())
  const canEdit = data.can('agenda.editar')
  const pending = APPT_PENDING.includes(a.status)
  const setStatus = (to: AppointmentStatus, msg: string, confirm?: string) => guard(async () => {
    if (confirm && !(await ui.confirm(confirm, 'Sí, continuar', true))) return
    const r = await ui.run(() => setAppointmentStatus(ctx, a.id, to).then(() => true), msg)
    if (r && (to === 'cancelada' || to === 'no_asistio')) onClose()
  })
  const convert = () => { onClose(); open({ k: 'order', customerId: a.customerId, vehicleId: a.vehicleId, appointmentId: a.id }) }
  const edit = () => { onClose(); open({ k: 'appointment', v: a }) }
  const end = new Date(apptEnd(a)).toISOString()
  return (
    <Sheet title={`Cita de ${cust?.name ?? 'cliente'}`} onClose={onClose}
      footer={<>{canEdit && <button className="btn" onClick={edit}>Editar</button>}<button className="btn" onClick={onClose}>Cerrar</button></>}>
      <div className="stack">
        {f.overdue && <div className="banner bad" role="status">Esta cita está atrasada: su hora ya pasó y sigue sin atenderse. Registra qué ocurrió con los botones de abajo.</div>}
        {f.today && !f.overdue && <div className="banner info" role="status">Esta cita es para hoy.</div>}
        <div className="row wrap"><Badge tone={APPT_TONE[a.status]}>{APPT_LABEL[a.status]}</Badge></div>
        <dl className="crm-infos">
          <Info label="Fecha y hora">{cap(fmtLong(dayOf(a.start, tz)))}, {timeOf(a.start, tz)} a {timeOf(end, tz)} ({a.durationMin} min)</Info>
          <Info label="Cliente">{cust ? <Link to={`/clientes/${cust.id}`} onClick={onClose}>{cust.name}</Link> : '—'}{cust?.phone ? ` · ${cust.phone}` : ''}</Info>
          <Info label="Vehículo">{veh ? <Link to={`/vehiculos/${veh.id}`} onClick={onClose}>{plateOf(veh)}</Link> : 'Sin vehículo especificado'}</Info>
          <Info label="Motivo">{a.reason}</Info>
          <Info label="Servicio solicitado">{a.serviceId ? data.svcMap.get(a.serviceId)?.name ?? '—' : '—'}</Info>
          <Info label="Mecánico asignado">{a.mechanicId ? data.empMap.get(a.mechanicId)?.name ?? '—' : 'Sin asignar'}</Info>
          <Info label="Notas">{a.notes || '—'}</Info>
          {a.workOrderId && <Info label="Orden de trabajo"><Link to={`/ordenes/${a.workOrderId}`} onClick={onClose}>{data.orderMap.get(a.workOrderId)?.folio ?? 'Ver orden'}</Link></Info>}
        </dl>
        {canEdit && (
          <div className="stack-sm" role="group" aria-label="Acciones de la cita">
            {pending && data.can('ordenes.crear') && <button className="btn primary block" disabled={busy} onClick={convert}>Convertir en orden de trabajo</button>}
            <div className="row wrap">
              {a.status === 'solicitada' && <button className="btn" disabled={busy} onClick={() => setStatus('confirmada', 'Cita confirmada')}>Confirmar</button>}
              {(a.status === 'solicitada' || a.status === 'confirmada') && <button className="btn" disabled={busy} onClick={() => setStatus('en_recepcion', 'Cita en recepción')}>Marcar en recepción</button>}
              {(pending || a.status === 'convertida') && <button className="btn" disabled={busy} onClick={() => setStatus('completada', 'Cita completada')}>Marcar completada</button>}
              {pending && <button className="btn" disabled={busy} onClick={() => setStatus('no_asistio', 'Marcada como «No asistió»', 'El cliente no se presentó a esta cita. ¿Marcarla como «No asistió»? Se libera el horario del mecánico.')}>No asistió</button>}
              {pending && <button className="btn danger" disabled={busy} onClick={() => setStatus('cancelada', 'Cita cancelada', '¿Cancelar esta cita? Se libera el horario del mecánico; la cita queda en el historial.')}>Cancelar cita</button>}
            </div>
            {!pending && a.status !== 'convertida' && <p className="small muted">Para reabrir esta cita usa «Editar» y cambia su estado.</p>}
          </div>
        )}
        <div className="small muted"><Icon n="info" size={14} /> Convertir en orden abre el formulario de orden con el cliente y el vehículo ya cargados; la cita pasa a «Convertida en orden» cuando guardes la orden.</div>
      </div>
    </Sheet>
  )
}
