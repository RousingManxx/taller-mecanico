import { createOrganization, login } from '../services/auth'
import type { Ctx } from '../services/core'
import { saveCustomer, saveVehicle } from '../services/customers'
import { saveEmployee } from '../services/people'
import { saveProduct, saveService, saveSettings } from '../services/catalog'
import { saveSupplier, savePurchaseOrder, receivePurchase } from '../services/purchasing'
import { openSession } from '../services/cash'

export interface Clock { t: Date; advance: (min: number) => void }
export function clock(start = '2026-03-10T16:00:00Z'): Clock {
  const c: Clock = { t: new Date(start), advance: (min) => { c.t = new Date(c.t.getTime() + min * 60000) } }
  return c
}

/** Taller de prueba: dueño autenticado, reloj controlable y 160 h productivas / 30 % de cargas. */
export async function world(opts: { name?: string; clk?: Clock } = {}) {
  const clk = opts.clk ?? clock()
  const ctx = await createOrganization({ name: opts.name ?? 'Taller Prueba', ownerName: 'Dueña', pin: '1234', now: () => clk.t })
  await saveSettings(ctx, { labor: { productiveHoursPerMonth: 160, loadPct: 30, defaultRateCents: 45000 } })
  return { ctx, clk }
}

export async function basics(ctx: Ctx) {
  const customer = await saveCustomer(ctx, { name: 'Ana Pérez', phone: '5551234567' })
  const vehicle = await saveVehicle(ctx, { customerId: customer.id, make: 'Nissan', model: 'Versa', year: 2018, plate: 'ABC-123', km: 80000 })
  const mech = await saveEmployee(ctx, { name: 'Luis Mecánico', isMechanic: true, monthlyCostCents: 1_600_000, commercialRateCents: 45000 })
  const filtro = await saveProduct(ctx, { sku: 'F-100', name: 'Filtro de aceite', priceCents: 20000, minStock: 2 })
  const aceite = await saveProduct(ctx, { sku: 'A-5W30', name: 'Aceite 5W30', priceCents: 15000, unit: 'litro', minStock: 4 })
  const servicio = await saveService(ctx, { name: 'Cambio de aceite', category: 'Mantenimiento', stdHours: 1, priceCents: 35000 })
  const sup = await saveSupplier(ctx, { name: 'Refaccionaria Norte', paymentTermsDays: 15 })
  return { customer, vehicle, mech, filtro, aceite, servicio, sup }
}

/** Compra 10 filtros a $80 con $20 de flete: costo unitario real $82. */
export async function stockFiltros(ctx: Ctx, b: Awaited<ReturnType<typeof basics>>, qty = 10, unit = 8000, freight = 2000) {
  const po = await savePurchaseOrder(ctx, { supplierId: b.sup.id, items: [{ productId: b.filtro.id, qty, unitCostCents: unit }], freightCents: freight })
  const rec = await receivePurchase(ctx, po.id, [{ itemId: po.items[0].id, qty }], { invoiceRef: 'F-1' })
  return { po, rec }
}

export async function ownerLogin(ctx: Ctx, clk: Clock): Promise<Ctx> {
  return login(ctx.orgId, ctx.user.id, '1234', () => clk.t)
}
export async function withCash(ctx: Ctx, opening = 100_000) { return openSession(ctx, opening) }
