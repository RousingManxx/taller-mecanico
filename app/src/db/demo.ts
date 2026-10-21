import { addDays } from '../domain/dates'
import { createOrganization, saveUser } from '../services/auth'
import { closeSession, openSession, sessionExpected, currentSession } from '../services/cash'
import { saveProduct, saveService, saveSettings } from '../services/catalog'
import { fail, today, type Ctx } from '../services/core'
import { saveCustomer, saveVehicle } from '../services/customers'
import { generateRecurring, payExpense, saveExpense, saveRecurring } from '../services/expenses'
import { totalStock } from '../services/inventory'
import { saveEmployee } from '../services/people'
import { paySupplier, receivePurchase, savePurchaseOrder, saveSupplier, sendPurchaseOrder } from '../services/purchasing'
import { approveQuotation, convertQuotationToOrder, saveQuotation, sendQuotation } from '../services/quotations'
import { createCounterSale, registerPayment } from '../services/sales'
import { addItem, authorizeItems, changeStatus, completeItem, consumeItem, createOrder, deliverOrder, startWork, stopWork } from '../services/workorders'
import { receiptBalance } from '../domain/finance'
import type { Customer, Employee, Product, ServiceDef, Vehicle } from '../domain/types'

/** Generador pseudoaleatorio determinista: la demostración siempre produce los mismos datos. */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

const SERVICES: [string, string, number, number][] = [
  ['Cambio de aceite y filtro', 'Mantenimiento', 1, 45000], ['Afinación mayor', 'Mantenimiento', 2.5, 120000], ['Cambio de balatas delanteras', 'Frenos', 1.5, 65000],
  ['Cambio de balatas traseras', 'Frenos', 1.5, 60000], ['Rectificado de discos', 'Frenos', 1, 40000], ['Alineación y balanceo', 'Alineación y balanceo', 1, 50000],
  ['Diagnóstico con escáner', 'Diagnóstico', 0.8, 35000], ['Cambio de batería', 'Eléctrico', 0.5, 15000], ['Cambio de amortiguadores', 'Suspensión y dirección', 2, 90000],
  ['Servicio de aire acondicionado', 'Aire acondicionado', 1.5, 70000], ['Cambio de banda de distribución', 'Motor', 4, 220000], ['Revisión eléctrica', 'Eléctrico', 1, 40000],
]
// sku, nombre, categoría, unidad, precio neto, costo base, mínimo
const PRODUCTS: [string, string, string, string, number, number, number][] = [
  ['ACE-5W30', 'Aceite sintético 5W30', 'Aceites y lubricantes', 'litro', 18000, 11500, 12], ['FIL-ACE', 'Filtro de aceite', 'Filtros', 'pza', 14000, 7500, 8], ['FIL-AIR', 'Filtro de aire', 'Filtros', 'pza', 26000, 15000, 5],
  ['FIL-GAS', 'Filtro de gasolina', 'Filtros', 'pza', 22000, 12000, 4], ['BUJ-001', 'Bujía de iridio', 'Motor', 'pza', 13000, 7000, 12], ['BAL-DEL', 'Balatas delanteras', 'Frenos', 'juego', 78000, 48000, 4],
  ['BAL-TRA', 'Balatas traseras', 'Frenos', 'juego', 65000, 41000, 4], ['DIS-FRE', 'Disco de freno', 'Frenos', 'pza', 92000, 60000, 4], ['BAT-12V', 'Batería 12V 45Ah', 'Baterías', 'pza', 165000, 115000, 3],
  ['AMO-DEL', 'Amortiguador delantero', 'Suspensión y dirección', 'pza', 110000, 72000, 4], ['BAN-DIS', 'Kit banda de distribución', 'Motor', 'kit', 180000, 118000, 2], ['ANT-001', 'Anticongelante', 'Líquidos', 'litro', 12000, 7000, 8],
  ['LIQ-FRE', 'Líquido de frenos', 'Líquidos', 'pza', 7000, 6000, 6], ['ACE-TRA', 'Aceite de transmisión', 'Aceites y lubricantes', 'litro', 21000, 14000, 6], ['LIM-INY', 'Limpiador de inyectores', 'Consumibles de taller', 'pza', 9000, 10500, 6],
  ['GAS-A/C', 'Gas refrigerante R134a', 'Aire acondicionado', 'pza', 38000, 24000, 3],
]
const MAKES: [string, string][] = [['Nissan', 'Versa'], ['Nissan', 'Sentra'], ['Chevrolet', 'Aveo'], ['Volkswagen', 'Jetta'], ['Toyota', 'Corolla'], ['Ford', 'Fiesta'], ['Honda', 'Civic'], ['Mazda', '3'], ['Kia', 'Rio'], ['Hyundai', 'Accent']]
const NAMES = ['María González', 'José Hernández', 'Laura Martínez', 'Carlos López', 'Ana Ramírez', 'Jorge Torres', 'Patricia Flores', 'Ricardo Díaz', 'Elena Morales', 'Fernando Cruz', 'Gabriela Reyes', 'Héctor Ortiz', 'Sofía Mendoza', 'Alberto Castillo']

/** Mapa servicio → refacciones típicas (índices de PRODUCTS). */
const KITS: Record<number, [number, number][]> = { 0: [[0, 4], [1, 1]], 1: [[4, 4], [2, 1], [3, 1]], 2: [[5, 1]], 3: [[6, 1]], 4: [], 5: [], 6: [], 7: [[8, 1]], 8: [[9, 2]], 9: [[15, 1]], 10: [[10, 1]], 11: [] }

export interface DemoProgress { (done: number, total: number, label: string): void }

/**
 * Crea un taller de DEMOSTRACIÓN separado (su propia base de datos, marcado como demo) y lo llena usando los mismos
 * servicios que usa la app, con fechas repartidas en los últimos días. No toca datos reales.
 */
export async function createDemoOrganization(days = 40, onProgress: DemoProgress = () => {}): Promise<Ctx> {
  const rnd = rng(20260310)
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]
  const base = new Date(Date.now() - 10 * 3600000) // anclado a la hora actual: ningún evento queda en el futuro, sin importar la zona horaria
  const start = new Date(base.getTime() - days * 86400000)
  let t = start
  const ctx = await createOrganization({ name: 'Taller Demo (datos ficticios)', ownerName: 'Propietario Demo', pin: '1234', demo: true, now: () => t })
  const day = async (d: number, h = 0, m = 0) => { t = new Date(start.getTime() + d * 86400000 + h * 3600000 + m * 60000) }
  await day(0)
  await saveSettings(ctx, { businessName: 'Taller Demo (datos ficticios)', overheadMethod: 'porcentaje_ventas', labor: { productiveHoursPerMonth: 140, loadPct: 30, defaultRateCents: 45000 }, address: 'Av. Ejemplo 123, Col. Centro (ficticio)', phone: '55 0000 0000' })
  // Usuarios de ejemplo (PIN de todos: 1234)
  const emps: Employee[] = []
  for (const [n, cost] of [['Roberto Salas', 1_400_000], ['Miguel Ángel Ruiz', 1_600_000], ['Javier Núñez', 1_800_000]] as [string, number][])
    emps.push(await saveEmployee(ctx, { name: n, isMechanic: true, role: 'Mecánico', specialty: 'Mecánica general', monthlyCostCents: cost, commercialRateCents: 45000 }))
  await saveUser(ctx, { name: 'Gerente Demo', role: 'gerente', pin: '1234' }); await saveUser(ctx, { name: 'Recepción Demo', role: 'recepcion', pin: '1234' })
  await saveUser(ctx, { name: 'Almacén Demo', role: 'almacen', pin: '1234' }); await saveUser(ctx, { name: 'Finanzas Demo', role: 'finanzas', pin: '1234' })
  await saveUser(ctx, { name: emps[0].name + ' (mecánico)', role: 'mecanico', pin: '1234', employeeId: emps[0].id })
  onProgress(1, 100, 'Catálogos')
  const svcs: ServiceDef[] = []; for (const [n, c, h, p] of SERVICES) svcs.push(await saveService(ctx, { name: n, category: c, stdHours: h, priceCents: p }))
  const sups = [await saveSupplier(ctx, { name: 'Refaccionaria Central (demo)', paymentTermsDays: 15, leadDays: 2 }), await saveSupplier(ctx, { name: 'Autopartes del Norte (demo)', paymentTermsDays: 30, leadDays: 4 }), await saveSupplier(ctx, { name: 'Lubricantes y Filtros SA (demo)', paymentTermsDays: 0, leadDays: 1 })]
  const prods: Product[] = []
  for (const [i, [sku, n, c, u, price, , min]] of PRODUCTS.entries()) prods.push(await saveProduct(ctx, { sku, name: n, category: c, unit: u, priceCents: price, minStock: min, supplierId: sups[i % 3].id }))
  const cust: Customer[] = [], vehs: Vehicle[] = []
  for (const [i, n] of NAMES.entries()) {
    const c = await saveCustomer(ctx, { name: n, phone: `55${String(10000000 + i * 137913).slice(0, 8)}`, email: `cliente${i + 1}@ejemplo.test` }); cust.push(c)
    const k = i < 4 ? 2 : 1
    for (let j = 0; j < k; j++) { const [mk, md] = pick(MAKES); vehs.push(await saveVehicle(ctx, { customerId: c.id, make: mk, model: md, year: 2012 + Math.floor(rnd() * 12), plate: `D${String(i).padStart(2, '0')}${j}-${100 + Math.floor(rnd() * 800)}`, km: 20000 + Math.floor(rnd() * 120000) })) }
  }
  await saveRecurring(ctx, { concept: 'Renta del local', categoryId: 'renta', amountCents: 1_800_000, taxCents: 0, frequency: 'mensual', dayOfMonth: 1, costCenter: '', active: true, startDate: addDays(today(ctx), -days - 1) })
  await saveRecurring(ctx, { concept: 'Nómina de mecánicos', categoryId: 'nomina_mecanicos', amountCents: 4_800_000, taxCents: 0, frequency: 'mensual', dayOfMonth: 15, costCenter: '', active: true, startDate: addDays(today(ctx), -days - 1) })
  await saveRecurring(ctx, { concept: 'Nómina administrativa', categoryId: 'nomina_admin', amountCents: 1_500_000, taxCents: 0, frequency: 'mensual', dayOfMonth: 15, costCenter: '', active: true, startDate: addDays(today(ctx), -days - 1) })
  await saveRecurring(ctx, { concept: 'Electricidad', categoryId: 'electricidad', amountCents: 220_000, taxCents: 35_200, frequency: 'mensual', dayOfMonth: 20, costCenter: '', active: true, startDate: addDays(today(ctx), -days - 1) })
  await saveRecurring(ctx, { concept: 'Internet y teléfono', categoryId: 'internet', amountCents: 69_000, taxCents: 11_040, frequency: 'mensual', dayOfMonth: 5, costCenter: '', active: true, startDate: addDays(today(ctx), -days - 1) })

  const costOf = (i: number, drift = 1) => Math.round(PRODUCTS[i][5] * drift)
  /** Compra y recibe una reposición (el costo varía un poco entre compras para ejercitar el costo promedio). */
  const restock = async (qtyOf: (i: number) => number, bySupplier: number | null = null) => {
    const groups = new Map<string, { productId: string; qty: number; unitCostCents: number }[]>()
    prods.forEach((p, i) => { const q = qtyOf(i); if (q > 0) { const s = sups[i % 3]; if (bySupplier !== null && s !== sups[bySupplier]) return; groups.set(s.id, [...(groups.get(s.id) ?? []), { productId: p.id, qty: q, unitCostCents: costOf(i, 0.94 + rnd() * 0.16) }]) } })
    for (const [supplierId, items] of groups) {
      const po = await savePurchaseOrder(ctx, { supplierId, items, freightCents: Math.round(items.length * 1500) })
      await sendPurchaseOrder(ctx, po.id)
      await receivePurchase(ctx, po.id, po.items.map((x) => ({ itemId: x.id, qty: x.qty })), { invoiceRef: 'F-' + Math.floor(rnd() * 90000 + 10000) })
    }
  }
  await day(0, 0, 5)
  await restock((i) => PRODUCTS[i][6] * 4)
  onProgress(5, 100, 'Inventario inicial')

  const methods = ['efectivo', 'efectivo', 'tarjeta', 'transferencia']
  const payOrder = async (saleId: string, total: number, how: number) => {
    // how: 0 pago total · 1 parcial · 2 sin pago (a crédito)
    const m = pick(methods)
    if (how === 0) await registerPayment(ctx, { saleId, amountCents: total, methodId: m })
    else if (how === 1) await registerPayment(ctx, { saleId, amountCents: Math.round((total * (0.3 + rnd() * 0.4)) / 100) * 100, methodId: m })
  }
  const openSales: { id: string; day: number }[] = []

  for (let d = 0; d < days; d++) {
    await day(d, 0, 0)
    const wd = new Date(t).getUTCDay()
    await generateRecurring(ctx)
    if (wd === 0) { onProgress(5 + Math.round((d / days) * 90), 100, `Día ${d + 1} de ${days}`); continue }
    await day(d, 0, 10)
    if (!(await currentSession(ctx))) await openSession(ctx, 100_000)
    const recent = days - d <= 2
    const nOrders = 1 + Math.floor(rnd() * 3)
    for (let k = 0; k < nOrders; k++) {
      const vehicle = pick(vehs)
      await day(d, 0, 20 + k * 25)
      const order = await createOrder(ctx, { customerId: vehicle.customerId, vehicleId: vehicle.id, km: vehicle.km + 100 + Math.floor(rnd() * 900), complaint: 'Servicio programado / revisión', mechanicId: pick(emps).id })
      const si = Math.floor(rnd() * SERVICES.length)
      const svc = await addItem(ctx, order.id, { type: 'servicio', refId: svcs[si].id, qty: 1 })
      const parts: string[] = []
      for (const [pi, q] of KITS[si] ?? []) {
        if (totalStock(await ctx.db.balances.toArray(), prods[pi].id) < q) continue
        parts.push((await addItem(ctx, order.id, { type: 'refaccion', refId: prods[pi].id, qty: q })).id)
      }
      // trabajo adicional con descuento ocasional
      if (rnd() < 0.18) parts.push((await addItem(ctx, order.id, { type: 'refaccion', refId: prods[12].id, qty: 1, discountCents: rnd() < 0.5 ? 500 : 0 })).id)
      await changeStatus(ctx, order.id, 'pendiente_autorizacion')
      await day(d, 0, 30 + k * 25)
      await authorizeItems(ctx, order.id, { itemIds: [svc.id, ...parts], approvedBy: 'Cliente (demo)', via: pick(['presencial', 'telefono', 'whatsapp'] as const) })
      if (recent && k === nOrders - 1 && d === days - 1) continue // se queda autorizada
      await changeStatus(ctx, order.id, 'en_reparacion')
      const emp = (await ctx.db.workOrders.get(order.id))!.mechanicId!
      await startWork(ctx, order.id, emp, svc.id)
      await day(d, 1, 30 + k * 25 + Math.floor(rnd() * 120))
      await stopWork(ctx, order.id, emp)
      if (recent && k === 0 && d >= days - 2) continue // se queda en reparación
      for (const id of parts) await consumeItem(ctx, order.id, id).catch(() => undefined)
      await completeItem(ctx, order.id, svc.id)
      const pend = (await ctx.db.workOrders.get(order.id))!.items.filter((i) => i.status === 'autorizado')
      if (pend.length) { await changeStatus(ctx, order.id, 'esperando_refacciones'); continue }
      await changeStatus(ctx, order.id, 'lista_entrega')
      if (recent && d === days - 1) continue // lista para entrega
      await day(d, 2, 40 + k * 20)
      const { sale } = await deliverOrder(ctx, order.id, { kmOut: (await ctx.db.workOrders.get(order.id))!.km + 5 })
      const r = rnd()
      await payOrder(sale.id, sale.totalCents, r < 0.62 ? 0 : r < 0.85 ? 1 : 2)
      if (r >= 0.62) openSales.push({ id: sale.id, day: d })
    }
    // Ventas de mostrador
    for (let k = 0; k < Math.floor(rnd() * 3); k++) {
      const pi = pick([0, 1, 2, 4, 11, 12, 13]); const p = prods[pi]
      if (totalStock(await ctx.db.balances.toArray(), p.id) < 2) continue
      const s = await createCounterSale(ctx, { customerName: 'Público en general', lines: [{ kind: 'producto', productId: p.id, qty: 1 + Math.floor(rnd() * 2) }] })
      await registerPayment(ctx, { saleId: s.id, amountCents: s.totalCents, methodId: pick(methods) })
    }
    // Cotizaciones
    if (rnd() < 0.3) {
      const v = pick(vehs), si2 = Math.floor(rnd() * SERVICES.length)
      const q = await saveQuotation(ctx, { customerId: v.customerId, vehicleId: v.id, items: [{ type: 'servicio', refId: svcs[si2].id, qty: 1 }, ...(KITS[si2] ?? []).map(([pi, qq]) => ({ type: 'refaccion' as const, refId: prods[pi].id, qty: qq }))] })
      await sendQuotation(ctx, q.id)
      if (rnd() < 0.5 && days - d > 5) { await approveQuotation(ctx, q.id, 'Cliente (demo)'); if (rnd() < 0.5) await convertQuotationToOrder(ctx, q.id, { km: v.km + 10, mechanicId: pick(emps).id }).catch(() => undefined) }
    }
    // Cobranza de saldos anteriores
    for (const o of openSales.slice()) {
      if (d - o.day >= 5 && rnd() < 0.35) {
        const s = (await ctx.db.sales.get(o.id))!
        const paid = (await ctx.db.ledger.where('saleId').equals(o.id).toArray()).reduce((a, l) => a + (l.direction === 'in' ? l.amountCents : -l.amountCents), 0)
        if (s.totalCents - paid > 0) await registerPayment(ctx, { saleId: o.id, amountCents: s.totalCents - paid, methodId: pick(methods) })
        openSales.splice(openSales.indexOf(o), 1)
      }
    }
    // Gastos menores en efectivo
    if (rnd() < 0.25) await saveExpense(ctx, { concept: pick(['Limpieza del taller', 'Papelería', 'Combustible de traslados']), categoryId: pick(['limpieza', 'administrativos', 'combustible']), amountCents: 8000 + Math.floor(rnd() * 12000) }, { methodId: 'efectivo' })
    // Reposición semanal y pagos a proveedores
    if (d > 0 && d % 7 === 3) {
      await restock((i) => (rnd() < 0.55 ? Math.ceil(PRODUCTS[i][6] * 1.5) : 0))
      for (const r of await ctx.db.receipts.toArray()) {
        const bal = receiptBalance(r, await ctx.db.ledger.toArray())
        if (bal > 0 && r.dueDate <= today(ctx) && rnd() < 0.8) await paySupplier(ctx, { supplierId: r.supplierId, allocations: [{ receiptId: r.id, amountCents: bal }], methodId: 'transferencia' })
      }
    }
    for (const e of await ctx.db.expenses.toArray()) {
      if (e.date <= addDays(today(ctx), -2) && rnd() < 0.3) {
        const led = await ctx.db.ledger.where('expenseId').equals(e.id).toArray()
        const bal = e.amountCents + e.taxCents - led.reduce((a, l) => a + l.amountCents, 0)
        if (bal > 0) await payExpense(ctx, e.id, bal, 'transferencia').catch(() => undefined)
      }
    }
    // Cierre de caja (a veces con una pequeña diferencia)
    await day(d, 8, 30)
    const sess = await currentSession(ctx)
    if (sess && !recent) {
      const exp = await sessionExpected(ctx, sess.id), diff = rnd() < 0.15 ? -(100 * (1 + Math.floor(rnd() * 5))) : 0
      await closeSession(ctx, Math.max(0, exp + diff), diff ? 'Diferencia por cambio (demo)' : '')
    }
    onProgress(5 + Math.round((d / days) * 90), 100, `Día ${d + 1} de ${days}`)
  }
  await day(days, 0, 0)
  onProgress(100, 100, 'Listo')
  if (!(await ctx.db.workOrders.count())) fail('No se pudo generar la demostración.')
  return { ...ctx, now: () => new Date() }
}
