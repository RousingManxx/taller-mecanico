import { netPrice, taxRateOf } from '../domain/alerts'
import { addDays } from '../domain/dates'
import { payStatus, saleBalance, salePaid, saleReturnsTotal } from '../domain/finance'
import { hourlyLaborCost, laborCostForMinutes } from '../domain/labor'
import { lineAmounts, sumLines } from '../domain/lines'
import { round } from '../domain/money'
import { billableItems } from '../domain/orders'
import type { ISODate, ItemType, LedgerEntry, Sale, SaleItem, SaleReturn, WorkOrder } from '../domain/types'
import { audit, fail, getSettings, load, need, nextFolio, once, requirePositive, stamp, today, trim, tx, uid, type Ctx } from './core'
import { moveIn, moveOut } from './inventory'
import { recordLedger } from './cash'

async function saleLedger(ctx: Ctx): Promise<LedgerEntry[]> { return ctx.db.ledger.where('kind').anyOf('cobro_cliente', 'reembolso_cliente').toArray() }

/* ───────── Venta a partir de una orden ───────── */
/**
 * Emite la venta de una orden. Cada partida congela su precio, impuesto y COSTO en ese momento (costo de salida real
 * de inventario para refacciones; mano de obra imputada con las horas registradas). Una orden tiene una sola venta.
 */
export async function issueSaleFromOrder(ctx: Ctx, orderId: string, o: { dueDate?: ISODate } = {}, opKey?: string): Promise<Sale> {
  need(ctx, 'ventas.crear')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'venta', async () => {
      const order = await load(ctx, ctx.db.workOrders, orderId, 'La orden')
      if (order.saleId) { const ex = await ctx.db.sales.get(order.saleId); if (ex && ex.status === 'emitida') return ex }
      if (order.status === 'cancelada') fail('La orden está cancelada.')
      const items = billableItems(order)
      if (!items.length && !order.isWarranty) fail('La orden no tiene partidas autorizadas para cobrar.')
      const s = await getSettings(ctx)
      const emps = await ctx.db.employees.toArray()
      const now = stamp(ctx)
      // Mano de obra imputada: tiempos cerrados de la orden, ligados a su partida o repartidos entre las de servicio.
      const entries = order.timeEntries.filter((t) => t.kind === 'trabajo')
      const open = entries.filter((t) => !t.endAt)
      if (open.length) fail('Hay un cronómetro abierto en la orden: deténlo antes de cobrar.')
      const linked = new Map<string, { cost: number; minutes: number }>()
      let unlinkedCost = 0, unlinkedMin = 0
      for (const t of entries) {
        if (t.itemId && items.some((i) => i.id === t.itemId)) { const c = linked.get(t.itemId) ?? { cost: 0, minutes: 0 }; linked.set(t.itemId, { cost: c.cost + t.costCents, minutes: c.minutes + t.minutes }) }
        else { unlinkedCost += t.costCents; unlinkedMin += t.minutes }
      }
      const svc = items.filter((i) => i.type === 'servicio')
      const svcAmt = svc.map((i) => lineAmounts(i, s.pricesIncludeTax).netCents)
      const svcTotal = svcAmt.reduce((a, b) => a + b, 0)
      const hasRealTime = entries.length > 0
      const saleItems: SaleItem[] = []
      let costLeft = unlinkedCost, minLeft = unlinkedMin, svcSeen = 0
      let otherCost = 0
      for (const it of items) {
        const a = lineAmounts(it, s.pricesIncludeTax)
        let cost = it.costCents, estimated = false, hours = 0
        if (it.type === 'servicio') {
          svcSeen++
          const l = linked.get(it.id) ?? { cost: 0, minutes: 0 }
          const lastSvc = svcSeen === svc.length
          const share = lastSvc ? costLeft : svcTotal > 0 ? round((unlinkedCost * a.netCents) / svcTotal) : round(unlinkedCost / svc.length)
          const mshare = lastSvc ? minLeft : svcTotal > 0 ? Math.round((unlinkedMin * a.netCents) / svcTotal) : Math.round(unlinkedMin / svc.length)
          costLeft -= share; minLeft -= mshare
          cost = l.cost + share; hours = (l.minutes + mshare) / 60
          if (!hasRealTime && it.stdHours > 0) {
            const emp = emps.find((e) => e.id === (it.mechanicId ?? order.mechanicId))
            hours = it.stdHours * it.qty
            cost = emp ? laborCostForMinutes(hours * 60, hourlyLaborCost(emp, s)) : 0
            estimated = true
          }
        }
        saleItems.push({
          id: uid(), type: it.type, refId: it.refId, description: it.description, qty: it.qty, unit: it.unit, unitPriceCents: it.unitPriceCents, discountCents: it.discountCents, taxRate: it.taxRate,
          netCents: a.netCents, taxCents: a.taxCents, totalCents: a.totalCents, costCents: cost, costEstimated: estimated, movementIds: it.movementIds, mechanicId: it.mechanicId ?? order.mechanicId, stdHours: it.stdHours, hours,
        })
      }
      if (!svc.length) otherCost = unlinkedCost
      const tot = sumLines(saleItems)
      const cust = await ctx.db.customers.get(order.customerId)
      const date = today(ctx)
      const sale: Sale = {
        id: uid(), orgId: ctx.orgId, createdAt: now, updatedAt: now, folio: await nextFolio(ctx, 'venta'), kind: 'orden', status: 'emitida', workOrderId: order.id, customerId: order.customerId, customerName: cust?.name ?? '—',
        date, dueDate: o.dueDate ?? date, items: saleItems, netCents: tot.netCents, taxCents: tot.taxCents, totalCents: tot.totalCents,
        costCents: saleItems.reduce((a, i) => a + i.costCents, 0) + otherCost, otherCostCents: otherCost, laborHours: saleItems.reduce((a, i) => a + i.hours, 0) + (svc.length ? 0 : unlinkedMin / 60), returns: [], notes: '', userId: ctx.user.id, opKey,
      }
      await ctx.db.sales.add(sale)
      await ctx.db.workOrders.put({ ...order, saleId: sale.id, updatedAt: now })
      await audit(ctx, 'venta.emitida', 'venta', sale.id, { after: { folio: sale.folio, orden: order.folio, totalCents: sale.totalCents, costCents: sale.costCents } })
      return sale
    }, (id) => ctx.db.sales.get(id) as Promise<Sale>)
    return value
  })
}

/* ───────── Venta de mostrador ───────── */
export type CounterLine =
  | { kind: 'producto'; productId: string; qty: number; unitPriceCents?: number; discountCents?: number }
  | { kind: 'servicio'; serviceId: string; qty: number; unitPriceCents?: number; discountCents?: number; mechanicId?: string }
  | { kind: 'libre'; description: string; qty: number; unitPriceCents: number; discountCents?: number; taxRate?: number; costCents?: number }
export interface CounterSaleInput { customerId?: string; customerName?: string; lines: CounterLine[]; dueDate?: ISODate; notes?: string; payments?: { methodId: string; amountCents: number; reference?: string }[] }

/** Venta directa de refacciones o servicios independientes. Descuenta inventario y congela el costo de salida. */
export async function createCounterSale(ctx: Ctx, i: CounterSaleInput, opKey?: string): Promise<Sale> {
  need(ctx, 'ventas.crear')
  if (!i.lines.length) fail('Agrega al menos una partida a la venta.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'venta', async () => {
      const s = await getSettings(ctx)
      const emps = await ctx.db.employees.toArray()
      const saleId = uid(), now = stamp(ctx), date = today(ctx)
      const items: SaleItem[] = []
      for (const l of i.lines) {
        requirePositive(l.qty, 'La cantidad')
        const disc = l.discountCents ?? 0
        if (disc < 0) fail('El descuento no puede ser negativo.')
        if (l.kind === 'producto') {
          const p = await load(ctx, ctx.db.products, l.productId, 'El producto')
          if (!p.active) fail(`${p.name} está inactivo.`)
          const price = l.unitPriceCents ?? p.priceCents, rate = taxRateOf(s, p.taxId)
          if (disc > Math.round(l.qty * price)) fail(`El descuento de ${p.name} supera el importe de la partida.`)
          const mv = await moveOut(ctx, { productId: p.id, qty: l.qty, type: 'venta', refType: 'venta', refId: saleId, reason: 'Venta de mostrador' })
          const a = lineAmounts({ qty: l.qty, unitPriceCents: price, discountCents: disc, taxRate: rate }, s.pricesIncludeTax)
          items.push({ id: uid(), type: p.type, refId: p.id, description: p.name, qty: l.qty, unit: p.unit, unitPriceCents: price, discountCents: disc, taxRate: rate, ...a, costCents: -mv.totalCostCents, costEstimated: false, movementIds: [mv.id], stdHours: 0, hours: 0 })
        } else if (l.kind === 'servicio') {
          const d = await load(ctx, ctx.db.services, l.serviceId, 'El servicio')
          const price = l.unitPriceCents ?? d.priceCents, rate = taxRateOf(s, d.taxId)
          if (disc > Math.round(l.qty * price)) fail(`El descuento de ${d.name} supera el importe de la partida.`)
          const emp = emps.find((e) => e.id === l.mechanicId)
          const hours = d.stdHours * l.qty
          const a = lineAmounts({ qty: l.qty, unitPriceCents: price, discountCents: disc, taxRate: rate }, s.pricesIncludeTax)
          items.push({ id: uid(), type: 'servicio', refId: d.id, description: d.name, qty: l.qty, unit: 'servicio', unitPriceCents: price, discountCents: disc, taxRate: rate, ...a, costCents: emp ? laborCostForMinutes(hours * 60, hourlyLaborCost(emp, s)) : 0, costEstimated: true, movementIds: [], mechanicId: emp?.id, stdHours: d.stdHours, hours })
        } else {
          const rate = l.taxRate ?? taxRateOf(s, s.defaultTaxId)
          if (!trim(l.description)) fail('Describe la partida libre.')
          if (disc > Math.round(l.qty * l.unitPriceCents)) fail('El descuento supera el importe de la partida.')
          const a = lineAmounts({ qty: l.qty, unitPriceCents: l.unitPriceCents, discountCents: disc, taxRate: rate }, s.pricesIncludeTax)
          items.push({ id: uid(), type: 'otro', description: trim(l.description), qty: l.qty, unit: 'pza', unitPriceCents: l.unitPriceCents, discountCents: disc, taxRate: rate, ...a, costCents: l.costCents ?? 0, costEstimated: l.costCents === undefined, movementIds: [], stdHours: 0, hours: 0 })
        }
      }
      const tot = sumLines(items)
      const cust = i.customerId ? await load(ctx, ctx.db.customers, i.customerId, 'El cliente') : null
      const due = i.dueDate ?? date
      if (due < date) fail('El vencimiento no puede ser anterior a hoy.')
      const sale: Sale = {
        id: saleId, orgId: ctx.orgId, createdAt: now, updatedAt: now, folio: await nextFolio(ctx, 'venta'), kind: 'mostrador', status: 'emitida', customerId: cust?.id, customerName: cust?.name ?? (trim(i.customerName) || 'Público en general'),
        date, dueDate: due, items, netCents: tot.netCents, taxCents: tot.taxCents, totalCents: tot.totalCents, costCents: items.reduce((a, x) => a + x.costCents, 0), otherCostCents: 0,
        laborHours: items.reduce((a, x) => a + x.hours, 0), returns: [], notes: trim(i.notes), userId: ctx.user.id, opKey,
      }
      await ctx.db.sales.add(sale)
      await audit(ctx, 'venta.emitida', 'venta', sale.id, { after: { folio: sale.folio, totalCents: sale.totalCents, costCents: sale.costCents } })
      if (items.some((x) => x.discountCents > 0)) await audit(ctx, 'venta.descuento', 'venta', sale.id, { after: { descuentoCents: items.reduce((a, x) => a + x.discountCents, 0) } })
      let paid = 0
      for (const p of i.payments ?? []) {
        if (p.amountCents <= 0) continue
        paid += p.amountCents
        if (paid > sale.totalCents) fail('Los pagos superan el total de la venta.')
        await recordLedger(ctx, { kind: 'cobro_cliente', direction: 'in', amountCents: p.amountCents, methodId: p.methodId, reference: trim(p.reference), note: sale.folio, saleId: sale.id, customerId: sale.customerId })
      }
      if (paid > 0) await audit(ctx, 'pago.registrado', 'venta', sale.id, { after: { amountCents: paid } })
      return sale
    }, (id) => ctx.db.sales.get(id) as Promise<Sale>)
    return value
  })
}

/* ───────── Cobros ───────── */
export interface PaymentInput { saleId?: string; workOrderId?: string; amountCents: number; methodId: string; reference?: string; date?: ISODate; note?: string }
/**
 * Registra un cobro. Nunca supera el saldo de la venta. Un cobro sobre una orden sin venta es un anticipo y queda
 * identificado hasta que la venta lo absorba. Con la misma `opKey` no se duplica.
 */
export async function registerPayment(ctx: Ctx, i: PaymentInput, opKey?: string): Promise<LedgerEntry> {
  need(ctx, 'cobros.registrar')
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) fail('El importe debe ser mayor que cero.')
  if (!i.saleId && !i.workOrderId) fail('Indica la venta u orden a la que corresponde el cobro.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'cobro', async () => {
      const led = await saleLedger(ctx)
      let customerId: string | undefined, saleId = i.saleId, workOrderId = i.workOrderId, note = trim(i.note)
      if (saleId) {
        const sale = await load(ctx, ctx.db.sales, saleId, 'La venta')
        if (sale.status === 'cancelada') fail('La venta está cancelada.')
        const bal = saleBalance(sale, led)
        if (bal <= 0) fail('La venta ya está pagada.')
        if (i.amountCents > bal) fail(`El cobro (${(i.amountCents / 100).toFixed(2)}) supera el saldo pendiente (${(bal / 100).toFixed(2)}).`)
        customerId = sale.customerId; note ||= sale.folio
        workOrderId = undefined
      } else {
        const o = await load(ctx, ctx.db.workOrders, workOrderId!, 'La orden')
        if (o.status === 'cancelada') fail('La orden está cancelada.')
        if (o.saleId) {
          const sale = await ctx.db.sales.get(o.saleId)
          if (sale && sale.status === 'emitida') {
            const bal = saleBalance(sale, led)
            if (i.amountCents > bal) fail(`El cobro supera el saldo pendiente (${(bal / 100).toFixed(2)}).`)
          }
        }
        customerId = o.customerId; note ||= `Anticipo ${o.folio}`
      }
      const e = await recordLedger(ctx, { kind: 'cobro_cliente', direction: 'in', amountCents: i.amountCents, methodId: i.methodId, reference: trim(i.reference), note, saleId, workOrderId, customerId, date: i.date, opKey })
      await audit(ctx, 'pago.registrado', saleId ? 'venta' : 'orden', saleId ?? workOrderId!, { after: { amountCents: i.amountCents, methodId: i.methodId } })
      return e
    }, (id) => ctx.db.ledger.get(id) as Promise<LedgerEntry>)
    return value
  })
}

/** Anula un cobro con un movimiento inverso (el original se conserva). */
export async function voidPayment(ctx: Ctx, ledgerId: string, reason: string): Promise<LedgerEntry> {
  need(ctx, 'ventas.cancelar')
  if (!trim(reason)) fail('Indica el motivo de la anulación.')
  return tx(ctx, async () => {
    const orig = await load(ctx, ctx.db.ledger, ledgerId, 'El cobro')
    if (orig.kind !== 'cobro_cliente') fail('Solo se pueden anular cobros de clientes.')
    if ((await ctx.db.ledger.filter((l) => l.reversalOf === ledgerId).count()) > 0) fail('Este cobro ya fue anulado.')
    const rev = await recordLedger(ctx, { kind: 'reembolso_cliente', direction: 'out', amountCents: orig.amountCents, methodId: orig.methodId, reference: orig.reference, note: `Anulación: ${trim(reason)}`, saleId: orig.saleId, workOrderId: orig.workOrderId, customerId: orig.customerId, reversalOf: orig.id })
    await audit(ctx, 'pago.anulado', 'venta', orig.saleId ?? orig.workOrderId ?? '', { before: { amountCents: orig.amountCents }, reason: trim(reason) })
    return rev
  })
}

async function refundNet(ctx: Ctx, sale: Sale, reason: string): Promise<number> {
  const led = (await saleLedger(ctx)).filter((l) => l.saleId === sale.id || (!l.saleId && sale.workOrderId && l.workOrderId === sale.workOrderId))
  const reversed = new Set(led.filter((l) => l.reversalOf).map((l) => l.reversalOf))
  let total = 0
  for (const l of led) {
    if (l.kind !== 'cobro_cliente' || reversed.has(l.id)) continue
    await recordLedger(ctx, { kind: 'reembolso_cliente', direction: 'out', amountCents: l.amountCents, methodId: l.methodId, reference: l.reference, note: `Reembolso: ${reason}`, saleId: l.saleId, workOrderId: l.workOrderId, customerId: l.customerId, reversalOf: l.id })
    total += l.amountCents
  }
  return total
}

/**
 * Cancela una venta conservando el historial. Devuelve al inventario las salidas de una venta de mostrador (al costo original);
 * en una venta de orden, la orden vuelve a «lista para entrega». Si hubo cobros, exige reembolsarlos.
 */
export async function cancelSale(ctx: Ctx, saleId: string, reason: string, o: { refund?: boolean } = {}): Promise<void> {
  need(ctx, 'ventas.cancelar')
  if (!trim(reason)) fail('Indica el motivo de la cancelación.')
  await tx(ctx, async () => {
    const sale = await load(ctx, ctx.db.sales, saleId, 'La venta')
    if (sale.status === 'cancelada') fail('La venta ya está cancelada.')
    const led = await saleLedger(ctx)
    const paid = salePaid(sale, led)
    if (paid > 0 && !o.refund) fail('La venta tiene cobros registrados: confirma el reembolso para cancelarla.')
    if (paid > 0) await refundNet(ctx, sale, trim(reason)) // el reembolso en efectivo exige caja abierta (lo valida recordLedger)
    if (sale.kind === 'mostrador') {
      for (const it of sale.items) {
        const returned = sale.returns.filter((r) => r.itemId === it.id)
        const qtyLeft = it.qty - returned.reduce((a, r) => a + r.qty, 0)
        const costLeft = it.costCents - returned.reduce((a, r) => a + r.costRecoveredCents, 0)
        if (it.refId && it.movementIds.length && qtyLeft > 0) await moveIn(ctx, { productId: it.refId, qty: qtyLeft, totalCostCents: costLeft, type: 'devolucion_cliente', refType: 'cancelacion_venta', refId: sale.id, reason: `Cancelación ${sale.folio}`, reverses: it.movementIds[0] })
      }
    } else if (sale.workOrderId) {
      const ord = await ctx.db.workOrders.get(sale.workOrderId)
      if (ord) await ctx.db.workOrders.put({ ...ord, saleId: undefined, status: ord.status === 'entregada' ? 'lista_entrega' : ord.status, deliveredAt: undefined, updatedAt: stamp(ctx), statusHistory: ord.status === 'entregada' ? [...ord.statusHistory, { at: stamp(ctx), from: 'entregada', to: 'lista_entrega', userId: ctx.user.id, note: `Venta ${sale.folio} cancelada: ${trim(reason)}` }] : ord.statusHistory })
    }
    await ctx.db.sales.put({ ...sale, status: 'cancelada', cancelReason: trim(reason), updatedAt: stamp(ctx) })
    await audit(ctx, 'venta.cancelada', 'venta', sale.id, { before: { totalCents: sale.totalCents, status: sale.status }, reason: trim(reason) })
  })
}

/** Devolución parcial o total de una partida: nota de crédito al cliente y refacción de vuelta al inventario al costo original. */
export async function returnSaleItem(ctx: Ctx, saleId: string, itemId: string, qty: number, reason: string, o: { refund?: { methodId: string } } = {}): Promise<SaleReturn> {
  need(ctx, 'ventas.cancelar')
  requirePositive(qty, 'La cantidad')
  if (!trim(reason)) fail('Indica el motivo de la devolución.')
  return tx(ctx, async () => {
    const sale = await load(ctx, ctx.db.sales, saleId, 'La venta')
    if (sale.status !== 'emitida') fail('Solo se pueden devolver partidas de ventas emitidas.')
    const it = sale.items.find((x) => x.id === itemId) ?? fail('La partida no existe en la venta.')
    const done = sale.returns.filter((r) => r.itemId === itemId)
    const doneQty = done.reduce((a, r) => a + r.qty, 0)
    if (qty > it.qty - doneQty + 1e-9) fail(`Solo se pueden devolver ${it.qty - doneQty} unidad(es) de esta partida.`)
    const last = Math.abs(qty - (it.qty - doneQty)) < 1e-9
    const net = last ? it.netCents - done.reduce((a, r) => a + r.netCents, 0) : round((it.netCents * qty) / it.qty)
    const tax = last ? it.taxCents - done.reduce((a, r) => a + r.taxCents, 0) : round((it.taxCents * qty) / it.qty)
    const cost = last ? it.costCents - done.reduce((a, r) => a + r.costRecoveredCents, 0) : round((it.costCents * qty) / it.qty)
    let movementId: string | undefined
    if (it.refId && it.movementIds.length && (it.type === 'refaccion' || it.type === 'consumible')) {
      movementId = (await moveIn(ctx, { productId: it.refId, qty, totalCostCents: cost, type: 'devolucion_cliente', refType: 'devolucion', refId: sale.id, reason: `Devolución ${sale.folio}: ${trim(reason)}`, reverses: it.movementIds[0] })).id
    }
    const at = stamp(ctx)
    const ret: SaleReturn = { id: uid(), at, date: today(ctx), itemId, qty, netCents: net, taxCents: tax, costRecoveredCents: movementId ? cost : 0, movementId, reason: trim(reason), userId: ctx.user.id }
    const updated = { ...sale, returns: [...sale.returns, ret], updatedAt: at }
    await ctx.db.sales.put(updated)
    if (o.refund) {
      // Reembolsa solo lo que el cliente pagó de más respecto de lo que ahora debe.
      const owed = salePaid(updated, await saleLedger(ctx)) - (updated.totalCents - saleReturnsTotal(updated))
      if (owed > 0) await recordLedger(ctx, { kind: 'reembolso_cliente', direction: 'out', amountCents: owed, methodId: o.refund.methodId, reference: '', note: `Devolución ${sale.folio}`, saleId: sale.id, customerId: sale.customerId })
    }
    await audit(ctx, 'venta.devolucion', 'venta', sale.id, { after: { itemId, qty, netCents: net, taxCents: tax }, reason: trim(reason) })
    return ret
  })
}

export const addDaysISO = addDays
export { payStatus, netPrice }
export type { ItemType, WorkOrder }
