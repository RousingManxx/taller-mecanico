import { taxRateOf } from '../domain/alerts'
import { addDays } from '../domain/dates'
import { lineAmounts } from '../domain/lines'
import { currentVersion } from '../domain/quotes'
import type { ItemType, Quotation, QuoteItem, QuoteStatus, QuoteVersion, WorkItem, WorkOrder } from '../domain/types'
import { audit, fail, getSettings, load, need, nextFolio, requirePositive, requireNonNegative, requireText, stamp, today, trim, tx, uid, type Ctx } from './core'
import { costBasis } from './catalog'
import { createOrder } from './workorders'

export interface QuoteItemInput { type: ItemType; refId?: string; description?: string; qty: number; unitPriceCents?: number; discountCents?: number; taxRate?: number; stdHours?: number; estUnitCost?: number }
export interface QuoteInput { customerId: string; vehicleId: string; items: QuoteItemInput[]; notes?: string; terms?: string; warranty?: string; estimatedDays?: number; validDays?: number }

async function buildItems(ctx: Ctx, items: QuoteItemInput[]): Promise<QuoteItem[]> {
  if (!items.length) fail('Agrega al menos una partida a la cotización.')
  const s = await getSettings(ctx)
  const out: QuoteItem[] = []
  for (const sp of items) {
    requirePositive(sp.qty, 'La cantidad')
    let description = trim(sp.description), unit = 'pza', price = sp.unitPriceCents, rate = sp.taxRate, std = sp.stdHours ?? 0, est = sp.estUnitCost
    if (sp.type === 'servicio' && sp.refId) {
      const d = await load(ctx, ctx.db.services, sp.refId, 'El servicio')
      description ||= d.name; unit = 'servicio'; price ??= d.priceCents; rate ??= taxRateOf(s, d.taxId); std = sp.stdHours ?? d.stdHours
      est ??= await costBasis(ctx, 'servicio', d.id)
    } else if ((sp.type === 'refaccion' || sp.type === 'consumible') && sp.refId) {
      const p = await load(ctx, ctx.db.products, sp.refId, 'El producto')
      description ||= p.name; unit = p.unit; price ??= p.priceCents; rate ??= taxRateOf(s, p.taxId)
      est ??= await costBasis(ctx, 'producto', p.id)
    } else if (sp.type === 'servicio' || sp.type === 'externo') unit = 'servicio'
    if (!description) fail('Describe la partida.')
    const p = price ?? 0, disc = sp.discountCents ?? 0
    requireNonNegative(p, 'El precio')
    if (disc < 0 || disc > Math.round(sp.qty * p)) fail('El descuento no puede ser negativo ni superar el importe de la partida.')
    out.push({ id: uid(), type: sp.type, refId: sp.refId, description, qty: sp.qty, unit, unitPriceCents: p, discountCents: disc, taxRate: rate ?? taxRateOf(s, s.defaultTaxId), estUnitCost: est ?? 0, stdHours: std })
  }
  return out
}

export async function saveQuotation(ctx: Ctx, i: QuoteInput, id?: string): Promise<Quotation> {
  need(ctx, 'cotizaciones.editar')
  return tx(ctx, async () => {
    await load(ctx, ctx.db.customers, i.customerId, 'El cliente')
    const v = await load(ctx, ctx.db.vehicles, i.vehicleId, 'El vehículo')
    if (v.customerId !== i.customerId) fail('El vehículo no pertenece a ese cliente.')
    const s = await getSettings(ctx)
    const at = stamp(ctx)
    const cur = id ? await load(ctx, ctx.db.quotations, id, 'La cotización') : null
    if (cur && ['aprobada', 'convertida'].includes(cur.status)) fail('Una cotización aprobada no se edita: duplícala o crea otra.')
    const items = await buildItems(ctx, i.items)
    const base = { items, notes: trim(i.notes), terms: i.terms ?? s.quoteTerms, warranty: i.warranty ?? s.warrantyText, estimatedDays: i.estimatedDays ?? 1 }
    if (!cur) {
      const issue = today(ctx)
      const q: Quotation = {
        id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, folio: await nextFolio(ctx, 'cotizacion'), customerId: i.customerId, vehicleId: i.vehicleId, status: 'borrador',
        issueDate: issue, validUntil: addDays(issue, i.validDays ?? s.quoteValidDays), versions: [{ n: 1, createdAt: at, userId: ctx.user.id, ...base }], currentVersion: 1,
      }
      await ctx.db.quotations.add(q)
      await audit(ctx, 'cotizacion.creada', 'cotizacion', q.id, { after: { folio: q.folio } })
      return q
    }
    const cv = currentVersion(cur)
    let q: Quotation
    if (cur.status === 'borrador') {
      q = { ...cur, customerId: i.customerId, vehicleId: i.vehicleId, versions: cur.versions.map((x) => (x.n === cv.n ? { ...x, ...base } : x)), updatedAt: at }
    } else {
      // Ya se envió o respondió: se conserva la versión anterior y se abre una nueva.
      const n = Math.max(...cur.versions.map((x) => x.n)) + 1
      q = { ...cur, status: 'borrador', customerId: i.customerId, vehicleId: i.vehicleId, versions: [...cur.versions, { n, createdAt: at, userId: ctx.user.id, ...base }], currentVersion: n, validUntil: addDays(today(ctx), i.validDays ?? s.quoteValidDays), rejectReason: undefined, updatedAt: at }
      await audit(ctx, 'cotizacion.nueva_version', 'cotizacion', q.id, { after: { version: n } })
    }
    await ctx.db.quotations.put(q)
    return q
  })
}

async function setStatus(ctx: Ctx, id: string, from: QuoteStatus[], to: QuoteStatus, extra: Partial<Quotation> = {}, action = `cotizacion.${to}`): Promise<Quotation> {
  const q = await load(ctx, ctx.db.quotations, id, 'La cotización')
  if (!from.includes(q.status)) fail(`La cotización está «${q.status}»; no se puede pasar a «${to}».`)
  const n = { ...q, ...extra, status: to, updatedAt: stamp(ctx) }
  await ctx.db.quotations.put(n)
  await audit(ctx, action, 'cotizacion', id, { before: { status: q.status }, after: { status: to } })
  return n
}
export const sendQuotation = (ctx: Ctx, id: string) => { need(ctx, 'cotizaciones.editar'); return tx(ctx, () => setStatus(ctx, id, ['borrador'], 'enviada')) }
export const markQuotationViewed = (ctx: Ctx, id: string) => { need(ctx, 'cotizaciones.editar'); return tx(ctx, () => setStatus(ctx, id, ['enviada'], 'vista')) }
export const rejectQuotation = (ctx: Ctx, id: string, reason: string) => { need(ctx, 'cotizaciones.editar'); return tx(ctx, () => setStatus(ctx, id, ['borrador', 'enviada', 'vista'], 'rechazada', { rejectReason: trim(reason) })) }
/** Aprueba la versión vigente: queda registrado quién, cuándo y qué versión aceptó el cliente. */
export const approveQuotation = (ctx: Ctx, id: string, approvedBy: string) => {
  need(ctx, 'cotizaciones.editar')
  const who = requireText(approvedBy, 'El nombre de quien aprueba')
  return tx(ctx, async () => {
    const q = await load(ctx, ctx.db.quotations, id, 'La cotización')
    return setStatus(ctx, id, ['borrador', 'enviada', 'vista'], 'aprobada', { approvedVersion: q.currentVersion, approvedBy: who, approvedAt: stamp(ctx) })
  })
}

export async function refreshExpiredQuotations(ctx: Ctx): Promise<number> {
  const t = today(ctx)
  return tx(ctx, async () => {
    let n = 0
    for (const q of await ctx.db.quotations.where('status').anyOf('borrador', 'enviada', 'vista').toArray()) {
      if (q.validUntil < t) { await ctx.db.quotations.put({ ...q, status: 'vencida', updatedAt: stamp(ctx) }); n++ }
    }
    return n
  })
}

export async function duplicateQuotation(ctx: Ctx, id: string): Promise<Quotation> {
  need(ctx, 'cotizaciones.editar')
  return tx(ctx, async () => {
    const q = await load(ctx, ctx.db.quotations, id, 'La cotización')
    const s = await getSettings(ctx), v = currentVersion(q), at = stamp(ctx), issue = today(ctx)
    const copy: Quotation = {
      id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, folio: await nextFolio(ctx, 'cotizacion'), customerId: q.customerId, vehicleId: q.vehicleId, status: 'borrador',
      issueDate: issue, validUntil: addDays(issue, s.quoteValidDays), currentVersion: 1,
      versions: [{ n: 1, createdAt: at, userId: ctx.user.id, items: v.items.map((x) => ({ ...x, id: uid() })), notes: v.notes, terms: v.terms, warranty: v.warranty, estimatedDays: v.estimatedDays }],
    }
    await ctx.db.quotations.add(copy)
    await audit(ctx, 'cotizacion.duplicada', 'cotizacion', copy.id, { after: { origen: q.folio } })
    return copy
  })
}

/** Convierte una cotización aprobada en orden de trabajo sin recapturar: las partidas llegan autorizadas con su versión aprobada. */
export async function convertQuotationToOrder(ctx: Ctx, id: string, o: { km: number; mechanicId?: string; complaint?: string }): Promise<WorkOrder> {
  need(ctx, 'cotizaciones.editar'); need(ctx, 'ordenes.crear')
  const preQ = await load(ctx, ctx.db.quotations, id, 'La cotización')
  if (preQ.status !== 'aprobada') fail('Solo se puede convertir una cotización aprobada.')
  const ord = await createOrder(ctx, { customerId: preQ.customerId, vehicleId: preQ.vehicleId, km: o.km, complaint: o.complaint || `Según cotización ${preQ.folio}`, mechanicId: o.mechanicId, quotationId: preQ.id })
  return tx(ctx, async () => {
    const q = await load(ctx, ctx.db.quotations, id, 'La cotización')
    if (q.status !== 'aprobada') fail('La cotización ya fue convertida.')
    const v = q.versions.find((x) => x.n === q.approvedVersion) ?? currentVersion(q)
    const s = await getSettings(ctx), at = stamp(ctx)
    const fresh = await load(ctx, ctx.db.workOrders, ord.id)
    const items: WorkItem[] = v.items.map((i) => ({
      id: uid(), type: i.type, refId: i.refId, description: i.description, qty: i.qty, unit: i.unit, unitPriceCents: i.unitPriceCents, discountCents: i.discountCents, taxRate: i.taxRate,
      status: 'autorizado', costCents: 0, movementIds: [], stdHours: i.stdHours, consumedQty: 0, authorizedAt: at, authorizedBy: q.approvedBy,
    }))
    const total = items.reduce((a, i) => a + lineAmounts(i, s.pricesIncludeTax).totalCents, 0)
    const auth = { id: uid(), at, userId: ctx.user.id, approvedBy: q.approvedBy ?? '', via: 'otro' as const, amountCents: total, itemIds: items.map((i) => i.id), quotationId: q.id, quotationVersion: q.approvedVersion, notes: `Cotización ${q.folio} v${q.approvedVersion}` }
    await ctx.db.workOrders.put({ ...fresh, items, authorizations: [auth], status: 'autorizada', statusHistory: [...fresh.statusHistory, { at, from: 'borrador', to: 'autorizada', userId: ctx.user.id, note: `Cotización ${q.folio} aprobada` }], updatedAt: at })
    await ctx.db.quotations.put({ ...q, status: 'convertida', workOrderId: ord.id, updatedAt: at })
    await audit(ctx, 'cotizacion.convertida', 'cotizacion', q.id, { after: { orden: ord.folio, version: q.approvedVersion, totalCents: total } })
    return (await ctx.db.workOrders.get(ord.id))!
  })
}
export type { QuoteVersion }
