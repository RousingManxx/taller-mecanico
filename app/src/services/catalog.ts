import { netPrice, taxRateOf } from '../domain/alerts'
import { hourlyLaborCost } from '../domain/labor'
import { round } from '../domain/money'
import { targetPriceCents } from '../domain/pricing'
import type { PriceProposal, Product, ServiceDef, Settings } from '../domain/types'
import { audit, fail, getSettings, load, need, requireNonNegative, requireText, stamp, trim, tx, uid, type Ctx } from './core'
import { currentUnitCost } from './inventory'

function checkTax(s: Settings, taxId: string) { if (!s.taxes.some((t) => t.id === taxId)) fail('El impuesto seleccionado no existe en la configuración.') }

export type ProductInput = Partial<Omit<Product, 'orgId' | 'createdAt' | 'updatedAt'>> & { name: string; sku: string }
export async function saveProduct(ctx: Ctx, i: ProductInput): Promise<Product> {
  need(ctx, 'inventario.editar')
  const name = requireText(i.name, 'El nombre del producto'), sku = requireText(i.sku, 'El SKU').toUpperCase()
  const price = Math.round(i.priceCents ?? 0)
  requireNonNegative(price, 'El precio de venta')
  requireNonNegative(i.minStock ?? 0, 'El stock mínimo')
  return tx(ctx, async () => {
    const s = await getSettings(ctx)
    const taxId = i.taxId ?? s.defaultTaxId; checkTax(s, taxId)
    const all = await ctx.db.products.toArray()
    if (all.some((p) => p.id !== i.id && p.sku === sku)) fail(`Ya existe un producto con el SKU ${sku}.`)
    const barcode = trim(i.barcode)
    if (barcode && all.some((p) => p.id !== i.id && p.barcode === barcode)) fail('Ya existe un producto con ese código de barras.')
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.products, i.id, 'El producto') : null
    if (cur && cur.priceCents !== price) need(ctx, 'precios.editar')
    if (i.supplierId) await load(ctx, ctx.db.suppliers, i.supplierId, 'El proveedor')
    const p: Product = {
      id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, sku, barcode, name, description: trim(i.description), category: trim(i.category) || 'Otros', brand: trim(i.brand),
      partNo: trim(i.partNo), type: i.type ?? 'refaccion', unit: trim(i.unit) || 'pza', supplierId: i.supplierId || undefined, priceCents: price, taxId,
      minStock: i.minStock ?? s.lowStockDefault, location: trim(i.location), minMarginPct: i.minMarginPct, compat: trim(i.compat), lastPurchaseCost: cur?.lastPurchaseCost, prevPurchaseCost: cur?.prevPurchaseCost,
      photoId: i.photoId ?? cur?.photoId, active: i.active ?? cur?.active ?? true,
    }
    await ctx.db.products.put(p)
    if (cur && cur.priceCents !== price) {
      await ctx.db.priceHistory.add({ id: uid(), orgId: ctx.orgId, kind: 'producto', refId: p.id, at, userId: ctx.user.id, oldPriceCents: cur.priceCents, newPriceCents: price, reason: 'Edición manual' })
      await audit(ctx, 'precio.cambiado', 'producto', p.id, { before: { priceCents: cur.priceCents }, after: { priceCents: price } })
    } else if (!cur) await audit(ctx, 'producto.creado', 'producto', p.id, { after: { sku, name, priceCents: price } })
    return p
  })
}

export async function removeProduct(ctx: Ctx, id: string): Promise<'borrado' | 'desactivado'> {
  need(ctx, 'inventario.editar')
  return tx(ctx, async () => {
    const p = await load(ctx, ctx.db.products, id, 'El producto')
    const used = await ctx.db.movements.where('productId').equals(id).count()
    if (used > 0) { await ctx.db.products.put({ ...p, active: false, updatedAt: stamp(ctx) }); await audit(ctx, 'producto.desactivado', 'producto', id); return 'desactivado' }
    await ctx.db.products.delete(id); await audit(ctx, 'producto.borrado', 'producto', id, { before: { sku: p.sku } }); return 'borrado'
  })
}

export type ServiceInput = Partial<Omit<ServiceDef, 'orgId' | 'createdAt' | 'updatedAt'>> & { name: string }
export async function saveService(ctx: Ctx, i: ServiceInput): Promise<ServiceDef> {
  need(ctx, 'precios.editar')
  const name = requireText(i.name, 'El nombre del servicio')
  const price = Math.round(i.priceCents ?? 0)
  requireNonNegative(price, 'El precio'); requireNonNegative(i.stdHours ?? 0, 'El tiempo estándar')
  return tx(ctx, async () => {
    const s = await getSettings(ctx)
    const taxId = i.taxId ?? s.defaultTaxId; checkTax(s, taxId)
    const all = await ctx.db.services.toArray()
    if (all.some((x) => x.id !== i.id && x.name.toLowerCase() === name.toLowerCase())) fail('Ya existe un servicio con ese nombre.')
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.services, i.id, 'El servicio') : null
    const d: ServiceDef = { id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, name, category: trim(i.category) || 'Otros', description: trim(i.description), stdHours: i.stdHours ?? 0, priceCents: price, taxId, minMarginPct: i.minMarginPct, active: i.active ?? cur?.active ?? true }
    await ctx.db.services.put(d)
    if (cur && cur.priceCents !== price) {
      await ctx.db.priceHistory.add({ id: uid(), orgId: ctx.orgId, kind: 'servicio', refId: d.id, at, userId: ctx.user.id, oldPriceCents: cur.priceCents, newPriceCents: price, reason: 'Edición manual' })
      await audit(ctx, 'precio.cambiado', 'servicio', d.id, { before: { priceCents: cur.priceCents }, after: { priceCents: price } })
    } else if (!cur) await audit(ctx, 'servicio.creado', 'servicio', d.id, { after: { name, priceCents: price } })
    return d
  })
}
export async function removeService(ctx: Ctx, id: string): Promise<void> {
  need(ctx, 'precios.editar')
  await tx(ctx, async () => {
    const d = await load(ctx, ctx.db.services, id, 'El servicio')
    await ctx.db.services.put({ ...d, active: false, updatedAt: stamp(ctx) })
    await audit(ctx, 'servicio.desactivado', 'servicio', id)
  })
}

/** Costo laboral promedio por hora de los mecánicos con costo capturado (centavos). 0 si no hay datos. */
export async function averageHourlyLaborCost(ctx: Ctx): Promise<number> {
  const s = await getSettings(ctx)
  const mech = (await ctx.db.employees.toArray()).filter((e) => e.active && e.isMechanic && e.monthlyCostCents > 0)
  if (!mech.length) return 0
  return round(mech.reduce((a, e) => a + hourlyLaborCost(e, s), 0) / mech.length)
}

/** Costo base de un producto o servicio para fijar precios (centavos, decimal; 0 = desconocido). */
export async function costBasis(ctx: Ctx, kind: 'producto' | 'servicio', refId: string): Promise<number> {
  if (kind === 'producto') return currentUnitCost(ctx, refId)
  const d = await load(ctx, ctx.db.services, refId, 'El servicio')
  return d.stdHours * (await averageHourlyLaborCost(ctx))
}

/** Propuesta de precio para un margen objetivo. No cambia nada hasta que alguien con permiso la apruebe. */
export async function proposePrice(ctx: Ctx, kind: 'producto' | 'servicio', refId: string, targetMarginPct?: number): Promise<PriceProposal> {
  need(ctx, 'precios.editar')
  return tx(ctx, async () => {
    const s = await getSettings(ctx)
    const item = kind === 'producto' ? await load(ctx, ctx.db.products, refId, 'El producto') : await load(ctx, ctx.db.services, refId, 'El servicio')
    const cost = await costBasis(ctx, kind, refId)
    const margin = targetMarginPct ?? s.targetMarginPct
    const net = targetPriceCents(round(cost), margin)
    if (net === null) return fail('No se puede calcular el precio: falta el costo o el margen objetivo no es válido.')
    const rate = taxRateOf(s, item.taxId)
    const proposed = s.pricesIncludeTax ? round(net * (1 + rate / 100)) : net
    const at = stamp(ctx)
    const pr: PriceProposal = { id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, kind, refId, name: item.name, currentPriceCents: item.priceCents, proposedPriceCents: proposed, costBasis: cost, targetMarginPct: margin, status: 'pendiente' }
    await ctx.db.priceProposals.add(pr)
    return pr
  })
}
export async function decideProposal(ctx: Ctx, id: string, approve: boolean): Promise<void> {
  need(ctx, 'precios.aprobar')
  await tx(ctx, async () => {
    const pr = await load(ctx, ctx.db.priceProposals, id, 'La propuesta')
    if (pr.status !== 'pendiente') fail('La propuesta ya fue resuelta.')
    const at = stamp(ctx)
    if (approve) {
      const table = pr.kind === 'producto' ? ctx.db.products : ctx.db.services
      const cur = await load(ctx, table as typeof ctx.db.products, pr.refId, 'El artículo')
      await (table as typeof ctx.db.products).put({ ...cur, priceCents: pr.proposedPriceCents, updatedAt: at })
      await ctx.db.priceHistory.add({ id: uid(), orgId: ctx.orgId, kind: pr.kind, refId: pr.refId, at, userId: ctx.user.id, oldPriceCents: cur.priceCents, newPriceCents: pr.proposedPriceCents, reason: `Propuesta aprobada (margen objetivo ${pr.targetMarginPct} %)` })
      await audit(ctx, 'precio.cambiado', pr.kind, pr.refId, { before: { priceCents: cur.priceCents }, after: { priceCents: pr.proposedPriceCents }, reason: 'Propuesta de precio aprobada' })
    }
    await ctx.db.priceProposals.put({ ...pr, status: approve ? 'aprobada' : 'rechazada', decidedBy: ctx.user.id, decidedAt: at, updatedAt: at })
    await audit(ctx, approve ? 'propuesta_precio.aprobada' : 'propuesta_precio.rechazada', 'propuesta_precio', id)
  })
}

/* ───────── Configuración ───────── */
export type SettingsPatch = Partial<Omit<Settings, 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'counters' | 'schemaVersion'>>
export async function saveSettings(ctx: Ctx, patch: SettingsPatch): Promise<Settings> {
  need(ctx, 'config.editar')
  return tx(ctx, async () => {
    const cur = await getSettings(ctx)
    const next: Settings = { ...cur, ...patch, updatedAt: stamp(ctx) }
    if (patch.taxes) {
      if (!patch.taxes.length) fail('Debe existir al menos un impuesto.')
      for (const t of patch.taxes) if (!(t.rate >= 0 && t.rate <= 100) || !trim(t.name)) fail('Las tasas de impuesto deben estar entre 0 y 100 y tener nombre.')
      if (!patch.taxes.some((t) => t.id === next.defaultTaxId)) next.defaultTaxId = patch.taxes[0].id
    }
    if (!(next.targetMarginPct >= 0 && next.targetMarginPct < 100) || !(next.minMarginPct >= 0 && next.minMarginPct < 100)) fail('Los márgenes deben estar entre 0 y 99.99 %.')
    if (!(next.labor.productiveHoursPerMonth > 0) || next.labor.loadPct < 0) fail('Revisa las horas productivas y la carga laboral.')
    if (!trim(next.businessName)) fail('El nombre del taller es obligatorio.')
    if (patch.paymentMethods && !patch.paymentMethods.length) fail('Debe existir al menos un método de pago.')
    await ctx.db.settings.put(next)
    const keys = ['taxes', 'pricesIncludeTax', 'targetMarginPct', 'minMarginPct', 'overheadMethod', 'labor', 'requireAuthorization'] as const
    const changed = keys.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k]))
    if (changed.length) await audit(ctx, 'configuracion.cambiada', 'configuracion', 'main', { before: Object.fromEntries(changed.map((k) => [k, cur[k]])), after: Object.fromEntries(changed.map((k) => [k, next[k]])) })
    return next
  })
}
export { netPrice }
