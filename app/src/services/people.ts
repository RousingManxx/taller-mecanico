import type { Appointment, AppointmentStatus, Employee } from '../domain/types'
import { audit, fail, load, need, requireNonNegative, requireText, requirePositive, stamp, trim, tx, uid, allowed, type Ctx } from './core'

export type EmployeeInput = Partial<Omit<Employee, 'orgId' | 'createdAt' | 'updatedAt'>> & { name: string }
/** El costo laboral es dato sensible: solo lo cambia quien tenga el permiso de salarios. */
export async function saveEmployee(ctx: Ctx, i: EmployeeInput): Promise<Employee> {
  need(ctx, 'personal.editar')
  const name = requireText(i.name, 'El nombre')
  requireNonNegative(i.monthlyCostCents ?? 0, 'El costo laboral'); requireNonNegative(i.commercialRateCents ?? 0, 'La tarifa comercial')
  if (i.productiveHoursPerMonth !== undefined) requirePositive(i.productiveHoursPerMonth, 'Las horas productivas')
  if (i.loadPct !== undefined) requireNonNegative(i.loadPct, 'La carga laboral')
  return tx(ctx, async () => {
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.employees, i.id, 'El empleado') : null
    const salaryTouched = (i.monthlyCostCents ?? 0) !== (cur?.monthlyCostCents ?? 0) || i.loadPct !== cur?.loadPct || i.productiveHoursPerMonth !== cur?.productiveHoursPerMonth
    if (salaryTouched && !allowed(ctx, 'personal.salarios')) fail('No tienes permiso para capturar o modificar datos salariales.')
    const e: Employee = {
      id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, name, role: trim(i.role) || (i.isMechanic ? 'Mecánico' : ''), specialty: trim(i.specialty),
      hireDate: i.hireDate, phone: trim(i.phone), email: trim(i.email), active: i.active ?? cur?.active ?? true, isMechanic: i.isMechanic ?? cur?.isMechanic ?? true,
      monthlyCostCents: i.monthlyCostCents ?? cur?.monthlyCostCents ?? 0, loadPct: i.loadPct, productiveHoursPerMonth: i.productiveHoursPerMonth, commercialRateCents: i.commercialRateCents ?? cur?.commercialRateCents ?? 0,
    }
    await ctx.db.employees.put(e)
    await audit(ctx, cur ? 'empleado.modificado' : 'empleado.creado', 'empleado', e.id, { before: cur ? { active: cur.active, role: cur.role } : undefined, after: { name, active: e.active, salarioModificado: salaryTouched } })
    return e
  })
}
/** Vista de empleados sin datos salariales si el usuario no tiene permiso. */
export const redactEmployee = (e: Employee, canSee: boolean): Employee => (canSee ? e : { ...e, monthlyCostCents: 0, loadPct: undefined, productiveHoursPerMonth: undefined })

/* ───────── Agenda ───────── */
export type AppointmentInput = Partial<Omit<Appointment, 'orgId' | 'createdAt' | 'updatedAt'>> & { customerId: string; start: string; durationMin: number; reason: string }
const ACTIVE: AppointmentStatus[] = ['solicitada', 'confirmada', 'en_recepcion', 'convertida']
export async function saveAppointment(ctx: Ctx, i: AppointmentInput): Promise<Appointment> {
  need(ctx, 'agenda.editar')
  requireText(i.reason, 'El motivo'); requirePositive(i.durationMin, 'La duración')
  if (isNaN(new Date(i.start).getTime())) fail('La fecha y hora no son válidas.')
  return tx(ctx, async () => {
    await load(ctx, ctx.db.customers, i.customerId, 'El cliente')
    if (i.vehicleId) { const v = await load(ctx, ctx.db.vehicles, i.vehicleId, 'El vehículo'); if (v.customerId !== i.customerId) fail('El vehículo no pertenece a ese cliente.') }
    const status = i.status ?? 'solicitada'
    const s = new Date(i.start).getTime(), e = s + i.durationMin * 60000
    if (i.mechanicId && ACTIVE.includes(status)) {
      const clash = (await ctx.db.appointments.where('mechanicId').equals(i.mechanicId).toArray()).find((a) => a.id !== i.id && ACTIVE.includes(a.status) && new Date(a.start).getTime() < e && new Date(a.start).getTime() + a.durationMin * 60000 > s)
      if (clash) fail(`El mecánico ya tiene una cita en ese horario (${new Date(clash.start).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}).`)
    }
    const at = stamp(ctx), cur = i.id ? await load(ctx, ctx.db.appointments, i.id, 'La cita') : null
    const a: Appointment = { id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, customerId: i.customerId, vehicleId: i.vehicleId || undefined, start: new Date(i.start).toISOString(), durationMin: i.durationMin, reason: trim(i.reason), serviceId: i.serviceId || undefined, mechanicId: i.mechanicId || undefined, status, notes: trim(i.notes), workOrderId: cur?.workOrderId ?? i.workOrderId }
    await ctx.db.appointments.put(a)
    if (!cur) await audit(ctx, 'cita.creada', 'cita', a.id, { after: { start: a.start } })
    return a
  })
}
export async function setAppointmentStatus(ctx: Ctx, id: string, status: AppointmentStatus): Promise<void> {
  need(ctx, 'agenda.editar')
  await tx(ctx, async () => {
    const a = await load(ctx, ctx.db.appointments, id, 'La cita')
    if (a.status === 'convertida' && status !== 'completada') fail('La cita ya se convirtió en orden de trabajo.')
    await ctx.db.appointments.put({ ...a, status, updatedAt: stamp(ctx) })
  })
}
