import { InsufficientStock, avgCost, issue, receive } from '../domain/inventory'
import { round, round3 } from '../domain/money'
import type { InventoryBalance, InventoryMovement, MovementType, Product } from '../domain/types'
import { audit, fail, load, need, once, requirePositive, stamp, today, trim, tx, uid, type Ctx } from './core'

export async function defaultWarehouseId(ctx: Ctx): Promise<string> {
  const w = (await ctx.db.warehouses.toArray()).find((x) => x.isDefault) ?? (await ctx.db.warehouses.toArray())[0]
  return w ? w.id : fail('No hay almacén configurado.')
}
const balId = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`

export async function getBalance(ctx: Ctx, productId: string, warehouseId?: string): Promise<InventoryBalance> {
  const wh = warehouseId ?? (await defaultWarehouseId(ctx))
  return (await ctx.db.balances.get(balId(productId, wh))) ?? { id: balId(productId, wh), orgId: ctx.orgId, productId, warehouseId: wh, qty: 0, valueCents: 0 }
}
/** Costo unitario vigente (centavos, decimal): promedio ponderado; si no hay existencias, el último costo de compra. */
export async function currentUnitCost(ctx: Ctx, productId: string): Promise<number> {
  const bs = await ctx.db.balances.where('productId').equals(productId).toArray()
  const qty = bs.reduce((a, b) => a + b.qty, 0), val = bs.reduce((a, b) => a + b.valueCents, 0)
  if (qty > 0) return val / qty
  const p = await ctx.db.products.get(productId)
  return p?.lastPurchaseCost ?? 0
}

interface MoveBase { productId: string; type: MovementType; refType: string; refId: string; reason: string; warehouseId?: string; opKey?: string; reverses?: string }

/** Entrada al inventario con su costo total (centavos). Debe ejecutarse dentro de `tx`. */
export async function moveIn(ctx: Ctx, p: MoveBase & { qty: number; totalCostCents: number }): Promise<InventoryMovement> {
  requirePositive(p.qty, 'La cantidad')
  const product = await load(ctx, ctx.db.products, p.productId, 'El producto')
  const wh = p.warehouseId ?? (await defaultWarehouseId(ctx))
  const b = await getBalance(ctx, p.productId, wh)
  const nb = receive(b, p.qty, p.totalCostCents)
  await ctx.db.balances.put({ ...b, qty: nb.qty, valueCents: nb.valueCents })
  const m: InventoryMovement = {
    id: uid(), orgId: ctx.orgId, productId: product.id, warehouseId: wh, type: p.type, qty: round3(p.qty), unitCost: p.totalCostCents / p.qty, totalCostCents: p.totalCostCents,
    refType: p.refType, refId: p.refId, userId: ctx.user.id, reason: p.reason, at: stamp(ctx), date: today(ctx), reverses: p.reverses, opKey: p.opKey,
  }
  await ctx.db.movements.add(m)
  return m
}

/** Salida valorada con el costo promedio vigente. Falla si no hay existencias suficientes. Dentro de `tx`. */
export async function moveOut(ctx: Ctx, p: MoveBase & { qty: number }): Promise<InventoryMovement> {
  requirePositive(p.qty, 'La cantidad')
  const product = await load(ctx, ctx.db.products, p.productId, 'El producto')
  const wh = p.warehouseId ?? (await defaultWarehouseId(ctx))
  const b = await getBalance(ctx, p.productId, wh)
  let out
  try { out = issue(b, p.qty) } catch (e) {
    if (e instanceof InsufficientStock) return fail(`${product.name}: ${e.message}`)
    throw e
  }
  await ctx.db.balances.put({ ...b, qty: out.balance.qty, valueCents: out.balance.valueCents })
  const m: InventoryMovement = {
    id: uid(), orgId: ctx.orgId, productId: product.id, warehouseId: wh, type: p.type, qty: -round3(p.qty), unitCost: out.unitCost, totalCostCents: -out.costCents,
    refType: p.refType, refId: p.refId, userId: ctx.user.id, reason: p.reason, at: stamp(ctx), date: today(ctx), reverses: p.reverses, opKey: p.opKey,
  }
  await ctx.db.movements.add(m)
  return m
}

/** Movimiento compensatorio: devuelve al inventario una salida previa conservando su costo original. */
export async function returnOut(ctx: Ctx, original: InventoryMovement, qty: number, type: MovementType, reason: string, refType: string, refId: string): Promise<InventoryMovement> {
  if (original.qty >= 0) fail('Solo se pueden devolver salidas de inventario.')
  const total = qty === Math.abs(original.qty) ? Math.abs(original.totalCostCents) : round((Math.abs(original.totalCostCents) * qty) / Math.abs(original.qty))
  return moveIn(ctx, { productId: original.productId, qty, totalCostCents: total, type, refType, refId, reason, warehouseId: original.warehouseId, reverses: original.id })
}

/* ───────── Operaciones manuales ───────── */
export interface AdjustInput { productId: string; qty: number; direction: 'entrada' | 'salida'; kind: 'ajuste' | 'merma' | 'entrada'; unitCostCents?: number; reason: string }
export async function adjustStock(ctx: Ctx, i: AdjustInput, opKey?: string): Promise<InventoryMovement> {
  need(ctx, 'inventario.ajustar')
  requirePositive(i.qty, 'La cantidad')
  const reason = trim(i.reason)
  if (!reason && i.kind !== 'entrada') fail('Indica el motivo del ajuste.')
  return tx(ctx, async () => {
    const { value } = await once(ctx, opKey, 'ajuste', async () => {
      if (i.direction === 'salida') {
        const type: MovementType = i.kind === 'merma' ? 'merma' : 'ajuste_negativo'
        const m = await moveOut(ctx, { productId: i.productId, qty: i.qty, type, refType: 'ajuste', refId: '', reason })
        await audit(ctx, 'inventario.ajuste', 'producto', i.productId, { after: { type, qty: m.qty, costCents: m.totalCostCents }, reason })
        return m
      }
      const unit = i.unitCostCents ?? (await currentUnitCost(ctx, i.productId))
      if (!(unit > 0)) fail('Indica el costo unitario: el producto no tiene un costo previo.')
      const m = await moveIn(ctx, { productId: i.productId, qty: i.qty, totalCostCents: round(unit * i.qty), type: i.kind === 'entrada' ? 'entrada' : 'ajuste_positivo', refType: 'ajuste', refId: '', reason: reason || 'Entrada manual' })
      await audit(ctx, 'inventario.ajuste', 'producto', i.productId, { after: { type: m.type, qty: m.qty, costCents: m.totalCostCents }, reason })
      return m
    }, (id) => ctx.db.movements.get(id) as Promise<InventoryMovement>)
    return value
  })
}

/** Inventario físico: genera un ajuste por cada diferencia entre lo contado y el sistema. */
export async function physicalCount(ctx: Ctx, counts: { productId: string; counted: number }[], reason: string): Promise<{ productId: string; diff: number }[]> {
  need(ctx, 'inventario.ajustar')
  return tx(ctx, async () => {
    const out: { productId: string; diff: number }[] = []
    for (const c of counts) {
      if (!(c.counted >= 0)) fail('Las cantidades contadas no pueden ser negativas.')
      const b = await getBalance(ctx, c.productId)
      const diff = round3(c.counted - b.qty)
      if (diff === 0) continue
      if (diff < 0) await moveOut(ctx, { productId: c.productId, qty: -diff, type: 'inventario_fisico', refType: 'conteo', refId: '', reason: reason || 'Inventario físico' })
      else {
        const unit = avgCost(b) || (await currentUnitCost(ctx, c.productId))
        await moveIn(ctx, { productId: c.productId, qty: diff, totalCostCents: round(unit * diff), type: 'inventario_fisico', refType: 'conteo', refId: '', reason: reason || 'Inventario físico' })
      }
      out.push({ productId: c.productId, diff })
    }
    await audit(ctx, 'inventario.conteo_fisico', 'inventario', '', { after: { diferencias: out }, reason })
    return out
  })
}

export const totalStock = (balances: readonly InventoryBalance[], productId: string): number => balances.filter((b) => b.productId === productId).reduce((a, b) => a + b.qty, 0)
export const productStockValue = (balances: readonly InventoryBalance[], productId: string): number => balances.filter((b) => b.productId === productId).reduce((a, b) => a + b.valueCents, 0)
export type { Product }
