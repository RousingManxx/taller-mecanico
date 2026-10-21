import { describe, expect, it } from 'vitest'
import { cashFlow, incomeStatement, payables, receivables, saleBalance, receiptBalance } from '../domain/finance'
import { quoteSummary } from '../domain/quotes'
import { timeSummary } from '../domain/orders'
import { login, saveUser } from '../services/auth'
import { addCashMovement, closeSession, openSession } from '../services/cash'
import { decideProposal, proposePrice, saveProduct } from '../services/catalog'
import { adjustStock, physicalCount, totalStock } from '../services/inventory'
import { cancelExpense, forecastRecurring, generateRecurring, payExpense, saveExpense, saveRecurring } from '../services/expenses'
import { paySupplier, receivePurchase, savePurchaseOrder } from '../services/purchasing'
import { approveQuotation, convertQuotationToOrder, duplicateQuotation, saveQuotation, sendQuotation } from '../services/quotations'
import { cancelSale, createCounterSale, registerPayment, returnSaleItem, voidPayment } from '../services/sales'
import { saveCustomer, saveVehicle } from '../services/customers'
import { saveEmployee } from '../services/people'
import {
  addItem, authorizeItems, cancelOrder, changeStatus, completeItem, consumeItem, createOrder, createWarrantyOrder, deliverOrder, logManualTime, removeItem, returnItemToStock, startWork, stopWork, updateItem,
} from '../services/workorders'
import { basics, stockFiltros, withCash, world } from './helpers'

async function readyOrder(ctx: Awaited<ReturnType<typeof world>>['ctx'], b: Awaited<ReturnType<typeof basics>>, withPart = true) {
  let o = await createOrder(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, km: 80500, complaint: 'Cambio de aceite', mechanicId: b.mech.id })
  const svc = await addItem(ctx, o.id, { type: 'servicio', refId: b.servicio.id, qty: 1 })
  const part = withPart ? await addItem(ctx, o.id, { type: 'refaccion', refId: b.filtro.id, qty: 1 }) : undefined
  await changeStatus(ctx, o.id, 'pendiente_autorizacion')
  await authorizeItems(ctx, o.id, { itemIds: [svc.id, ...(part ? [part.id] : [])], approvedBy: 'Ana Pérez', via: 'telefono' })
  o = (await ctx.db.workOrders.get(o.id))!
  return { o, svc, part }
}

describe('Flujo A: recepción → orden → cobro → entrega → rentabilidad', () => {
  it('calcula costos reales, utilidad y margen de punta a punta', async () => {
    const { ctx, clk } = await world()
    const b = await basics(ctx)
    await stockFiltros(ctx, b) // 10 filtros a $82 reales ($80 + flete prorrateado)
    await withCash(ctx)
    const { o, svc, part } = await readyOrder(ctx, b)
    expect(o.status).toBe('autorizada')
    expect(o.authorizations[0]).toMatchObject({ approvedBy: 'Ana Pérez', via: 'telefono', amountCents: 63800 })

    await changeStatus(ctx, o.id, 'en_reparacion')
    await startWork(ctx, o.id, b.mech.id, svc.id)
    clk.advance(90)
    await stopWork(ctx, o.id, b.mech.id)
    await consumeItem(ctx, o.id, part!.id)
    await completeItem(ctx, o.id, svc.id)
    await changeStatus(ctx, o.id, 'lista_entrega')

    const { order, sale } = await deliverOrder(ctx, o.id, { kmOut: 80510 })
    expect(order.status).toBe('entregada')
    expect(sale).toMatchObject({ netCents: 55000, taxCents: 8800, totalCents: 63800, costCents: 27700, laborHours: 1.5 })
    const cp = sale.items.find((i) => i.type === 'refaccion')!, cs = sale.items.find((i) => i.type === 'servicio')!
    expect(cp.costCents).toBe(8200); expect(cs.costCents).toBe(19500); expect(cs.costEstimated).toBe(false)
    expect(cp.movementIds).toHaveLength(1)

    // Inventario: 9 filtros a $82
    const bal = await ctx.db.balances.toArray()
    expect(bal[0]).toMatchObject({ qty: 9, valueCents: 73800 })

    // Pagos parciales y saldo
    const led = () => ctx.db.ledger.toArray()
    await registerPayment(ctx, { saleId: sale.id, amountCents: 30000, methodId: 'efectivo' })
    expect(saleBalance(sale, await led())).toBe(33800)
    await expect(registerPayment(ctx, { saleId: sale.id, amountCents: 40000, methodId: 'efectivo' })).rejects.toThrow(/supera el saldo/)
    await registerPayment(ctx, { saleId: sale.id, amountCents: 33800, methodId: 'efectivo' })
    expect(saleBalance(sale, await led())).toBe(0)
    expect(receivables([sale], await led(), '2026-03-10')).toHaveLength(0)

    // Estado de resultados del periodo: utilidad bruta = 55,000 − 27,700
    const st = incomeStatement([sale], [], (await ctx.db.settings.get('main'))!.expenseCategories, { from: '2026-03-01', to: '2026-03-31' })
    expect(st.grossProfitCents).toBe(27300)
    expect(st.grossMarginPct).toBeCloseTo(49.636, 2)
    const cf = cashFlow(await led(), { from: '2026-03-01', to: '2026-03-31' })
    expect(cf.collectedCents).toBe(63800)
  })

  it('no permite avanzar sin autorización, con trabajos pendientes, ni sin mecánico', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const o = await createOrder(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, km: 1, complaint: 'x' })
    const it = await addItem(ctx, o.id, { type: 'servicio', refId: b.servicio.id, qty: 1 })
    await expect(changeStatus(ctx, o.id, 'autorizada')).rejects.toThrow(/Autoriza/)
    await changeStatus(ctx, o.id, 'pendiente_autorizacion')
    await authorizeItems(ctx, o.id, { itemIds: [it.id], approvedBy: 'Cliente', via: 'presencial' })
    await expect(changeStatus(ctx, o.id, 'en_reparacion')).rejects.toThrow(/mecánico/)
    await ctx.db.workOrders.update(o.id, { mechanicId: b.mech.id })
    await changeStatus(ctx, o.id, 'en_reparacion')
    await expect(changeStatus(ctx, o.id, 'lista_entrega')).rejects.toThrow(/sin ejecutar/)
    await expect(changeStatus(ctx, o.id, 'borrador')).rejects.toThrow(/No se puede pasar/)
    await expect(deliverOrder(ctx, o.id)).rejects.toThrow()
  })

  it('refacción sin autorizar no se consume y sin existencias falla sin dejar rastro', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b, 1)
    const o = await createOrder(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, km: 1, complaint: 'x', mechanicId: b.mech.id })
    const part = await addItem(ctx, o.id, { type: 'refaccion', refId: b.filtro.id, qty: 2 })
    await expect(consumeItem(ctx, o.id, part.id)).rejects.toThrow(/autorizada/)
    await changeStatus(ctx, o.id, 'pendiente_autorizacion')
    await authorizeItems(ctx, o.id, { itemIds: [part.id], approvedBy: 'Ana', via: 'whatsapp' })
    const before = await ctx.db.movements.count()
    await expect(consumeItem(ctx, o.id, part.id)).rejects.toThrow(/insuficiente/i) // pide 2, hay 1
    expect(await ctx.db.movements.count()).toBe(before)
    expect(totalStock(await ctx.db.balances.toArray(), b.filtro.id)).toBe(1)
    await consumeItem(ctx, o.id, part.id, 1)
    const cur = (await ctx.db.workOrders.get(o.id))!.items[0]
    expect(cur).toMatchObject({ consumedQty: 1, status: 'autorizado', costCents: 10000 }) // parcial: aún pendiente (1 pieza con todo el flete: $100)
  })

  it('cancelación: devuelve inventario al costo original y conserva el historial', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const { o, part } = await readyOrder(ctx, b)
    await consumeItem(ctx, o.id, part!.id)
    const movs = await ctx.db.movements.count()
    await cancelOrder(ctx, o.id, 'El cliente ya no autorizó')
    const cur = (await ctx.db.workOrders.get(o.id))!
    expect(cur.status).toBe('cancelada'); expect(cur.items.find((i) => i.refId === b.filtro.id)).toMatchObject({ consumedQty: 0, costCents: 0 })
    expect(await ctx.db.movements.count()).toBe(movs + 1) // movimiento compensatorio, no se borra nada
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 10, valueCents: 82000 })
    await expect(changeStatus(ctx, o.id, 'autorizada')).rejects.toThrow()
    await expect(addItem(ctx, o.id, { type: 'otro', description: 'x', qty: 1 })).rejects.toThrow(/cancelada/)
  })

  it('devolver una refacción a inventario y quitar la partida', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const { o, part } = await readyOrder(ctx, b)
    await consumeItem(ctx, o.id, part!.id)
    await expect(removeItem(ctx, o.id, part!.id)).rejects.toThrow(/devuélvelas/)
    await returnItemToStock(ctx, o.id, part!.id, 1, 'Pieza equivocada')
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 10, valueCents: 82000 })
    await removeItem(ctx, o.id, part!.id)
    expect((await ctx.db.workOrders.get(o.id))!.items).toHaveLength(1)
  })

  it('modificar importes de lo autorizado exige nueva autorización y queda auditado', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const { o, svc } = await readyOrder(ctx, b, false)
    await updateItem(ctx, o.id, svc.id, { unitPriceCents: 30000 })
    expect((await ctx.db.workOrders.get(o.id))!.items[0].status).toBe('cotizado')
    expect((await ctx.db.audit.toArray()).some((a) => a.action === 'orden.partida_modificada')).toBe(true)
    await expect(updateItem(ctx, o.id, svc.id, { discountCents: 999999 })).rejects.toThrow(/descuento/)
  })
})

describe('Tiempos y mano de obra', () => {
  it('un mecánico solo puede tener un cronómetro abierto y no se traslapan horas', async () => {
    const { ctx, clk } = await world()
    const b = await basics(ctx)
    const a = await readyOrder(ctx, b, false)
    const c = await readyOrder(ctx, b, false)
    await changeStatus(ctx, a.o.id, 'en_reparacion'); await changeStatus(ctx, c.o.id, 'en_reparacion')
    await startWork(ctx, a.o.id, b.mech.id)
    clk.advance(30)
    await startWork(ctx, c.o.id, b.mech.id) // pausa automática de la orden A
    clk.advance(30)
    await stopWork(ctx, c.o.id, b.mech.id)
    const oa = (await ctx.db.workOrders.get(a.o.id))!, oc = (await ctx.db.workOrders.get(c.o.id))!
    const work = (o: typeof oa) => o.timeEntries.filter((t) => t.kind === 'trabajo')
    expect(work(oa)[0]).toMatchObject({ minutes: 30, costCents: 6500 })
    expect(work(oc)[0]).toMatchObject({ minutes: 30 })
    expect(timeSummary(oa, clk.t.toISOString()).workMinutes + timeSummary(oc, clk.t.toISOString()).workMinutes).toBe(60) // 60 min reales, no 90
    // tiempo manual traslapado con lo ya registrado
    await expect(logManualTime(ctx, a.o.id, b.mech.id, '2026-03-10T16:10:00Z', '2026-03-10T16:20:00Z')).rejects.toThrow(/traslapa/)
    await logManualTime(ctx, a.o.id, b.mech.id, '2026-03-10T14:00:00Z', '2026-03-10T15:00:00Z')
    expect(work((await ctx.db.workOrders.get(a.o.id))!)).toHaveLength(2)
    await expect(logManualTime(ctx, a.o.id, b.mech.id, '2026-03-10T20:00:00Z', '2026-03-10T21:00:00Z')).rejects.toThrow(/futuro/)
  })

  it('el tiempo de espera por piezas se registra aparte y no cuesta mano de obra', async () => {
    const { ctx, clk } = await world()
    const b = await basics(ctx)
    const { o } = await readyOrder(ctx, b, false)
    await changeStatus(ctx, o.id, 'esperando_refacciones')
    clk.advance(120)
    await changeStatus(ctx, o.id, 'en_reparacion')
    const s = timeSummary((await ctx.db.workOrders.get(o.id))!, clk.t.toISOString())
    expect(s).toMatchObject({ waitMinutes: 120, workMinutes: 0, laborCostCents: 0 })
    expect(s.elapsedMinutes).toBe(120)
  })

  it('servicio sin tiempos reales usa el estándar y se marca como estimado', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const { o, svc } = await readyOrder(ctx, b, false)
    await changeStatus(ctx, o.id, 'en_reparacion')
    await completeItem(ctx, o.id, svc.id)
    await changeStatus(ctx, o.id, 'lista_entrega')
    const { sale } = await deliverOrder(ctx, o.id)
    expect(sale.items[0]).toMatchObject({ costEstimated: true, costCents: 13000, hours: 1 })
  })
})

describe('Flujo B: venta de mostrador', () => {
  it('descuenta inventario, congela costo y calcula utilidad; reintento no duplica', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    await withCash(ctx)
    const input = { lines: [{ kind: 'producto' as const, productId: b.filtro.id, qty: 2, discountCents: 1000 }], payments: [{ methodId: 'efectivo', amountCents: 20000 }] }
    const sale = await createCounterSale(ctx, input, 'op-1')
    expect(sale).toMatchObject({ netCents: 39000, taxCents: 6240, totalCents: 45240, costCents: 16400 })
    const again = await createCounterSale(ctx, input, 'op-1') // doble clic / reintento
    expect(again.id).toBe(sale.id)
    expect((await ctx.db.balances.toArray())[0].qty).toBe(8)
    expect(await ctx.db.sales.count()).toBe(1)
    expect(await ctx.db.ledger.count()).toBe(1)
    expect(saleBalance(sale, await ctx.db.ledger.toArray())).toBe(25240)
  })
  it('inventario insuficiente revierte todo', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    await expect(createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 100 }] })).rejects.toThrow(/insuficiente/i)
    expect(await ctx.db.sales.count()).toBe(0); expect((await ctx.db.balances.toArray())[0].qty).toBe(10)
    expect((await ctx.db.settings.get('main'))!.counters.venta).toBe(1) // el folio tampoco se consumió
  })
  it('un cambio posterior de costo no altera el costo histórico de la venta', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const s1 = await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }] })
    await stockFiltros(ctx, b, 10, 16000, 0) // el proveedor sube a $160
    const reload = (await ctx.db.sales.get(s1.id))!
    expect(reload.costCents).toBe(8200)
    const s2 = await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }] })
    expect(s2.costCents).toBeGreaterThan(8200) // promedio ponderado nuevo
  })
  it('venta a crédito no es un cobro; anular un cobro es un movimiento inverso', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    const sale = await createCounterSale(ctx, { customerId: b.customer.id, lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }], dueDate: '2026-03-25' })
    expect(await ctx.db.ledger.count()).toBe(0)
    const p = await registerPayment(ctx, { saleId: sale.id, amountCents: 10000, methodId: 'efectivo' })
    await voidPayment(ctx, p.id, 'Error de captura')
    expect(await ctx.db.ledger.count()).toBe(2)
    expect(saleBalance(sale, await ctx.db.ledger.toArray())).toBe(sale.totalCents)
    await expect(voidPayment(ctx, p.id, 'otra vez')).rejects.toThrow(/ya fue anulado/)
    const aging = receivables([sale], await ctx.db.ledger.toArray(), '2026-04-10')
    expect(aging[0]).toMatchObject({ bucket: 'd1_30', daysLate: 16 })
  })
  it('devolución parcial: reduce ventas y regresa la pieza al costo original', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    const sale = await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 2 }], payments: [{ methodId: 'efectivo', amountCents: 46400 }] })
    const ret = await returnSaleItem(ctx, sale.id, sale.items[0].id, 1, 'No era la pieza', { refund: { methodId: 'efectivo' } })
    expect(ret).toMatchObject({ netCents: 20000, taxCents: 3200, costRecoveredCents: 8200 })
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 9, valueCents: 73800 })
    const s = (await ctx.db.sales.get(sale.id))!
    expect(saleBalance(s, await ctx.db.ledger.toArray())).toBe(0)
    const st = incomeStatement([s], [], (await ctx.db.settings.get('main'))!.expenseCategories, { from: '2026-03-01', to: '2026-03-31' })
    expect(st.netSalesCents).toBe(20000); expect(st.cogs.partsCents).toBe(8200)
    await expect(returnSaleItem(ctx, sale.id, sale.items[0].id, 2, 'x')).rejects.toThrow(/Solo se pueden devolver/)
  })
  it('cancelar venta de mostrador con cobros exige reembolso y regresa inventario', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    const sale = await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 3 }], payments: [{ methodId: 'efectivo', amountCents: 10000 }] })
    await expect(cancelSale(ctx, sale.id, 'Error')).rejects.toThrow(/reembolso/)
    await cancelSale(ctx, sale.id, 'Error', { refund: true })
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 10, valueCents: 82000 })
    const s = (await ctx.db.sales.get(sale.id))!
    expect(s.status).toBe('cancelada'); expect(saleBalance(s, await ctx.db.ledger.toArray())).toBe(0)
    expect(cashFlow(await ctx.db.ledger.toArray(), { from: '2026-03-01', to: '2026-03-31' }).collectedCents).toBe(0)
  })
  it('una venta de orden cancelada reabre la orden', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const { o, svc } = await readyOrder(ctx, b, false)
    await changeStatus(ctx, o.id, 'en_reparacion'); await completeItem(ctx, o.id, svc.id); await changeStatus(ctx, o.id, 'lista_entrega')
    const { sale } = await deliverOrder(ctx, o.id)
    await cancelSale(ctx, sale.id, 'Facturación errónea')
    const cur = (await ctx.db.workOrders.get(o.id))!
    expect(cur).toMatchObject({ status: 'lista_entrega', saleId: undefined })
    const again = await deliverOrder(ctx, o.id)
    expect(again.sale.id).not.toBe(sale.id)
  })
})

describe('Flujo C: compras, costo promedio, flete y cuentas por pagar', () => {
  it('recepción parcial prorratea el flete; recibir de más o reprocesar no duplica', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const po = await savePurchaseOrder(ctx, { supplierId: b.sup.id, items: [{ productId: b.filtro.id, qty: 10, unitCostCents: 8000 }], freightCents: 2000 })
    const item = po.items[0].id
    const r1 = await receivePurchase(ctx, po.id, [{ itemId: item, qty: 4 }], { invoiceRef: 'A-1' }, 'rec-1')
    expect(r1).toMatchObject({ goodsCents: 32000, freightCents: 800, taxCents: 5248, totalCents: 38048 })
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 4, valueCents: 32800 })
    const replay = await receivePurchase(ctx, po.id, [{ itemId: item, qty: 4 }], { invoiceRef: 'A-1' }, 'rec-1')
    expect(replay.id).toBe(r1.id); expect((await ctx.db.balances.toArray())[0].qty).toBe(4)
    expect((await ctx.db.purchaseOrders.get(po.id))!.status).toBe('parcial')
    await expect(receivePurchase(ctx, po.id, [{ itemId: item, qty: 7 }])).rejects.toThrow(/solo faltan 6/i)
    const r2 = await receivePurchase(ctx, po.id, [{ itemId: item, qty: 6 }])
    expect(r2.freightCents).toBe(1200) // el resto del flete: nunca se pierde ni se duplica
    expect((await ctx.db.balances.toArray())[0]).toMatchObject({ qty: 10, valueCents: 82000 })
    expect((await ctx.db.purchaseOrders.get(po.id))!.status).toBe('recibida')
    await expect(receivePurchase(ctx, po.id, [{ itemId: item, qty: 1 }])).rejects.toThrow(/no admite recepciones/)
    const prod = (await ctx.db.products.get(b.filtro.id))!
    expect(prod.lastPurchaseCost).toBeCloseTo(8200, 5)
  })
  it('pagos a proveedor parciales actualizan saldos y nunca exceden el documento', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const { rec } = await stockFiltros(ctx, b)
    expect(rec.totalCents).toBe(95120)
    expect(rec.dueDate).toBe('2026-03-25') // +15 días de crédito
    await paySupplier(ctx, { supplierId: b.sup.id, allocations: [{ receiptId: rec.id, amountCents: 40000 }], methodId: 'transferencia' }, 'pay-1')
    await paySupplier(ctx, { supplierId: b.sup.id, allocations: [{ receiptId: rec.id, amountCents: 40000 }], methodId: 'transferencia' }, 'pay-1') // reintento
    let led = await ctx.db.ledger.toArray()
    expect(led).toHaveLength(1); expect(receiptBalance(rec, led)).toBe(55120)
    await expect(paySupplier(ctx, { supplierId: b.sup.id, allocations: [{ receiptId: rec.id, amountCents: 60000 }], methodId: 'transferencia' })).rejects.toThrow(/supera el saldo/)
    await paySupplier(ctx, { supplierId: b.sup.id, allocations: [{ receiptId: rec.id, amountCents: 55120 }], methodId: 'transferencia' })
    led = await ctx.db.ledger.toArray()
    expect(receiptBalance(rec, led)).toBe(0)
    expect(payables([rec], [], led, () => 'x', '2026-03-30')).toHaveLength(0)
  })
  it('compra a crédito genera obligación; el pago en efectivo exige caja abierta', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const { rec } = await stockFiltros(ctx, b)
    const rows = payables([rec], [], [], () => 'Refaccionaria Norte', '2026-04-05')
    expect(rows[0]).toMatchObject({ balanceCents: 95120, bucket: 'd1_30' })
    await expect(paySupplier(ctx, { supplierId: b.sup.id, allocations: [{ receiptId: rec.id, amountCents: 1000 }], methodId: 'efectivo' })).rejects.toThrow(/Abre la caja/)
  })
})

describe('Flujo D: gastos y resultados', () => {
  it('no duplica la nómina: la mano de obra imputada ya está en el costo; la diferencia es capacidad ociosa', async () => {
    const { ctx, clk } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    const { o, svc, part } = await readyOrder(ctx, b)
    await changeStatus(ctx, o.id, 'en_reparacion')
    await startWork(ctx, o.id, b.mech.id, svc.id); clk.advance(60); await stopWork(ctx, o.id, b.mech.id)
    await consumeItem(ctx, o.id, part!.id); await completeItem(ctx, o.id, svc.id); await changeStatus(ctx, o.id, 'lista_entrega')
    const { sale } = await deliverOrder(ctx, o.id)
    await saveExpense(ctx, { concept: 'Renta marzo', categoryId: 'renta', amountCents: 1_000_000, taxCents: 0 }, { methodId: 'transferencia' })
    await saveExpense(ctx, { concept: 'Nómina mecánicos', categoryId: 'nomina_mecanicos', amountCents: 500_000 }, { methodId: 'transferencia' })
    const exp = await saveExpense(ctx, { concept: 'Luz', categoryId: 'electricidad', amountCents: 80_000, taxCents: 12_800 }) // pendiente de pago
    const st = incomeStatement([sale], await ctx.db.expenses.toArray(), (await ctx.db.settings.get('main'))!.expenseCategories, { from: '2026-03-01', to: '2026-03-31' })
    expect(st.cogs.laborCents).toBe(13000)
    expect(st.directPayrollCents).toBe(500000); expect(st.idleLaborCents).toBe(487000)
    expect(st.opex.totalCents).toBe(1_000_000 + 80_000 + 487_000)
    expect(st.operatingProfitCents).toBe(st.grossProfitCents - st.opex.totalCents)
    // la luz pendiente cuenta como gasto (devengado) pero no como salida de efectivo, y aparece por pagar
    const led = await ctx.db.ledger.toArray()
    const cf = cashFlow(led, { from: '2026-03-01', to: '2026-03-31' })
    expect(cf.outCents).toBe(1_500_000)
    const pay = payables([], [exp], led, () => '', '2026-03-10')
    expect(pay[0]).toMatchObject({ kind: 'gasto', balanceCents: 92_800 })
    await payExpense(ctx, exp.id, 50_000, 'transferencia', {}, 'pg-1'); await payExpense(ctx, exp.id, 50_000, 'transferencia', {}, 'pg-1')
    expect((await ctx.db.ledger.toArray()).filter((l) => l.expenseId === exp.id)).toHaveLength(1)
    await expect(payExpense(ctx, exp.id, 50_000, 'transferencia')).rejects.toThrow(/supera el saldo/)
    await expect(cancelExpense(ctx, exp.id, 'x')).rejects.toThrow(/ya tiene pagos/)
  })
  it('gastos recurrentes se generan una sola vez por periodo y hay previsión', async () => {
    const { ctx } = await world()
    await saveRecurring(ctx, { concept: 'Renta', categoryId: 'renta', amountCents: 800_000, taxCents: 0, frequency: 'mensual', dayOfMonth: 31, costCenter: '', active: true, startDate: '2026-01-15' })
    expect(await generateRecurring(ctx, '2026-03-10')).toBe(2) // 31 ene (≥ inicio) y 28 feb
    expect(await generateRecurring(ctx, '2026-03-10')).toBe(0)
    const exps = (await ctx.db.expenses.toArray()).map((e) => e.date).sort()
    expect(exps).toEqual(['2026-01-31', '2026-02-28'])
    const f = forecastRecurring(await ctx.db.recurring.toArray(), '2026-03-10', 3)
    expect(f.map((x) => x.cents)).toEqual([800_000, 800_000, 800_000])
  })
})

describe('Flujo F: caja', () => {
  it('apertura, cobros, diferencia con motivo y conservación del historial', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    await expect(createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }], payments: [{ methodId: 'efectivo', amountCents: 5000 }] })).rejects.toThrow(/Abre la caja/)
    expect(await ctx.db.sales.count()).toBe(0)
    await openSession(ctx, 100_000)
    await expect(openSession(ctx, 1)).rejects.toThrow(/Ya hay una caja abierta/)
    await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }], payments: [{ methodId: 'efectivo', amountCents: 23200 }] })
    await saveExpense(ctx, { concept: 'Agua', categoryId: 'agua', amountCents: 10_000 }, { methodId: 'efectivo' })
    await addCashMovement(ctx, { kind: 'retiro_dueno', amountCents: 20_000, methodId: 'efectivo', note: 'Retiro personal' })
    await addCashMovement(ctx, { kind: 'aportacion_dueno', amountCents: 50_000, methodId: 'transferencia', note: 'Aportación' }) // banco: no entra a la caja
    // esperado: 100,000 + 23,200 − 10,000 − 20,000 = 93,200
    await expect(closeSession(ctx, 93_000, '')).rejects.toThrow(/diferencia/)
    const closed = await closeSession(ctx, 93_000, 'Faltan $2 por cambio')
    expect(closed).toMatchObject({ status: 'cerrada', expectedCents: 93_200, countedCents: 93_000, differenceCents: -200 })
    await expect(closeSession(ctx, 0, '')).rejects.toThrow(/No hay una caja abierta/)
    const st = incomeStatement(await ctx.db.sales.toArray(), await ctx.db.expenses.toArray(), (await ctx.db.settings.get('main'))!.expenseCategories, { from: '2026-03-01', to: '2026-03-31' })
    expect(st.netSalesCents).toBe(20000) // aportaciones y retiros no son ventas
    const cf = cashFlow(await ctx.db.ledger.toArray(), { from: '2026-03-01', to: '2026-03-31' })
    expect(cf.nonOperatingNetCents).toBe(30_000) // +50,000 aportación −20,000 retiro
    expect(cf.collectedCents).toBe(23200)
  })
})

describe('Cotizaciones', () => {
  it('versiones, aprobación y conversión a orden sin recapturar', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const q = await saveQuotation(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, items: [{ type: 'servicio', refId: b.servicio.id, qty: 1 }, { type: 'refaccion', refId: b.filtro.id, qty: 1 }] })
    expect(q.status).toBe('borrador'); expect(q.versions).toHaveLength(1)
    const sum = quoteSummary(q.versions[0].items, { pricesIncludeTax: false })
    expect(sum).toMatchObject({ netCents: 55000, totalCents: 63800 })
    expect(sum.estCostCents).toBe(8200 + 13000) // pieza al costo real + 1 h estándar al costo laboral de $130/h
  })
  it('editar tras enviar crea una nueva versión y conserva la anterior', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    const q = await saveQuotation(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, items: [{ type: 'servicio', refId: b.servicio.id, qty: 1 }] })
    await sendQuotation(ctx, q.id)
    const q2 = await saveQuotation(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, items: [{ type: 'servicio', refId: b.servicio.id, qty: 2 }] }, q.id)
    expect(q2.versions.map((v) => v.n)).toEqual([1, 2]); expect(q2.currentVersion).toBe(2); expect(q2.status).toBe('borrador')
    expect(q2.versions[0].items[0].qty).toBe(1)
    await sendQuotation(ctx, q.id)
    await approveQuotation(ctx, q.id, 'Ana Pérez')
    const o = await convertQuotationToOrder(ctx, q.id, { km: 80000, mechanicId: b.mech.id })
    expect(o.status).toBe('autorizada')
    expect(o.items[0]).toMatchObject({ qty: 2, status: 'autorizado' })
    expect(o.authorizations[0]).toMatchObject({ quotationVersion: 2, approvedBy: 'Ana Pérez' })
    expect((await ctx.db.quotations.get(q.id))!.status).toBe('convertida')
    await expect(convertQuotationToOrder(ctx, q.id, { km: 1 })).rejects.toThrow(/aprobada/)
    await expect(saveQuotation(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, items: [{ type: 'servicio', refId: b.servicio.id, qty: 3 }] }, q.id)).rejects.toThrow(/aprobada/)
    const dup = await duplicateQuotation(ctx, q.id)
    expect(dup.status).toBe('borrador'); expect(dup.folio).not.toBe(q.folio)
  })
})

describe('Garantía', () => {
  it('orden de garantía: el cliente no paga pero el costo queda registrado', async () => {
    const { ctx, clk } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const { o, svc, part } = await readyOrder(ctx, b)
    await changeStatus(ctx, o.id, 'en_reparacion'); await consumeItem(ctx, o.id, part!.id); await completeItem(ctx, o.id, svc.id); await changeStatus(ctx, o.id, 'lista_entrega'); await deliverOrder(ctx, o.id)
    const w = await createWarrantyOrder(ctx, o.id, 'Gotea el filtro')
    expect(w).toMatchObject({ isWarranty: true, status: 'autorizada', warrantyOfOrderId: o.id })
    const pi = await addItem(ctx, w.id, { type: 'refaccion', refId: b.filtro.id, qty: 1 })
    expect(pi).toMatchObject({ unitPriceCents: 0, status: 'autorizado' })
    await ctx.db.workOrders.update(w.id, { mechanicId: b.mech.id })
    await changeStatus(ctx, w.id, 'en_reparacion')
    await startWork(ctx, w.id, b.mech.id); clk.advance(30); await stopWork(ctx, w.id, b.mech.id)
    await consumeItem(ctx, w.id, pi.id)
    await changeStatus(ctx, w.id, 'lista_entrega')
    const { sale } = await deliverOrder(ctx, w.id)
    expect(sale).toMatchObject({ netCents: 0, totalCents: 0 })
    expect(sale.costCents).toBe(8200 + 6500)
    const s = incomeStatement([sale], [], (await ctx.db.settings.get('main'))!.expenseCategories, { from: '2026-03-01', to: '2026-03-31' })
    expect(s.grossProfitCents).toBe(-(8200 + 6500))
    const open = await createOrder(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, km: 1, complaint: 'x' })
    await expect(createWarrantyOrder(ctx, open.id, 'otra')).rejects.toThrow(/entregada/i)
  })
})

describe('Inventario: ajustes, mermas y conteo físico', () => {
  it('movimientos compensatorios auditables; el historial no se edita ni se borra', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    await adjustStock(ctx, { productId: b.filtro.id, qty: 2, direction: 'salida', kind: 'merma', reason: 'Dañados' })
    await expect(adjustStock(ctx, { productId: b.filtro.id, qty: 1, direction: 'salida', kind: 'ajuste', reason: '' })).rejects.toThrow(/motivo/)
    await expect(adjustStock(ctx, { productId: b.aceite.id, qty: 5, direction: 'entrada', kind: 'ajuste', reason: 'Alta' })).rejects.toThrow(/costo unitario/)
    const diffs = await physicalCount(ctx, [{ productId: b.filtro.id, counted: 9 }], 'Conteo mensual')
    expect(diffs).toEqual([{ productId: b.filtro.id, diff: 1 }])
    expect(totalStock(await ctx.db.balances.toArray(), b.filtro.id)).toBe(9)
    const m = (await ctx.db.movements.toArray())[0]
    await expect(ctx.db.movements.update(m.id, { qty: 99 })).rejects.toThrow(/no se pueden modificar/)
    await expect(ctx.db.movements.delete(m.id)).rejects.toThrow(/no se pueden eliminar/)
    await expect(ctx.db.ledger.clear().then(() => ctx.db.audit.update('x', { action: 'y' }))).resolves.toBe(0)
    const a = (await ctx.db.audit.toArray())[0]
    await expect(ctx.db.audit.update(a.id, { action: 'borrado' })).rejects.toThrow()
  })
  it('la propuesta de precio no cambia nada hasta que se aprueba y conserva historial', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const pr = await proposePrice(ctx, 'producto', b.filtro.id, 40) // costo 8,200 → 13,667
    expect(pr).toMatchObject({ proposedPriceCents: 13667, currentPriceCents: 20000 })
    expect((await ctx.db.products.get(b.filtro.id))!.priceCents).toBe(20000)
    await decideProposal(ctx, pr.id, true)
    expect((await ctx.db.products.get(b.filtro.id))!.priceCents).toBe(13667)
    const h = await ctx.db.priceHistory.toArray()
    expect(h[0]).toMatchObject({ oldPriceCents: 20000, newPriceCents: 13667 })
    await expect(decideProposal(ctx, pr.id, true)).rejects.toThrow(/ya fue resuelta/)
    await expect(proposePrice(ctx, 'producto', b.aceite.id)).rejects.toThrow(/falta el costo/)
  })
  it('SKU duplicado y validaciones', async () => {
    const { ctx } = await world()
    await basics(ctx)
    await expect(saveProduct(ctx, { sku: 'f-100', name: 'Otro', priceCents: 1 })).rejects.toThrow(/Ya existe un producto con el SKU/)
    await expect(saveProduct(ctx, { sku: 'X', name: '', priceCents: 1 })).rejects.toThrow(/obligatorio/)
    await expect(saveProduct(ctx, { sku: 'Y', name: 'Y', priceCents: -5 })).rejects.toThrow(/negativo/)
  })
})

describe('Aislamiento entre talleres y permisos', () => {
  it('un taller no puede leer ni modificar registros de otro', async () => {
    const { ctx: a } = await world({ name: 'Taller A' })
    const { ctx: b } = await world({ name: 'Taller B' })
    const cust = await saveCustomer(a, { name: 'Cliente de A' })
    expect(await b.db.customers.count()).toBe(0)
    await expect(saveCustomer(b, { id: cust.id, name: 'Intruso' })).rejects.toThrow(/no existe/)
    // aunque se fuerce un registro con orgId ajeno dentro de la base de B, los servicios lo rechazan
    await b.db.customers.put({ ...cust, orgId: a.orgId })
    await expect(saveCustomer(b, { id: cust.id, name: 'Intruso' })).rejects.toThrow(/no existe/)
    expect(a.orgId).not.toBe(b.orgId)
  })
  it('permisos verificados en la capa de servicios (no solo en la interfaz)', async () => {
    const { ctx, clk } = await world()
    const bs = await basics(ctx); await stockFiltros(ctx, bs); await withCash(ctx)
    const uid = await saveUser(ctx, { name: 'Luis', role: 'mecanico', pin: '5678', employeeId: bs.mech.id })
    const rid = await saveUser(ctx, { name: 'Rita', role: 'recepcion', pin: '4321' })
    const mec = await login(ctx.orgId, uid, '5678', () => clk.t)
    const rec = await login(ctx.orgId, rid, '4321', () => clk.t)
    const { o } = await readyOrder(ctx, bs, false)
    await expect(registerPayment(mec, { workOrderId: o.id, amountCents: 100, methodId: 'efectivo' })).rejects.toThrow(/No tienes permiso/)
    await expect(saveEmployee(mec, { id: bs.mech.id, name: 'Luis', monthlyCostCents: 1 })).rejects.toThrow(/No tienes permiso/)
    await expect(saveExpense(rec, { concept: 'x', categoryId: 'renta', amountCents: 100 })).rejects.toThrow(/No tienes permiso/)
    await expect(closeSession(rec, 0, '')).rejects.toThrow(/No tienes permiso/)
    await expect(saveUser(rec, { name: 'Z', role: 'propietario', pin: '1111' })).rejects.toThrow(/No tienes permiso/)
    // el mecánico solo ve/opera órdenes asignadas a él
    const other = await createOrder(ctx, { customerId: bs.customer.id, vehicleId: bs.vehicle.id, km: 1, complaint: 'Otra' })
    await expect(updateItem(mec, other.id, 'x', {})).rejects.toThrow(/no está asignada/)
    await expect(addItem(mec, o.id, { type: 'otro', description: 'Extra', qty: 1 })).resolves.toBeTruthy()
    // recepción no puede dejar al taller sin propietario ni cambiarse el rol
    await expect(saveUser(ctx, { id: ctx.user.id, name: 'Dueña', role: 'gerente' })).rejects.toThrow(/al menos un propietario/)
  })
  it('PIN incorrecto se rechaza y se bloquea tras varios intentos', async () => {
    const { ctx } = await world()
    for (let i = 0; i < 4; i++) await expect(login(ctx.orgId, ctx.user.id, '0000')).rejects.toThrow(/PIN incorrecto/)
    await expect(login(ctx.orgId, ctx.user.id, '0000')).rejects.toThrow(/bloqueado/)
    await expect(login(ctx.orgId, ctx.user.id, '1234')).rejects.toThrow(/Demasiados intentos/)
  })
  it('la auditoría no guarda PIN ni hashes', async () => {
    const { ctx } = await world()
    await saveUser(ctx, { name: 'Nuevo', role: 'gerente', pin: '9999' })
    const text = JSON.stringify(await ctx.db.audit.toArray())
    expect(text).not.toMatch(/pinHash|pinSalt|9999/)
  })
})

describe('Clientes y vehículos', () => {
  it('valida duplicados y conserva historial al borrar', async () => {
    const { ctx } = await world()
    const b = await basics(ctx)
    await expect(saveVehicle(ctx, { customerId: b.customer.id, make: 'Ford', model: 'Fiesta', plate: 'abc-123' })).rejects.toThrow(/placas/)
    await expect(saveVehicle(ctx, { customerId: b.customer.id, make: 'Ford', model: 'Fiesta' })).rejects.toThrow(/placas o el VIN/)
    await expect(saveCustomer(ctx, { name: 'X', email: 'malo' })).rejects.toThrow(/correo/)
    await createOrder(ctx, { customerId: b.customer.id, vehicleId: b.vehicle.id, km: 1, complaint: 'x' })
    const { removeCustomer } = await import('../services/customers')
    expect(await removeCustomer(ctx, b.customer.id)).toBe('desactivado')
    expect((await ctx.db.customers.get(b.customer.id))!.active).toBe(false)
  })
})
