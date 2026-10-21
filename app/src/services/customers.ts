import type { Customer, Vehicle } from '../domain/types'
import { audit, fail, load, need, requireNonNegative, requireText, stamp, trim, tx, uid, type Ctx } from './core'

export type CustomerInput = Partial<Omit<Customer, 'orgId' | 'createdAt' | 'updatedAt'>> & { name: string }
export async function saveCustomer(ctx: Ctx, i: CustomerInput): Promise<Customer> {
  need(ctx, 'clientes.editar')
  const name = requireText(i.name, 'El nombre del cliente')
  const email = trim(i.email)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('El correo electrónico no es válido.')
  const phone = trim(i.phone)
  if (phone && phone.replace(/\D/g, '').length < 7) fail('El teléfono parece incompleto.')
  return tx(ctx, async () => {
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.customers, i.id, 'El cliente') : null
    const c: Customer = {
      id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, name, phone, email, address: trim(i.address),
      taxId: trim(i.taxId).toUpperCase(), fiscalName: trim(i.fiscalName), fiscalAddress: trim(i.fiscalAddress),
      contactPref: i.contactPref ?? 'telefono', notes: trim(i.notes), active: i.active ?? cur?.active ?? true,
    }
    await ctx.db.customers.put(c)
    if (!cur) await audit(ctx, 'cliente.creado', 'cliente', c.id, { after: { name } })
    return c
  })
}

/** Borra si no tiene historial; si lo tiene, lo desactiva (el historial no se pierde). */
export async function removeCustomer(ctx: Ctx, id: string): Promise<'borrado' | 'desactivado'> {
  need(ctx, 'clientes.editar')
  return tx(ctx, async () => {
    const c = await load(ctx, ctx.db.customers, id, 'El cliente')
    const used = (await ctx.db.workOrders.where('customerId').equals(id).count()) + (await ctx.db.sales.where('customerId').equals(id).count()) +
      (await ctx.db.quotations.where('customerId').equals(id).count()) + (await ctx.db.vehicles.where('customerId').equals(id).count())
    if (used > 0) { await ctx.db.customers.put({ ...c, active: false, updatedAt: stamp(ctx) }); await audit(ctx, 'cliente.desactivado', 'cliente', id); return 'desactivado' }
    await ctx.db.customers.delete(id); await audit(ctx, 'cliente.borrado', 'cliente', id, { before: { name: c.name } }); return 'borrado'
  })
}

export type VehicleInput = Partial<Omit<Vehicle, 'orgId' | 'createdAt' | 'updatedAt'>> & { customerId: string; make: string; model: string }
export async function saveVehicle(ctx: Ctx, i: VehicleInput): Promise<Vehicle> {
  need(ctx, 'vehiculos.editar')
  const make = requireText(i.make, 'La marca'), model = requireText(i.model, 'El modelo')
  const plate = trim(i.plate).toUpperCase().replace(/\s+/g, ' '), vin = trim(i.vin).toUpperCase()
  if (!plate && !vin) fail('Indica las placas o el VIN del vehículo.')
  if (vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) fail('El VIN debe tener de 11 a 17 caracteres (sin I, O ni Q).')
  const year = i.year
  if (year !== undefined && !(Number.isInteger(year) && year >= 1950 && year <= new Date().getFullYear() + 1)) fail('El año del vehículo no es válido.')
  requireNonNegative(i.km ?? 0, 'El kilometraje')
  return tx(ctx, async () => {
    await load(ctx, ctx.db.customers, i.customerId, 'El cliente')
    const others = (await ctx.db.vehicles.toArray()).filter((v) => v.id !== i.id && v.active)
    if (plate && others.some((v) => v.plate === plate)) fail(`Ya existe un vehículo con las placas ${plate}.`)
    if (vin && others.some((v) => v.vin === vin)) fail(`Ya existe un vehículo con el VIN ${vin}.`)
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.vehicles, i.id, 'El vehículo') : null
    const v: Vehicle = {
      id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, customerId: i.customerId, make, model, year, version: trim(i.version),
      plate, vin, km: i.km ?? cur?.km ?? 0, fuel: i.fuel ?? '', transmission: i.transmission ?? '', color: trim(i.color), engineNo: trim(i.engineNo), notes: trim(i.notes),
      photoIds: i.photoIds ?? cur?.photoIds ?? [], active: i.active ?? cur?.active ?? true,
    }
    await ctx.db.vehicles.put(v)
    if (!cur) await audit(ctx, 'vehiculo.creado', 'vehiculo', v.id, { after: { make, model, plate } })
    return v
  })
}
export async function removeVehicle(ctx: Ctx, id: string): Promise<'borrado' | 'desactivado'> {
  need(ctx, 'vehiculos.editar')
  return tx(ctx, async () => {
    const v = await load(ctx, ctx.db.vehicles, id, 'El vehículo')
    const used = (await ctx.db.workOrders.where('vehicleId').equals(id).count()) + (await ctx.db.quotations.filter((q) => q.vehicleId === id).count())
    if (used > 0) { await ctx.db.vehicles.put({ ...v, active: false, updatedAt: stamp(ctx) }); await audit(ctx, 'vehiculo.desactivado', 'vehiculo', id); return 'desactivado' }
    await ctx.db.vehicles.delete(id); return 'borrado'
  })
}

/** Fotos del vehículo (el UI las comprime antes con `compressImage`). */
export async function attachVehiclePhoto(ctx: Ctx, vehicleId: string, f: { name: string; mime: string; dataUrl: string }): Promise<string> {
  need(ctx, 'vehiculos.editar')
  if (!/^data:image\/(png|jpeg|webp);base64,/.test(f.dataUrl)) fail('Formato no permitido (usa JPG, PNG o WebP).')
  if (f.dataUrl.length > 3_000_000) fail('La imagen es demasiado grande (máximo ≈ 2 MB).')
  return tx(ctx, async () => {
    const v = await load(ctx, ctx.db.vehicles, vehicleId, 'El vehículo')
    const id = uid()
    await ctx.db.attachments.add({ id, orgId: ctx.orgId, ownerType: 'vehiculo', ownerId: vehicleId, name: trim(f.name) || 'foto', mime: f.mime, size: f.dataUrl.length, dataUrl: f.dataUrl, createdAt: stamp(ctx) })
    await ctx.db.vehicles.put({ ...v, photoIds: [...v.photoIds, id], updatedAt: stamp(ctx) })
    return id
  })
}
export async function removeVehiclePhoto(ctx: Ctx, vehicleId: string, photoId: string): Promise<void> {
  need(ctx, 'vehiculos.editar')
  await tx(ctx, async () => {
    const v = await load(ctx, ctx.db.vehicles, vehicleId, 'El vehículo')
    await ctx.db.attachments.delete(photoId)
    await ctx.db.vehicles.put({ ...v, photoIds: v.photoIds.filter((x) => x !== photoId), updatedAt: stamp(ctx) })
  })
}
