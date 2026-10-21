import { useMemo, useState } from 'react'
import type { Appointment, AppointmentStatus } from '../../domain/types'
import { saveAppointment } from '../../services/people'
import { APPT_LABEL, findClash, isoToZoned, timeOf, zonedToISO } from '../crm/lib'
import { useSubmit } from '../crm/hooks'
import { CustomerPicker, VehiclePicker } from '../crm/pickers'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Field, NumInput, Sheet } from '../ui'

const STATUSES: AppointmentStatus[] = ['solicitada', 'confirmada', 'en_recepcion', 'completada', 'cancelada', 'no_asistio']

function initial(data: Data, a?: Appointment, start?: string): { date: string; time: string } {
  const tz = data.settings.timezone
  if (a) return isoToZoned(a.start, tz)
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) return { date: start, time: '09:00' }
  if (start && !isNaN(new Date(start).getTime())) return isoToZoned(start, tz)
  return { date: data.today, time: '09:00' }
}

export function AppointmentForm({ data, appointment, start, customerId, vehicleId, onClose }: { data: Data; appointment?: Appointment; start?: string; customerId?: string; vehicleId?: string; onClose: () => void }) {
  const ctx = useCtx()
  const tz = data.settings.timezone
  const { busy, error, submit } = useSubmit()
  const t0 = initial(data, appointment, start)
  const [f, setF] = useState({
    customerId: appointment?.customerId ?? customerId ?? '', vehicleId: appointment?.vehicleId ?? vehicleId ?? '', date: t0.date, time: t0.time,
    durationMin: (appointment?.durationMin ?? 60) as number | undefined, reason: appointment?.reason ?? '', serviceId: appointment?.serviceId ?? '', mechanicId: appointment?.mechanicId ?? '',
    status: appointment?.status ?? 'solicitada' as AppointmentStatus, notes: appointment?.notes ?? '',
  })
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const services = data.services.filter((s) => s.active)
  const mechanics = data.employees.filter((e) => e.isMechanic && (e.active || e.id === appointment?.mechanicId))
  const converted = appointment?.status === 'convertida'
  const validWhen = /^\d{4}-\d{2}-\d{2}$/.test(f.date) && /^\d{2}:\d{2}$/.test(f.time)
  const iso = validWhen ? zonedToISO(f.date, f.time, tz) : ''
  const errs = {
    customerId: !f.customerId ? 'Elige al cliente.' : '',
    when: !validWhen ? 'Indica fecha y hora válidas.' : '',
    durationMin: !(f.durationMin !== undefined && f.durationMin > 0) ? 'La duración debe ser mayor que cero.' : '',
    reason: !f.reason.trim() ? 'Indica el motivo de la cita.' : '',
  }
  const hasErr = Object.values(errs).some(Boolean)
  const show = (k: keyof typeof errs) => (touched ? errs[k] : '')
  const clash = useMemo(() => (iso && f.durationMin && f.durationMin > 0 ? findClash(data.appointments, { id: appointment?.id, mechanicId: f.mechanicId || undefined, start: iso, durationMin: f.durationMin, status: f.status }) : undefined), [data.appointments, appointment?.id, f.mechanicId, iso, f.durationMin, f.status])

  const pickService = (id: string) => {
    const s = data.svcMap.get(id)
    setF((x) => {
      const prevName = data.svcMap.get(x.serviceId)?.name
      const next = { ...x, serviceId: id }
      if (s) { if (s.stdHours > 0) next.durationMin = Math.max(15, Math.round(s.stdHours * 60)); if (!x.reason.trim() || x.reason === prevName) next.reason = s.name }
      return next
    })
  }
  const save = async () => {
    setTouched(true)
    if (hasErr) return
    const r = await submit(() => saveAppointment(ctx, { id: appointment?.id, customerId: f.customerId, vehicleId: f.vehicleId || undefined, start: iso, durationMin: f.durationMin ?? 0, reason: f.reason, serviceId: f.serviceId || undefined, mechanicId: f.mechanicId || undefined, status: f.status, notes: f.notes }), appointment ? 'Cita actualizada' : 'Cita agendada')
    if (r) onClose()
  }
  return (
    <Sheet title={appointment ? 'Editar cita' : 'Agendar cita'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{appointment ? 'Guardar cambios' : 'Agendar cita'}</button></>}>
      <div className="stack-lg">
        {error && <div className="banner bad" role="alert"><b>No se pudo guardar la cita.</b> {error}</div>}
        {clash && !error && <div className="banner" role="status">Atención: este mecánico ya tiene otra cita en ese horario ({timeOf(clash.start, tz)}, {data.custMap.get(clash.customerId)?.name ?? 'cliente'}). Elige otro horario u otro mecánico; el sistema no permite dobles asignaciones.</div>}
        <section className="stack" aria-labelledby="af-cliente">
          <h3 id="af-cliente">Cliente y vehículo</h3>
          <CustomerPicker data={data} value={f.customerId} onChange={(id) => setF((x) => ({ ...x, customerId: id, vehicleId: '' }))} error={show('customerId')} autoFocus={!f.customerId} />
          <VehiclePicker data={data} customerId={f.customerId} value={f.vehicleId} onChange={(id) => set('vehicleId', id)} optional />
        </section>
        <section className="stack" aria-labelledby="af-cuando">
          <h3 id="af-cuando">Cuándo y qué servicio</h3>
          <div className="grid3">
            <Field label="Fecha *" error={show('when')}><input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} aria-invalid={!!show('when') || undefined} /></Field>
            <Field label="Hora *"><input type="time" value={f.time} onChange={(e) => set('time', e.target.value)} aria-invalid={!!show('when') || undefined} /></Field>
            <Field label="Duración (min) *" error={show('durationMin')}><NumInput value={f.durationMin} onChange={(v) => set('durationMin', v)} inputMode="numeric" invalid={!!show('durationMin')} /></Field>
          </div>
          <Field label="Servicio solicitado (opcional)" hint="Al elegirlo se completan la duración estándar y el motivo."><select value={f.serviceId} onChange={(e) => pickService(e.target.value)}><option value="">— Ninguno / otro motivo —</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name}{s.stdHours ? ` (${s.stdHours} h)` : ''}</option>)}</select></Field>
          <Field label="Motivo de la cita *" error={show('reason')}><input value={f.reason} onChange={(e) => set('reason', e.target.value)} autoComplete="off" aria-invalid={!!show('reason') || undefined} /></Field>
        </section>
        <section className="stack" aria-labelledby="af-asig">
          <h3 id="af-asig">Asignación y seguimiento</h3>
          <div className="grid2">
            <Field label="Mecánico asignado"><select value={f.mechanicId} onChange={(e) => set('mechanicId', e.target.value)}><option value="">Sin asignar</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}{m.active ? '' : ' (inactivo)'}</option>)}</select></Field>
            <Field label="Estado" hint={converted ? 'La cita ya se convirtió en orden de trabajo.' : undefined}>
              <select value={f.status} disabled={converted} onChange={(e) => set('status', e.target.value as AppointmentStatus)}>
                {converted ? <option value="convertida">{APPT_LABEL.convertida}</option> : STATUSES.map((s) => <option key={s} value={s}>{APPT_LABEL[s]}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notas"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          <p className="small muted">Torque no envía recordatorios por su cuenta: los avisos por WhatsApp, SMS o correo requieren una integración externa configurada.</p>
        </section>
      </div>
    </Sheet>
  )
}
