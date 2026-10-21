import { addDays } from '../domain/dates'
import { receiptBalance } from '../domain/finance'
import { round, round3 } from '../domain/money'
import type { PurchaseItem, PurchaseOrder, PurchaseReceipt, ReceiptItem, Supplier } from '../domain/types'
import { audit, fail, load, need, nextFolio, once, requirePositive, requireText, stamp, today, trim, tx, uid, type Ctx } from './core'
import { moveIn } from './inventory'
import { recordLedger } from './cash'

export type SupplierInput = Partial<Omit<Supplier, 'orgId' | 'createdAt' | 'updatedAt'>> & { name: string }
export async function saveSupplier(ctx: Ctx, i: SupplierInput): Promise<Supplier> {
  need(ctx, 'compras.editar')
  const name = requireText(i.name, 'El nombre del proveedor')
  const email = trim(i.email)
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('El correo electrónico no es válido.')
  if (!(((i.paymentTermsDays ?? 0) >= 0) && ((i.leadDays ?? 0) >= 0))) fail('Los plazos no pueden ser negativos.')
  return tx(ctx, async () => {
    const at = stamp(ctx)
    const cur = i.id ? await load(ctx, ctx.db.suppliers, i.id, 'El proveedor') : null
    const s: Supplier = { id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, name, contact: trim(i.contact), phone: trim(i.phone), email, address: trim(i.address), taxId: trim(i.taxId).toUpperCase(), paymentTermsDays: i.paymentTermsDays ?? 0, leadDays: i.leadDays ?? 0, notes: trim(i.notes), active: i.active ?? cur?.active ?? true }
    await ctx.db.suppliers.put(s)
    if (!cur) await audit(ctx, 'proveedor.creado', 'proveedor', s.id, { after: { name } })
    return s
  })
}

export interface POInput { supplierId: string; date?: string; expectedDate?: string; items: { productId: string; qty: number; unitCostCents: number; discountCents?: number }[]; freightCents?: number; taxRate?: number; notes?: string }
async function buildItems(ctx: Ctx, items: POInput['items']): Promise<PurchaseItem[]> {
  if (!items.length) fail('Agrega al menos un producto a la compra.')
  const out: PurchaseItem[] = []
  for (const it of items) {
    const p = await load(ctx, ctx.db.products, it.productId, 'El producto')
    requirePositive(it.qty, `La cantidad de ${p.name}`)
    if (!(it.unitCostCents >= 0)) fail(`El costo de ${p.name} no puede ser negativo.`)
    const disc = it.discountCents ?? 0
    if (disc < 0 || disc > Math.round(it.qty * it.unitCostCents)) fail(`El descuento de ${p.name} no es válido.`)
    out.push({ id: uid(), productId: p.id, description: p.name, qty: it.qty, receivedQty: 0, unitCostCents: it.unitCostCents, discountCents: disc })
  }
  return out
}

export async function savePurchaseOrder(ctx: Ctx, i: POInput, id?: string): Promise<PurchaseOrder> {
  need(ctx, 'compras.editar')
  if ((i.freightCents ?? 0) < 0) fail('El flete no puede ser negativo.')
  return tx(ctx, async () => {
    await load(ctx, ctx.db.suppliers, i.supplierId, 'El proveedor')
    const at = stamp(ctx)
    const cur = id ? await load(ctx, ctx.db.purchaseOrders, id, 'La orden de compra') : null
    if (cur && !['borrador', 'enviada'].includes(cur.status)) fail('Solo se pueden editar órdenes en borrador o enviadas sin recepciones.')
    const po: PurchaseOrder = {
      id: cur?.id ?? uid(), orgId: ctx.orgId, createdAt: cur?.createdAt ?? at, updatedAt: at, folio: cur?.folio ?? (await nextFolio(ctx, 'compra')), supplierId: i.supplierId,
      status: cur?.status ?? 'borrador', date: i.date ?? cur?.date ?? today(ctx), expectedDate: i.expectedDate, items: await buildItems(ctx, i.items),
      freightCents: i.freightCents ?? 0, taxRate: i.taxRate ?? 16, notes: trim(i.notes),
    }
    await ctx.db.purchaseOrders.put(po)
    if (!cur) await audit(ctx, 'compra.creada', 'orden_compra', po.id, { after: { folio: po.folio, supplierId: po.supplierId } })
    return po
  })
}
export async function sendPurchaseOrder(ctx: Ctx, id: string): Promise<void> {
  need(ctx, 'compras.editar')
  await tx(ctx, async () => {
    const po = await load(ctx, ctx.db.purchaseOrders, id, 'La orden de compra')
    if (po.status !== 'borrador') fail('Solo se pueden enviar órdenes en borrador.')
    await ctx.db.purchaseOrders.put({ ...po, status: 'enviada', updatedAt: stamp(ctx) })
    await audit(ctx, 'compra.enviada', 'orden_compra', id)
  })
}
export async function cancelPurchaseOrder(ctx: Ctx, id: string, reason: string): Promise<void> {
  need(ctx, 'compras.editar')
  if (!trim(reason)) fail('Indica el motivo de la cancelación.')
  await tx(ctx, async () => {
    const po = await load(ctx, ctx.db.purchaseOrders, id, 'La orden de compra')
    if (po.status === 'recibida' || po.status === 'cancelada') fail('La orden ya no se puede cancelar.')
    await ctx.db.purchaseOrders.put({ ...po, status: 'cancelada', cancelReason: trim(reason), updatedAt: stamp(ctx) })
    await audit(ctx, 'compra.cancelada', 'orden_compra', id, { reason: trim(reason) })
  })
}

const EPS = 1e-9
/**
 * Recepción (total o parcial). Suma al inventario SOLO lo recibido, con costo de adquisición completo
 * (mercancía − descuento + parte proporcional del flete); el IVA acreditable no forma parte del costo.
 * Genera la obligación de pago. Con la misma `opKey` no se vuelve a procesar.
 */
export async function receivePurchase(ctx: Ctx, poId: string, lines: { itemId: string; qty: number }[], o: { invoiceRef?: string; date?: string; dueDate?: string } = {}, opKey?: string): Promise<PurchaseReceipt> {
  need(ctx, 'compras.recibir')
  const merged = new Map<string, number>()
  for (const l of lines) if (l.qty > 0) merged.set(l.itemId, (merged.get(l.itemId) ?? 0) + l.qty)
  const todo = [...merged].map(([itemId, qty]) => ({ itemId, qty }))
  if (!todo.length) fail('Indica al menos una cantidad recibida.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'recepcion', async () => {
      const po = await load(ctx, ctx.db.purchaseOrders, poId, 'La orden de compra')
      if (!['borrador', 'enviada', 'parcial'].includes(po.status)) fail('Esta orden no admite recepciones.')
      const sup = await load(ctx, ctx.db.suppliers, po.supplierId, 'El proveedor')
      const lineGoods = (it: PurchaseItem, q: number) => round(q * it.unitCostCents - (it.discountCents * q) / it.qty)
      const items = po.items.map((x) => ({ ...x }))
      const rec: { it: PurchaseItem; qty: number; goods: number }[] = []
      for (const l of todo) {
        const it = items.find((x) => x.id === l.itemId) ?? fail('La partida no pertenece a la orden.')
        const pending = round3(it.qty - it.receivedQty)
        if (l.qty > pending + EPS) fail(`${it.description}: solo faltan ${pending} por recibir (recibir de más duplicaría el inventario).`)
        rec.push({ it, qty: l.qty, goods: lineGoods(it, l.qty) })
      }
      const sumGoods = rec.reduce((a, x) => a + x.goods, 0)
      const orderedGoods = po.items.reduce((a, it) => a + lineGoods(it, it.qty), 0)
      for (const r of rec) r.it.receivedQty = round3(r.it.receivedQty + r.qty)
      const complete = items.every((it) => it.qty - it.receivedQty < EPS)
      const priorFreight = (await ctx.db.receipts.where('purchaseOrderId').equals(po.id).toArray()).reduce((a, r) => a + r.freightCents, 0)
      const freight = po.freightCents <= 0 ? 0 : complete ? po.freightCents - priorFreight : orderedGoods > 0 ? round((po.freightCents * sumGoods) / orderedGoods) : 0
      const receiptId = uid(), at = stamp(ctx), date = o.date ?? today(ctx)
      let freightLeft = freight
      const rItems: ReceiptItem[] = []
      for (let k = 0; k < rec.length; k++) {
        const r = rec[k]
        const fshare = k === rec.length - 1 ? freightLeft : sumGoods > 0 ? round((freight * r.goods) / sumGoods) : 0
        freightLeft -= fshare
        const landed = r.goods + fshare
        const mv = await moveIn(ctx, { productId: r.it.productId, qty: r.qty, totalCostCents: landed, type: 'compra', refType: 'recepcion', refId: receiptId, reason: `Recepción ${po.folio}` })
        rItems.push({ itemId: r.it.id, productId: r.it.productId, qty: r.qty, goodsCents: r.goods, freightCents: fshare, landedCents: landed, movementId: mv.id })
        const unit = landed / r.qty
        const p = await ctx.db.products.get(r.it.productId)
        if (p) await ctx.db.products.put({ ...p, prevPurchaseCost: p.lastPurchaseCost, lastPurchaseCost: unit, updatedAt: at })
        const spId = `${sup.id}:${r.it.productId}`
        const sp = await ctx.db.supplierProducts.get(spId)
        await ctx.db.supplierProducts.put({ id: spId, orgId: ctx.orgId, supplierId: sup.id, productId: r.it.productId, supplierSku: sp?.supplierSku ?? '', lastCostCents: round(unit), updatedAt: at })
      }
      const tax = round(((sumGoods + freight) * po.taxRate) / 100)
      const receipt: PurchaseReceipt = {
        id: receiptId, orgId: ctx.orgId, createdAt: at, updatedAt: at, folio: await nextFolio(ctx, 'recepcion'), purchaseOrderId: po.id, supplierId: sup.id, date,
        dueDate: o.dueDate ?? addDays(date, sup.paymentTermsDays), invoiceRef: trim(o.invoiceRef), items: rItems, goodsCents: sumGoods, freightCents: freight, taxCents: tax, totalCents: sumGoods + freight + tax, opKey,
      }
      await ctx.db.receipts.add(receipt)
      await ctx.db.purchaseOrders.put({ ...po, items, status: complete ? 'recibida' : 'parcial', updatedAt: at })
      await audit(ctx, 'compra.recepcion', 'recepcion', receiptId, { after: { folio: receipt.folio, po: po.folio, totalCents: receipt.totalCents, parcial: !complete } })
      return receipt
    }, (id) => ctx.db.receipts.get(id) as Promise<PurchaseReceipt>)
    return value
  })
}

export interface SupplierPayInput { supplierId: string; allocations: { receiptId: string; amountCents: number }[]; methodId: string; reference?: string; date?: string; note?: string }
/** Pago a proveedor aplicado a recepciones concretas. Nunca excede el saldo de cada documento; no reduce el saldo hasta quedar registrado. */
export async function paySupplier(ctx: Ctx, i: SupplierPayInput, opKey?: string) {
  need(ctx, 'pagos_proveedor.registrar')
  const allocs = i.allocations.filter((a) => a.amountCents > 0)
  if (!allocs.length) fail('Indica el importe a pagar.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'pago_proveedor', async () => {
      await load(ctx, ctx.db.suppliers, i.supplierId, 'El proveedor')
      const ledger = await ctx.db.ledger.where('kind').anyOf('pago_proveedor', 'reembolso_proveedor').toArray()
      let total = 0
      for (const a of allocs) {
        if (!Number.isInteger(a.amountCents)) fail('Los importes deben estar en centavos enteros.')
        const r = await load(ctx, ctx.db.receipts, a.receiptId, 'La recepción')
        if (r.supplierId !== i.supplierId) fail('La recepción no pertenece a ese proveedor.')
        const bal = receiptBalance(r, ledger)
        if (a.amountCents > bal) fail(`${r.folio}: el pago (${a.amountCents / 100}) supera el saldo pendiente (${bal / 100}).`)
        total += a.amountCents
      }
      const e = await recordLedger(ctx, { kind: 'pago_proveedor', direction: 'out', amountCents: total, methodId: i.methodId, reference: trim(i.reference), note: trim(i.note), supplierId: i.supplierId, allocations: allocs, date: i.date, opKey })
      await audit(ctx, 'pago_proveedor.registrado', 'proveedor', i.supplierId, { after: { amountCents: total, allocations: allocs, methodId: i.methodId } })
      return e
    }, (id) => ctx.db.ledger.get(id) as Promise<import('../domain/types').LedgerEntry>)
    return value
  })
}
