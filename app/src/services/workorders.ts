import { netPrice, taxRateOf } from '../domain/alerts'
import { saleBalance } from '../domain/finance'
import { hourlyLaborCost, laborCostForMinutes, minutesBetween } from '../domain/labor'
import { lineAmounts } from '../domain/lines'
import { round, round3 } from '../domain/money'
import { canTransition, OPEN_STATUSES, STATUS_LABEL } from '../domain/orders'
import type { Authorization, ItemType, OrderStatus, Sale, TimeEntry, WorkItem, WorkOrder } from '../domain/types'
import { audit, allowed, fail, getSettings, load, need, nextFolio, once, requireNonNegative, requirePositive, requireText, stamp, trim, tx, uid, type Ctx } from './core'
import { moveOut, returnOut } from './inventory'
import { issueSaleFromOrder } from './sales'
import { recordLedger } from './cash'

const FROZEN: OrderStatus[] = ['entregada', 'cancelada']
async function getOrder(ctx: Ctx, id: string): Promise<WorkOrder> {
  const o = await load(ctx, ctx.db.workOrders, id, 'La orden')
  // Un mecánico solo trabaja sobre sus órdenes asignadas.
  if (!allowed(ctx, 'ordenes.ver_todas') && o.mechanicId && ctx.user.employeeId !== o.mechanicId) fail('Esta orden no está asignada a ti.')
  if (!allowed(ctx, 'ordenes.ver_todas') && !o.mechanicId) fail('Esta orden no está asignada a ti.')
  return o
}
async function put(ctx: Ctx, o: WorkOrder): Promise<WorkOrder> { const n = { ...o, updatedAt: stamp(ctx) }; await ctx.db.workOrders.put(n); return n }
function mutable(o: WorkOrder) { if (FROZEN.includes(o.status)) fail(`La orden está ${STATUS_LABEL[o.status].toLowerCase()} y ya no se puede modificar.`) }
const itemOf = (o: WorkOrder, id: string): WorkItem => o.items.find((i) => i.id === id) ?? fail('La partida no existe en la orden.')

/* ───────── Alta y edición ───────── */
export interface OrderInput {
  customerId: string; vehicleId: string; km: number; fuelLevel?: string; complaint: string; symptoms?: string; inspection?: string; diagnosis?: string
  damages?: string; accessories?: string; mechanicId?: string; priority?: WorkOrder['priority']; promisedAt?: string
  notesInternal?: string; notesCustomer?: string; appointmentId?: string; quotationId?: string
}
export async function createOrder(ctx: Ctx, i: OrderInput): Promise<WorkOrder> {
  need(ctx, 'ordenes.crear')
  requireText(i.complaint, 'El motivo de ingreso'); requireNonNegative(i.km, 'El kilometraje')
  return tx(ctx, async () => {
    await load(ctx, ctx.db.customers, i.customerId, 'El cliente')
    const v = await load(ctx, ctx.db.vehicles, i.vehicleId, 'El vehículo')
    if (v.customerId !== i.customerId) fail('El vehículo no pertenece a ese cliente.')
    if (i.mechanicId) await load(ctx, ctx.db.employees, i.mechanicId, 'El mecánico')
    const at = stamp(ctx)
    const o: WorkOrder = {
      id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, folio: await nextFolio(ctx, 'orden'), status: 'borrador', customerId: i.customerId, vehicleId: i.vehicleId, receivedAt: at,
      km: i.km, fuelLevel: i.fuelLevel ?? '', complaint: trim(i.complaint), symptoms: trim(i.symptoms), inspection: trim(i.inspection), diagnosis: trim(i.diagnosis), damages: trim(i.damages), accessories: trim(i.accessories),
      mechanicId: i.mechanicId || undefined, priority: i.priority ?? 'normal', promisedAt: i.promisedAt, notesInternal: trim(i.notesInternal), notesCustomer: trim(i.notesCustomer),
      items: [], timeEntries: [], statusHistory: [{ at, from: null, to: 'borrador', userId: ctx.user.id, note: 'Orden creada' }], authorizations: [], photoIds: [],
      quotationId: i.quotationId, appointmentId: i.appointmentId, isWarranty: false, waitingParts: false,
    }
    await ctx.db.workOrders.add(o)
    if (i.km > v.km) await ctx.db.vehicles.put({ ...v, km: i.km, updatedAt: at })
    if (i.appointmentId) { const a = await ctx.db.appointments.get(i.appointmentId); if (a) await ctx.db.appointments.put({ ...a, status: 'convertida', workOrderId: o.id, updatedAt: at }) }
    await audit(ctx, 'orden.creada', 'orden', o.id, { after: { folio: o.folio, customerId: o.customerId, vehicleId: o.vehicleId } })
    return o
  })
}

export type OrderPatch = Partial<Pick<WorkOrder, 'km' | 'fuelLevel' | 'complaint' | 'symptoms' | 'inspection' | 'diagnosis' | 'damages' | 'accessories' | 'mechanicId' | 'priority' | 'promisedAt' | 'notesInternal' | 'notesCustomer'>>
export async function updateOrder(ctx: Ctx, id: string, p: OrderPatch): Promise<WorkOrder> {
  need(ctx, 'ordenes.editar')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, id)
    mutable(o)
    if (p.mechanicId !== undefined && p.mechanicId !== o.mechanicId) {
      if (!allowed(ctx, 'ordenes.crear')) fail('No tienes permiso para reasignar mecánico.')
      if (p.mechanicId) await load(ctx, ctx.db.employees, p.mechanicId, 'El mecánico')
    }
    if (p.complaint !== undefined) requireText(p.complaint, 'El motivo de ingreso')
    if (p.km !== undefined) requireNonNegative(p.km, 'El kilometraje')
    const next = await put(ctx, { ...o, ...p, mechanicId: p.mechanicId === undefined ? o.mechanicId : p.mechanicId || undefined })
    if (p.mechanicId !== undefined && p.mechanicId !== o.mechanicId) await audit(ctx, 'orden.mecanico_asignado', 'orden', id, { before: { mechanicId: o.mechanicId }, after: { mechanicId: next.mechanicId } })
    return next
  })
}

/* ───────── Partidas ───────── */
export interface ItemSpec {
  type: ItemType; refId?: string; description?: string; qty: number; unitPriceCents?: number; discountCents?: number; taxRate?: number; stdHours?: number; mechanicId?: string; costCents?: number
}
export async function addItem(ctx: Ctx, orderId: string, sp: ItemSpec): Promise<WorkItem> {
  need(ctx, 'ordenes.editar')
  requirePositive(sp.qty, 'La cantidad')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, orderId)
    mutable(o)
    const s = await getSettings(ctx)
    let description = trim(sp.description), unit = 'pza', price = sp.unitPriceCents, rate = sp.taxRate, std = sp.stdHours ?? 0
    if (sp.type === 'servicio' && sp.refId) {
      const d = await load(ctx, ctx.db.services, sp.refId, 'El servicio')
      description ||= d.name; unit = 'servicio'; price ??= d.priceCents; rate ??= taxRateOf(s, d.taxId); std = sp.stdHours ?? d.stdHours
    } else if ((sp.type === 'refaccion' || sp.type === 'consumible') && sp.refId) {
      const p = await load(ctx, ctx.db.products, sp.refId, 'El producto')
      description ||= p.name; unit = p.unit; price ??= p.priceCents; rate ??= taxRateOf(s, p.taxId)
    } else if (sp.type === 'servicio' || sp.type === 'externo') unit = 'servicio'
    if (!description) fail('Describe la partida.')
    if (sp.type === 'externo') requireNonNegative(sp.costCents ?? 0, 'El costo del servicio externo')
    // Garantía: el cliente no paga, pero el costo se registra.
    price = o.isWarranty ? 0 : price ?? 0
    const disc = o.isWarranty ? 0 : sp.discountCents ?? 0
    requireNonNegative(price, 'El precio')
    if (disc < 0 || disc > Math.round(sp.qty * price)) fail('El descuento no puede ser negativo ni superar el importe de la partida.')
    const item: WorkItem = {
      id: uid(), type: sp.type, refId: sp.refId, description, qty: sp.qty, unit, unitPriceCents: price, discountCents: disc, taxRate: rate ?? taxRateOf(s, s.defaultTaxId),
      status: o.isWarranty || !s.requireAuthorization ? 'autorizado' : 'sugerido', costCents: sp.type === 'externo' ? 0 : 0, movementIds: [], stdHours: std, mechanicId: sp.mechanicId, consumedQty: 0,
      note: sp.type === 'externo' && sp.costCents ? `Costo proveedor estimado: ${(sp.costCents / 100).toFixed(2)}` : undefined,
    }
    await put(ctx, { ...o, items: [...o.items, item] })
    if (disc > 0) await audit(ctx, 'orden.descuento', 'orden', orderId, { after: { partida: description, descuentoCents: disc } })
    return item
  })
}

export interface ItemPatch { description?: string; qty?: number; unitPriceCents?: number; discountCents?: number; stdHours?: number; mechanicId?: string }
export async function updateItem(ctx: Ctx, orderId: string, itemId: string, p: ItemPatch): Promise<void> {
  need(ctx, 'ordenes.editar')
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    const it = itemOf(o, itemId)
    if (it.status === 'ejecutado') fail('La partida ya fue ejecutada; no se puede modificar.')
    const qty = p.qty ?? it.qty, price = o.isWarranty ? 0 : p.unitPriceCents ?? it.unitPriceCents, disc = o.isWarranty ? 0 : p.discountCents ?? it.discountCents
    requirePositive(qty, 'La cantidad'); requireNonNegative(price, 'El precio')
    if (qty < it.consumedQty) fail(`Ya se consumieron ${it.consumedQty}; devuelve al inventario antes de reducir la cantidad.`)
    if (disc < 0 || disc > Math.round(qty * price)) fail('El descuento no puede ser negativo ni superar el importe de la partida.')
    const money = qty !== it.qty || price !== it.unitPriceCents || disc !== it.discountCents
    // Cambiar importes de lo ya autorizado exige nueva autorización.
    const status = money && it.status === 'autorizado' ? 'cotizado' : it.status
    const next: WorkItem = { ...it, description: trim(p.description) || it.description, qty, unitPriceCents: price, discountCents: disc, stdHours: p.stdHours ?? it.stdHours, mechanicId: p.mechanicId ?? it.mechanicId, status }
    await put(ctx, { ...o, items: o.items.map((x) => (x.id === itemId ? next : x)) })
    if (money) await audit(ctx, 'orden.partida_modificada', 'orden', orderId, { before: { partida: it.description, qty: it.qty, unitPriceCents: it.unitPriceCents, discountCents: it.discountCents, status: it.status }, after: { qty, unitPriceCents: price, discountCents: disc, status } })
  })
}

export async function removeItem(ctx: Ctx, orderId: string, itemId: string): Promise<void> {
  need(ctx, 'ordenes.editar')
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    const it = itemOf(o, itemId)
    if (it.consumedQty > 0) fail('La partida tiene refacciones consumidas: devuélvelas al inventario antes de quitarla.')
    if (it.status === 'ejecutado') fail('La partida ya fue ejecutada; no se puede quitar.')
    if (it.status === 'autorizado' && !allowed(ctx, 'ordenes.autorizar')) fail('Una partida autorizada solo la puede quitar quien autoriza.')
    await put(ctx, { ...o, items: o.items.filter((x) => x.id !== itemId) })
    await audit(ctx, 'orden.partida_eliminada', 'orden', orderId, { before: { partida: it.description, status: it.status, totalCents: lineAmounts(it, (await getSettings(ctx)).pricesIncludeTax).totalCents } })
  })
}

export interface AuthInput { itemIds: string[]; approvedBy: string; via: Authorization['via']; notes?: string; quotationId?: string; quotationVersion?: number }
/** Registra quién autorizó, cuándo, por qué importe y (si aplica) qué versión de la cotización se aceptó. */
export async function authorizeItems(ctx: Ctx, orderId: string, a: AuthInput): Promise<Authorization> {
  need(ctx, 'ordenes.autorizar')
  const approvedBy = requireText(a.approvedBy, 'El nombre de quien autoriza')
  if (!a.itemIds.length) fail('Selecciona al menos una partida a autorizar.')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    const s = await getSettings(ctx)
    const at = stamp(ctx)
    let total = 0
    const items = o.items.map((it) => {
      if (!a.itemIds.includes(it.id)) return it
      if (it.status !== 'sugerido' && it.status !== 'cotizado') fail(`«${it.description}» ya está ${it.status}.`)
      total += lineAmounts(it, s.pricesIncludeTax).totalCents
      return { ...it, status: 'autorizado' as const, authorizedAt: at, authorizedBy: approvedBy }
    })
    const auth: Authorization = { id: uid(), at, userId: ctx.user.id, approvedBy, via: a.via, amountCents: total, itemIds: a.itemIds, quotationId: a.quotationId, quotationVersion: a.quotationVersion, notes: trim(a.notes) }
    let status = o.status
    const history = [...o.statusHistory]
    if (['borrador', 'pendiente_autorizacion', 'en_diagnostico', 'espera_diagnostico'].includes(o.status)) {
      status = 'autorizada'; history.push({ at, from: o.status, to: 'autorizada', userId: ctx.user.id, note: `Autorizado por ${approvedBy}` })
    }
    const timeEntries = status !== o.status ? closeWaits(o.timeEntries, at) : o.timeEntries
    await put(ctx, { ...o, items, status, statusHistory: history, authorizations: [...o.authorizations, auth], timeEntries })
    await audit(ctx, 'orden.autorizacion', 'orden', orderId, { after: { approvedBy, via: a.via, amountCents: total, partidas: a.itemIds.length, quotationId: a.quotationId, quotationVersion: a.quotationVersion } })
    return auth
  })
}
export async function rejectItems(ctx: Ctx, orderId: string, itemIds: string[], reason: string): Promise<void> {
  need(ctx, 'ordenes.autorizar')
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    const items = o.items.map((it) => {
      if (!itemIds.includes(it.id)) return it
      if (it.status !== 'sugerido' && it.status !== 'cotizado') fail(`«${it.description}» ya fue ${it.status} y no se puede rechazar.`)
      return { ...it, status: 'rechazado' as const, note: trim(reason) || it.note }
    })
    await put(ctx, { ...o, items })
    await audit(ctx, 'orden.partidas_rechazadas', 'orden', orderId, { after: { itemIds }, reason: trim(reason) })
  })
}

/* ───────── Ejecución: consumo de refacciones ───────── */
const CONSUME_STATUSES: OrderStatus[] = ['autorizada', 'esperando_refacciones', 'en_reparacion', 'en_pruebas', 'en_diagnostico']
/**
 * Saca del inventario la refacción de una partida autorizada, valorada al costo promedio vigente, y congela ese costo
 * en la partida. El mismo costo no se repite: cada salida es un movimiento único ligado a la partida.
 */
export async function consumeItem(ctx: Ctx, orderId: string, itemId: string, qty?: number, opKey?: string): Promise<WorkItem> {
  need(ctx, 'ordenes.consumir')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'consumo', async () => {
      const o = await getOrder(ctx, orderId); mutable(o)
      const it = itemOf(o, itemId)
      if (it.type !== 'refaccion' && it.type !== 'consumible') fail('Solo las refacciones y consumibles salen del inventario.')
      if (!it.refId) fail('La partida no está vinculada a un producto del inventario.')
      if (it.status !== 'autorizado') fail(it.status === 'ejecutado' ? 'La partida ya fue consumida por completo.' : 'La partida debe estar autorizada antes de consumirla.')
      if (!CONSUME_STATUSES.includes(o.status)) fail(`No se puede consumir con la orden «${STATUS_LABEL[o.status]}».`)
      const remaining = round3(it.qty - it.consumedQty)
      const q = qty ?? remaining
      requirePositive(q, 'La cantidad')
      if (q > remaining + 1e-9) fail(`Solo faltan ${remaining} por consumir en esta partida.`)
      const mv = await moveOut(ctx, { productId: it.refId, qty: q, type: 'consumo_orden', refType: 'orden', refId: o.id, reason: `${o.folio} · ${it.description}` })
      const consumed = round3(it.consumedQty + q)
      const next: WorkItem = { ...it, consumedQty: consumed, movementIds: [...it.movementIds, mv.id], costCents: it.costCents - mv.totalCostCents, status: consumed >= it.qty - 1e-9 ? 'ejecutado' : 'autorizado' }
      await put(ctx, { ...o, items: o.items.map((x) => (x.id === itemId ? next : x)) })
      return { id: itemId + ':' + mv.id, item: next }
    }, async (id) => { const [oid, mid] = [orderId, id.split(':')[1]]; const o = await ctx.db.workOrders.get(oid); const it = o?.items.find((x) => x.movementIds.includes(mid)); return { id, item: it! } })
    return value.item
  })
}

/** Devuelve al inventario refacciones consumidas (al costo con que salieron). Solo antes de cobrar. */
export async function returnItemToStock(ctx: Ctx, orderId: string, itemId: string, qty: number, reason: string): Promise<WorkItem> {
  need(ctx, 'ordenes.consumir')
  requirePositive(qty, 'La cantidad')
  if (!trim(reason)) fail('Indica el motivo de la devolución al inventario.')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    if (o.saleId) fail('La orden ya tiene venta: usa una devolución sobre la venta.')
    const it = itemOf(o, itemId)
    if (qty > it.consumedQty + 1e-9) fail(`Solo hay ${it.consumedQty} consumidas en esta partida.`)
    // Devuelve de la salida más reciente hacia atrás, sin reutilizar movimientos ya compensados.
    const mvs = (await ctx.db.movements.bulkGet(it.movementIds)).filter(Boolean) as import('../domain/types').InventoryMovement[]
    const reversedQty = new Map<string, number>()
    for (const m of mvs) if (m.reverses) reversedQty.set(m.reverses, (reversedQty.get(m.reverses) ?? 0) + m.qty)
    let left = qty
    const newIds: string[] = []
    for (const m of mvs.filter((x) => x.qty < 0).reverse()) {
      if (left <= 1e-9) break
      const avail = round3(Math.abs(m.qty) - (reversedQty.get(m.id) ?? 0))
      if (avail <= 1e-9) continue
      const take = Math.min(avail, left)
      newIds.push((await returnOut(ctx, m, take, 'devolucion_orden', trim(reason), 'orden', o.id)).id)
      left = round3(left - take)
    }
    const all = (await ctx.db.movements.bulkGet([...it.movementIds, ...newIds])).filter(Boolean) as import('../domain/types').InventoryMovement[]
    const consumed = round3(-all.reduce((a, m) => a + m.qty, 0)), cost = -all.reduce((a, m) => a + m.totalCostCents, 0)
    const next: WorkItem = { ...it, movementIds: [...it.movementIds, ...newIds], consumedQty: consumed, costCents: cost, status: it.status === 'ejecutado' ? 'autorizado' : it.status }
    await put(ctx, { ...o, items: o.items.map((x) => (x.id === itemId ? next : x)) })
    await audit(ctx, 'orden.devolucion_inventario', 'orden', orderId, { after: { partida: it.description, qty }, reason: trim(reason) })
    return next
  })
}

/** Marca como ejecutado un servicio, cargo externo u otro concepto autorizado (el externo registra su costo real). */
export async function completeItem(ctx: Ctx, orderId: string, itemId: string, o: { costCents?: number } = {}): Promise<void> {
  need(ctx, 'ordenes.editar')
  await tx(ctx, async () => {
    const ord = await getOrder(ctx, orderId); mutable(ord)
    const it = itemOf(ord, itemId)
    if (it.type === 'refaccion' || it.type === 'consumible') fail('Las refacciones se completan al consumirlas del inventario.')
    if (it.status !== 'autorizado') fail(it.status === 'ejecutado' ? 'La partida ya está ejecutada.' : 'La partida debe estar autorizada.')
    if (it.type === 'externo') requireNonNegative(o.costCents ?? NaN, 'El costo real del servicio externo')
    const next: WorkItem = { ...it, status: 'ejecutado', costCents: it.type === 'externo' ? o.costCents! : it.costCents }
    await put(ctx, { ...ord, items: ord.items.map((x) => (x.id === itemId ? next : x)) })
    await audit(ctx, 'orden.partida_ejecutada', 'orden', orderId, { after: { partida: it.description, costCents: next.costCents } })
  })
}
export async function reopenItem(ctx: Ctx, orderId: string, itemId: string): Promise<void> {
  need(ctx, 'ordenes.editar')
  await tx(ctx, async () => {
    const ord = await getOrder(ctx, orderId); mutable(ord)
    const it = itemOf(ord, itemId)
    if (it.type === 'refaccion' || it.type === 'consumible') fail('Para deshacer una refacción devuélvela al inventario.')
    if (it.status !== 'ejecutado') fail('La partida no está ejecutada.')
    if (ord.saleId) fail('La orden ya tiene venta.')
    await put(ctx, { ...ord, items: ord.items.map((x) => (x.id === itemId ? { ...x, status: 'autorizado' as const } : x)) })
  })
}

/* ───────── Tiempos ───────── */
const WORK_STATUSES: OrderStatus[] = ['en_diagnostico', 'autorizada', 'en_reparacion', 'en_pruebas']
function closeEntry(t: TimeEntry, endAt: string): TimeEntry {
  const minutes = minutesBetween(t.startAt, endAt)
  return { ...t, endAt, minutes, costCents: t.kind === 'trabajo' ? laborCostForMinutes(minutes, t.hourlyCostCents) : 0 }
}
const closeWaits = (es: TimeEntry[], at: string): TimeEntry[] => es.map((t) => (t.kind === 'espera' && !t.endAt ? closeEntry(t, at) : t))
function checkEmployee(ctx: Ctx, employeeId: string) {
  if (!allowed(ctx, 'ordenes.ver_todas') && ctx.user.employeeId !== employeeId) fail('Solo puedes registrar tu propio tiempo.')
}
/**
 * Inicia o reanuda el trabajo de un mecánico. Un mecánico solo puede tener UN tramo abierto: al iniciar uno nuevo
 * se pausa cualquier otro en cualquier orden, así las horas efectivas nunca se cuentan dos veces.
 */
export async function startWork(ctx: Ctx, orderId: string, employeeId: string, itemId?: string): Promise<void> {
  need(ctx, 'ordenes.tiempos'); checkEmployee(ctx, employeeId)
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    if (!WORK_STATUSES.includes(o.status)) fail(`No se puede trabajar con la orden «${STATUS_LABEL[o.status]}».`)
    const s = await getSettings(ctx)
    const emp = await load(ctx, ctx.db.employees, employeeId, 'El mecánico')
    if (!emp.active) fail('El empleado está inactivo.')
    if (itemId) itemOf(o, itemId)
    const at = stamp(ctx)
    for (const other of await ctx.db.workOrders.where('status').anyOf(OPEN_STATUSES).toArray()) {
      if (!other.timeEntries.some((t) => !t.endAt && t.kind === 'trabajo' && t.employeeId === employeeId)) continue
      await ctx.db.workOrders.put({ ...other, updatedAt: at, timeEntries: other.timeEntries.map((t) => (!t.endAt && t.kind === 'trabajo' && t.employeeId === employeeId ? closeEntry(t, at) : t)) })
    }
    const fresh = await load(ctx, ctx.db.workOrders, orderId)
    const entry: TimeEntry = { id: uid(), employeeId, itemId, kind: 'trabajo', startAt: at, minutes: 0, hourlyCostCents: hourlyLaborCost(emp, s), costCents: 0 }
    await put(ctx, { ...fresh, timeEntries: [...fresh.timeEntries, entry] })
  })
}
export async function stopWork(ctx: Ctx, orderId: string, employeeId: string): Promise<void> {
  need(ctx, 'ordenes.tiempos'); checkEmployee(ctx, employeeId)
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId)
    const at = stamp(ctx)
    if (!o.timeEntries.some((t) => !t.endAt && t.kind === 'trabajo' && t.employeeId === employeeId)) fail('No hay un cronómetro abierto para este mecánico en la orden.')
    await put(ctx, { ...o, timeEntries: o.timeEntries.map((t) => (!t.endAt && t.kind === 'trabajo' && t.employeeId === employeeId ? closeEntry(t, at) : t)) })
  })
}
/** Registro manual de un tramo ya trabajado. Rechaza traslapes con otros tramos del mismo mecánico. */
export async function logManualTime(ctx: Ctx, orderId: string, employeeId: string, startAt: string, endAt: string, itemId?: string): Promise<void> {
  need(ctx, 'ordenes.tiempos'); checkEmployee(ctx, employeeId)
  const a = new Date(startAt).getTime(), b = new Date(endAt).getTime()
  if (!(a < b)) fail('La hora de fin debe ser posterior a la de inicio.')
  await tx(ctx, async () => {
    if (b > ctx.now().getTime() + 60000) fail('No se puede registrar tiempo en el futuro.')
    const o = await getOrder(ctx, orderId); mutable(o)
    const s = await getSettings(ctx)
    const emp = await load(ctx, ctx.db.employees, employeeId, 'El mecánico')
    const nowMs = ctx.now().getTime()
    for (const ord of await ctx.db.workOrders.toArray()) {
      for (const t of ord.timeEntries) {
        if (t.kind !== 'trabajo' || t.employeeId !== employeeId) continue
        const ts = new Date(t.startAt).getTime(), te = t.endAt ? new Date(t.endAt).getTime() : nowMs
        if (ts < b && te > a) fail(`El tiempo se traslapa con otro registro del mismo mecánico (${ord.folio}).`)
      }
    }
    const e = closeEntry({ id: uid(), employeeId, itemId, kind: 'trabajo', startAt: new Date(startAt).toISOString(), minutes: 0, hourlyCostCents: hourlyLaborCost(emp, s), costCents: 0 }, new Date(endAt).toISOString())
    await put(ctx, { ...o, timeEntries: [...o.timeEntries, e] })
    await audit(ctx, 'orden.tiempo_manual', 'orden', orderId, { after: { employeeId, minutes: e.minutes } })
  })
}

/* ───────── Estados ───────── */
export async function changeStatus(ctx: Ctx, orderId: string, to: OrderStatus, note = ''): Promise<WorkOrder> {
  need(ctx, 'ordenes.editar')
  if (to === 'entregada') fail('Usa «Entregar vehículo» para cerrar la orden.')
  if (to === 'cancelada') fail('Usa «Cancelar orden» e indica el motivo.')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, orderId)
    const g = canTransition(o, to)
    if (!g.ok) return fail(g.reason!)
    const at = stamp(ctx)
    let timeEntries = o.timeEntries, items = o.items
    // Tiempos de espera automáticos mientras se espera piezas o la autorización del cliente.
    const waiting = (s: OrderStatus) => s === 'esperando_refacciones' || s === 'pendiente_autorizacion'
    if (waiting(o.status) && !waiting(to)) timeEntries = closeWaits(timeEntries, at)
    if (waiting(to) && !waiting(o.status)) timeEntries = [...timeEntries, { id: uid(), employeeId: '', kind: 'espera', startAt: at, minutes: 0, hourlyCostCents: 0, costCents: 0 }]
    // Al terminar el trabajo se detienen los cronómetros abiertos.
    if (to === 'lista_entrega' || to === 'en_pruebas') timeEntries = timeEntries.map((t) => (!t.endAt && t.kind === 'trabajo' ? closeEntry(t, at) : t))
    if (to === 'pendiente_autorizacion') items = items.map((i) => (i.status === 'sugerido' ? { ...i, status: 'cotizado' as const } : i))
    const next = await put(ctx, { ...o, status: to, timeEntries, items, waitingParts: to === 'esperando_refacciones', statusHistory: [...o.statusHistory, { at, from: o.status, to, userId: ctx.user.id, note: trim(note) }] })
    await audit(ctx, 'orden.cambio_estado', 'orden', orderId, { before: { status: o.status }, after: { status: to }, reason: trim(note) || undefined })
    return next
  })
}

/** Entrega del vehículo: exige trabajos completos, emite la venta (con costos congelados) y cierra la orden. */
export async function deliverOrder(ctx: Ctx, orderId: string, o: { kmOut?: number; note?: string } = {}, opKey?: string): Promise<{ order: WorkOrder; sale: Sale }> {
  need(ctx, 'ordenes.entregar')
  return tx(ctx, async () => {
    const ord = await getOrder(ctx, orderId)
    if (ord.status === 'entregada' && ord.saleId) { const sale = (await ctx.db.sales.get(ord.saleId))!; return { order: ord, sale } }
    const g = canTransition(ord, 'entregada')
    if (!g.ok) return fail(g.reason!)
    if (o.kmOut !== undefined && o.kmOut < ord.km) fail('El kilometraje de salida no puede ser menor al de entrada.')
    const sale = await issueSaleFromOrder(ctx, orderId, {}, opKey)
    const fresh = await load(ctx, ctx.db.workOrders, orderId)
    const at = stamp(ctx)
    const next = await put(ctx, { ...fresh, status: 'entregada', deliveredAt: at, kmOut: o.kmOut ?? fresh.kmOut, saleId: sale.id, timeEntries: closeWaits(fresh.timeEntries, at), statusHistory: [...fresh.statusHistory, { at, from: fresh.status, to: 'entregada', userId: ctx.user.id, note: trim(o.note) || 'Vehículo entregado' }] })
    const v = await ctx.db.vehicles.get(fresh.vehicleId)
    if (v && o.kmOut && o.kmOut > v.km) await ctx.db.vehicles.put({ ...v, km: o.kmOut, updatedAt: at })
    if (fresh.appointmentId) { const a = await ctx.db.appointments.get(fresh.appointmentId); if (a) await ctx.db.appointments.put({ ...a, status: 'completada', updatedAt: at }) }
    await audit(ctx, 'orden.entregada', 'orden', orderId, { after: { folio: next.folio, saleId: sale.id, totalCents: sale.totalCents } })
    return { order: next, sale }
  })
}

/**
 * Cancela una orden sin borrar historial: las refacciones consumidas vuelven al inventario con su costo original.
 * Si hay anticipos, exige reembolsarlos.
 */
export async function cancelOrder(ctx: Ctx, orderId: string, reason: string, o: { refundAdvances?: boolean } = {}): Promise<void> {
  need(ctx, 'ordenes.cancelar')
  if (!trim(reason)) fail('Indica el motivo de la cancelación.')
  await tx(ctx, async () => {
    const ord = await getOrder(ctx, orderId)
    if (ord.status === 'cancelada') fail('La orden ya está cancelada.')
    if (ord.status === 'entregada') fail('Una orden entregada no se cancela; cancela primero su venta o crea una garantía.')
    if (ord.saleId) { const s = await ctx.db.sales.get(ord.saleId); if (s?.status === 'emitida') fail('La orden tiene una venta emitida: cancélala primero.') }
    const led = (await ctx.db.ledger.where('workOrderId').equals(orderId).toArray()).filter((l) => l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente')
    const reversed = new Set(led.filter((l) => l.reversalOf).map((l) => l.reversalOf))
    const advances = led.filter((l) => l.kind === 'cobro_cliente' && !reversed.has(l.id))
    if (advances.length && !o.refundAdvances) fail('La orden tiene anticipos: confirma su reembolso para cancelar.')
    for (const l of advances) await recordLedger(ctx, { kind: 'reembolso_cliente', direction: 'out', amountCents: l.amountCents, methodId: l.methodId, reference: l.reference, note: `Reembolso por cancelación ${ord.folio}`, workOrderId: orderId, customerId: l.customerId, reversalOf: l.id })
    const items: WorkItem[] = []
    for (const it of ord.items) {
      if (it.consumedQty > 0) {
        const mvs = (await ctx.db.movements.bulkGet(it.movementIds)).filter(Boolean) as import('../domain/types').InventoryMovement[]
        const back = new Map<string, number>()
        for (const m of mvs) if (m.reverses) back.set(m.reverses, (back.get(m.reverses) ?? 0) + m.qty)
        const ids = [...it.movementIds]
        for (const m of mvs.filter((x) => x.qty < 0)) {
          const avail = round3(Math.abs(m.qty) - (back.get(m.id) ?? 0))
          if (avail > 1e-9) ids.push((await returnOut(ctx, m, avail, 'devolucion_orden', `Cancelación ${ord.folio}`, 'orden', ord.id)).id)
        }
        items.push({ ...it, movementIds: ids, consumedQty: 0, costCents: 0, status: it.status === 'ejecutado' ? 'autorizado' : it.status })
      } else items.push(it)
    }
    const at = stamp(ctx)
    await put(ctx, { ...ord, items, status: 'cancelada', cancelReason: trim(reason), timeEntries: ord.timeEntries.map((t) => (!t.endAt ? closeEntry(t, at) : t)), statusHistory: [...ord.statusHistory, { at, from: ord.status, to: 'cancelada', userId: ctx.user.id, note: trim(reason) }] })
    await audit(ctx, 'orden.cancelada', 'orden', orderId, { before: { status: ord.status }, reason: trim(reason) })
  })
}

/** Nueva orden de garantía/retrabajo sobre una orden entregada: sin cobro, pero con su costo registrado. */
export async function createWarrantyOrder(ctx: Ctx, originalId: string, complaint: string): Promise<WorkOrder> {
  need(ctx, 'ordenes.crear')
  requireText(complaint, 'El motivo de la garantía')
  return tx(ctx, async () => {
    const orig = await load(ctx, ctx.db.workOrders, originalId, 'La orden original')
    if (orig.status !== 'entregada') fail('Solo se puede abrir garantía sobre una orden entregada.')
    const at = stamp(ctx)
    const o: WorkOrder = {
      ...orig, id: uid(), createdAt: at, updatedAt: at, folio: await nextFolio(ctx, 'orden'), status: 'autorizada', receivedAt: at, complaint: trim(complaint), symptoms: '', inspection: '', diagnosis: '',
      items: [], timeEntries: [], authorizations: [], photoIds: [], quotationId: undefined, appointmentId: undefined, saleId: undefined, deliveredAt: undefined, kmOut: undefined, cancelReason: undefined,
      isWarranty: true, warrantyOfOrderId: orig.id, waitingParts: false, notesCustomer: `Garantía de ${orig.folio}`, notesInternal: '',
      statusHistory: [{ at, from: null, to: 'autorizada', userId: ctx.user.id, note: `Garantía de ${orig.folio}` }],
    }
    await ctx.db.workOrders.add(o)
    await audit(ctx, 'orden.garantia', 'orden', o.id, { after: { folio: o.folio, original: orig.folio }, reason: trim(complaint) })
    return o
  })
}

/** Fotos y documentos de la orden (el UI los comprime antes; aquí solo se limita el tamaño). */
export async function attachPhoto(ctx: Ctx, orderId: string, f: { name: string; mime: string; dataUrl: string }): Promise<string> {
  need(ctx, 'ordenes.editar')
  if (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(f.dataUrl)) fail('Formato no permitido (usa JPG, PNG, WebP o PDF).')
  if (f.dataUrl.length > 3_000_000) fail('El archivo es demasiado grande (máximo ≈ 2 MB).')
  return tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    const id = uid()
    await ctx.db.attachments.add({ id, orgId: ctx.orgId, ownerType: 'orden', ownerId: orderId, name: trim(f.name) || 'foto', mime: f.mime, size: f.dataUrl.length, dataUrl: f.dataUrl, createdAt: stamp(ctx) })
    await put(ctx, { ...o, photoIds: [...o.photoIds, id] })
    return id
  })
}
export async function removePhoto(ctx: Ctx, orderId: string, photoId: string): Promise<void> {
  need(ctx, 'ordenes.editar')
  await tx(ctx, async () => {
    const o = await getOrder(ctx, orderId); mutable(o)
    await ctx.db.attachments.delete(photoId)
    await put(ctx, { ...o, photoIds: o.photoIds.filter((x) => x !== photoId) })
  })
}

/** Importe pendiente de una orden entregada o con anticipos (para el resumen). */
export async function orderBalance(ctx: Ctx, o: WorkOrder): Promise<{ paidCents: number; balanceCents: number | null }> {
  const led = (await ctx.db.ledger.where('kind').anyOf('cobro_cliente', 'reembolso_cliente').toArray())
  const sale = o.saleId ? await ctx.db.sales.get(o.saleId) : undefined
  if (sale) return { paidCents: sale.totalCents - saleBalance(sale, led), balanceCents: saleBalance(sale, led) }
  const paid = led.filter((l) => l.workOrderId === o.id).reduce((a, l) => a + (l.direction === 'in' ? l.amountCents : -l.amountCents), 0)
  return { paidCents: paid, balanceCents: null }
}
export { round, netPrice }
