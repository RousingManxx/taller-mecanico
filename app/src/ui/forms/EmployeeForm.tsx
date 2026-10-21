import { useState } from 'react'
import { hourlyLaborCost } from '../../domain/labor'
import { formatMXN } from '../../domain/money'
import type { Employee } from '../../domain/types'
import { saveEmployee } from '../../services/people'
import { useCtx } from '../session'
import type { Data } from '../data'
import { Field, MoneyInput, NumInput, Sheet, useBusy, useUi } from '../ui'

export function EmployeeForm({ data, employee, onClose }: { data: Data; employee?: Employee; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const canSal = data.can('personal.salarios')
  const [f, setF] = useState({
    name: employee?.name ?? '', role: employee?.role ?? 'Mecánico', specialty: employee?.specialty ?? '', hireDate: employee?.hireDate ?? '', phone: employee?.phone ?? '', email: employee?.email ?? '',
    isMechanic: employee?.isMechanic ?? true, active: employee?.active ?? true, monthly: employee?.monthlyCostCents as number | undefined, load: employee?.loadPct, hours: employee?.productiveHoursPerMonth, rate: employee?.commercialRateCents as number | undefined,
  })
  const hourly = f.monthly ? hourlyLaborCost({ monthlyCostCents: f.monthly, loadPct: f.load, productiveHoursPerMonth: f.hours }, data.settings) : 0
  const save = () => guard(async () => {
    const r = await ui.run(() => saveEmployee(ctx, { id: employee?.id, name: f.name, role: f.role, specialty: f.specialty, hireDate: f.hireDate || undefined, phone: f.phone, email: f.email, isMechanic: f.isMechanic, active: f.active, monthlyCostCents: f.monthly ?? 0, loadPct: f.load, productiveHoursPerMonth: f.hours, commercialRateCents: f.rate ?? 0 }), 'Empleado guardado')
    if (r) onClose()
  })
  return (
    <Sheet title={employee ? 'Editar empleado' : 'Nuevo empleado'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.name.trim()} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <Field label="Nombre completo"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="grid2"><Field label="Rol / puesto"><input value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} /></Field><Field label="Especialidad"><input value={f.specialty} onChange={(e) => setF({ ...f, specialty: e.target.value })} placeholder="Frenos, motor, eléctrico…" /></Field></div>
        <div className="grid2"><Field label="Fecha de ingreso"><input type="date" value={f.hireDate} onChange={(e) => setF({ ...f, hireDate: e.target.value })} /></Field><Field label="Teléfono"><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field></div>
        <Field label="Correo"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <label className="chk"><input type="checkbox" checked={f.isMechanic} onChange={(e) => setF({ ...f, isMechanic: e.target.checked })} />Es mecánico (puede tener tiempos y órdenes asignadas)</label>
        <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo</label>
        <h3>Costo laboral</h3>
        {canSal ? <>
          <div className="grid2"><Field label="Costo mensual (salario)" hint="Dato sensible: solo lo ven quienes tengan permiso"><MoneyInput cents={f.monthly} onChange={(v) => setF({ ...f, monthly: v })} /></Field><Field label="Tarifa comercial por hora" hint="Lo que cobra el taller por hora de este mecánico"><MoneyInput cents={f.rate} onChange={(v) => setF({ ...f, rate: v })} /></Field></div>
          <div className="grid2"><Field label="Carga laboral % (opcional)" hint={`Por defecto ${data.settings.labor.loadPct} %`}><NumInput value={f.load} onChange={(v) => setF({ ...f, load: v })} /></Field><Field label="Horas productivas al mes (opcional)" hint={`Por defecto ${data.settings.labor.productiveHoursPerMonth} h`}><NumInput value={f.hours} onChange={(v) => setF({ ...f, hours: v })} /></Field></div>
          <div className="banner info">Costo laboral por hora productiva: <b>{f.monthly ? formatMXN(hourly) : 'sin costo capturado'}</b> = costo mensual × (1 + carga) ÷ horas productivas. Es lo que se imputa a las órdenes por cada hora trabajada.</div>
        </> : <div className="banner">No tienes permiso para capturar o ver datos salariales.</div>}
        <p className="small muted">Si calculas nómina aquí, es una estimación gerencial: no sustituye el cumplimiento de obligaciones laborales y fiscales.</p>
      </div>
    </Sheet>
  )
}
