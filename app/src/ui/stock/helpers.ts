import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { netPrice, productAlertFor, taxRateOf, type PriceAlert } from '../../domain/alerts'
import { addDays } from '../../domain/dates'
import { round, round3 } from '../../domain/money'
import { marginPct, markupPct } from '../../domain/pricing'
import { receiptPaid } from '../../domain/finance'
import type { InventoryMovement, LedgerEntry, MovementType, Product, PurchaseItem, PurchaseOrder, PurchaseReceipt, PurchaseStatus } from '../../domain/types'
import { averageHourlyLaborCost } from '../../services/catalog'
import type { Ctx } from '../../services/core'
import { cancelPurchaseOrder, sendPurchaseOrder } from '../../services/purchasing'
import { unitCostOf } from '../alerts'
import type { Data } from '../data'
import { useCtx } from '../session'
import { useBusy, useUi } from '../ui'

/** Normaliza texto para búsquedas sin acentos ni mayúsculas. */
export const norm = (s: string | undefined | null): string => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export const MOVE_LABEL: Record<MovementType, string> = {
  compra: 'Compra recibida', entrada: 'Entrada manual', venta: 'Venta', consumo_orden: 'Consumo en orden', devolucion_cliente: 'Devolución de cliente',
  devolucion_orden: 'Devolución de orden', ajuste_positivo: 'Ajuste (+)', ajuste_negativo: 'Ajuste (−)', merma: 'Merma', traspaso_salida: 'Traspaso (salida)',
  traspaso_entrada: 'Traspaso (entrada)', inventario_fisico: 'Inventario físico', devolucion_proveedor: 'Devolución a proveedor',
}
export const MOVE_TONE = (m: InventoryMovement): '' | 'ok' | 'warn' | 'bad' | 'info' =>
  m.type === 'merma' || m.type === 'ajuste_negativo' ? 'bad' : m.type === 'inventario_fisico' ? 'warn' : m.qty > 0 ? 'ok' : ''

export const PO_LABEL: Record<PurchaseStatus, string> = { borrador: 'Borrador', enviada: 'Enviada', parcial: 'Recibida parcial', recibida: 'Recibida', cancelada: 'Cancelada' }
export const PO_TONE: Record<PurchaseStatus, '' | 'ok' | 'warn' | 'bad' | 'info'> = { borrador: '', enviada: 'info', parcial: 'warn', recibida: 'ok', cancelada: 'bad' }

export const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : ''}${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(Math.abs(n))}`
export const unitWord = (p: Product | undefined): string => p?.unit ?? ''

/* ───────── Productos: cálculos derivados ───────── */
export type StockState = 'ok' | 'bajo' | 'agotado'
export interface PRow {
  p: Product; qty: number; value: number; cost: number; costIsLast: boolean; net: number; margin: number | null; markup: number | null
  alert: PriceAlert; state: StockState; out60: number; lastMove?: string
}

/** Salidas por venta y consumo de orden en los últimos 60 días, por producto (cantidad positiva). */
export function outflows(movements: readonly InventoryMovement[], today: string, days = 60): Map<string, number> {
  const from = addDays(today, -days), m = new Map<string, number>()
  for (const x of movements) if ((x.type === 'venta' || x.type === 'consumo_orden') && x.date >= from && x.date <= today) m.set(x.productId, round3((m.get(x.productId) ?? 0) + Math.abs(x.qty)))
  return m
}
export function lastMoves(movements: readonly InventoryMovement[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const x of movements) if (x.date > (m.get(x.productId) ?? '')) m.set(x.productId, x.date)
  return m
}

export function useProductRows(d: Data): PRow[] {
  return useMemo(() => {
    const out60 = outflows(d.movements, d.today), last = lastMoves(d.movements)
    return d.products.map((p): PRow => {
      const st = d.stock.get(p.id) ?? { qty: 0, valueCents: 0 }
      const cost = unitCostOf(d, p.id)
      const alert = productAlertFor(p, cost, d.settings)
      const net = netPrice(p.priceCents, taxRateOf(d.settings, p.taxId), d.settings.pricesIncludeTax)
      return {
        p, qty: st.qty, value: st.valueCents, cost, costIsLast: !(st.qty > 0), net, margin: cost > 0 ? marginPct(net, cost) : null, markup: cost > 0 ? markupPct(net, cost) : null,
        alert, state: st.qty <= 0 ? 'agotado' : st.qty <= p.minStock ? 'bajo' : 'ok', out60: out60.get(p.id) ?? 0, lastMove: last.get(p.id),
      }
    })
  }, [d])
}

/** Cantidad sugerida de compra = máx(0, mínimo × 2 + consumo diario × días de entrega − existencias), redondeada hacia arriba. */
export const suggestQty = (minStock: number, qty: number, dailyUse: number, leadDays: number): number =>
  Math.max(0, Math.ceil(round3(minStock * 2 + dailyUse * leadDays - qty)))

/** Último costo de compra de un producto con un proveedor (centavos), si existe. */
export function supplierCost(d: Data, supplierId: string | undefined, productId: string): number | undefined {
  if (!supplierId) return undefined
  return d.supplierProducts.find((x) => x.supplierId === supplierId && x.productId === productId)?.lastCostCents
}
/** Costo sugerido para una partida de compra: último con el proveedor, último de compra del producto o costo vigente (centavos enteros). */
export function defaultPurchaseCost(d: Data, supplierId: string | undefined, productId: string): number {
  const c = supplierCost(d, supplierId, productId) ?? d.prodMap.get(productId)?.lastPurchaseCost ?? unitCostOf(d, productId)
  return round(c || 0)
}

/* ───────── Compras ───────── */
export const lineGoods = (it: Pick<PurchaseItem, 'qty' | 'unitCostCents' | 'discountCents'>, q = it.qty): number => round(q * it.unitCostCents - (it.discountCents * q) / it.qty)
export interface Totals { goods: number; freight: number; tax: number; total: number }
export function poTotals(po: { items: Pick<PurchaseItem, 'qty' | 'unitCostCents' | 'discountCents'>[]; freightCents: number; taxRate: number }): Totals {
  const goods = po.items.reduce((a, it) => a + (it.qty > 0 ? lineGoods(it) : 0), 0)
  const tax = round(((goods + po.freightCents) * po.taxRate) / 100)
  return { goods, freight: po.freightCents, tax, total: goods + po.freightCents + tax }
}
export const pendingQty = (it: PurchaseItem): number => Math.max(0, round3(it.qty - it.receivedQty))
export const isLate = (po: PurchaseOrder, today: string): boolean => (po.status === 'enviada' || po.status === 'parcial') && !!po.expectedDate && po.expectedDate < today
export const canEditPO = (po: PurchaseOrder, receipts: readonly PurchaseReceipt[]): boolean =>
  (po.status === 'borrador' || po.status === 'enviada') && po.items.every((i) => i.receivedQty === 0) && !receipts.some((r) => r.purchaseOrderId === po.id)

export interface RecvPreviewLine { item: PurchaseItem; qty: number; goods: number; freight: number; landed: number; unit: number }
export interface RecvPreview { lines: RecvPreviewLine[]; goods: number; freight: number; tax: number; total: number; complete: boolean }
/** Replica la prorrata del servicio `receivePurchase` (mercancía − descuento + parte proporcional del flete) para mostrarla antes de confirmar. */
export function previewReceipt(po: PurchaseOrder, prior: readonly PurchaseReceipt[], qtys: ReadonlyMap<string, number>): RecvPreview {
  const rec = po.items.filter((it) => (qtys.get(it.id) ?? 0) > 0).map((it) => ({ it, qty: qtys.get(it.id) as number, goods: lineGoods(it, qtys.get(it.id) as number) }))
  const sumGoods = rec.reduce((a, x) => a + x.goods, 0)
  const orderedGoods = po.items.reduce((a, it) => a + lineGoods(it, it.qty), 0)
  const complete = po.items.every((it) => it.qty - it.receivedQty - (qtys.get(it.id) ?? 0) < 1e-9)
  const priorFreight = prior.filter((r) => r.purchaseOrderId === po.id).reduce((a, r) => a + r.freightCents, 0)
  const freight = po.freightCents <= 0 ? 0 : complete ? po.freightCents - priorFreight : orderedGoods > 0 ? round((po.freightCents * sumGoods) / orderedGoods) : 0
  let left = freight
  const lines = rec.map((r, k): RecvPreviewLine => {
    const share = k === rec.length - 1 ? left : sumGoods > 0 ? round((freight * r.goods) / sumGoods) : 0
    left -= share
    const landed = r.goods + share
    return { item: r.it, qty: r.qty, goods: r.goods, freight: share, landed, unit: r.qty > 0 ? landed / r.qty : 0 }
  })
  const tax = round(((sumGoods + freight) * po.taxRate) / 100)
  return { lines, goods: sumGoods, freight, tax, total: sumGoods + freight + tax, complete }
}

/* ───────── Hooks ───────── */
/** Nombres de usuario por id (solo id y nombre; nunca PIN). */
export function useUserNames(ctx: Ctx): Map<string, string> {
  const us = useLiveQuery(() => ctx.db.users.toArray(), [ctx.db])
  return useMemo(() => new Map((us ?? []).map((u) => [u.id, u.name])), [us])
}

/** Parámetro de la URL (`?nombre=`): lectura y escritura sin perder los demás parámetros. */
export function useParam(name: string): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams()
  return [sp.get(name) ?? '', (v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set(name, v); else n.delete(name); return n }, { replace: true })]
}
/** Texto de búsqueda ligado a `?q=`: el campo responde al instante y la URL se actualiza después. */
export function useQParam(): [string, (v: string) => void] {
  const [url, setUrl] = useParam('q')
  const [draft, setDraft] = useState<{ v: string; base: string } | null>(null)
  useEffect(() => {
    if (!draft || draft.v === url) return
    const t = setTimeout(() => setUrl(draft.v), 250)
    return () => clearTimeout(t)
  }, [draft, url, setUrl])
  return [draft && draft.base === url ? draft.v : url, (v: string) => setDraft({ v, base: url })]
}

/** Costo laboral promedio por hora (centavos), tal como lo usa `costBasis` de servicios. `undefined` mientras carga. */
export function useLaborRate(): number | undefined {
  const ctx = useCtx()
  return useLiveQuery(() => averageHourlyLaborCost(ctx), [ctx.db])
}

export const ALERT_BADGE = { bajo_costo: 'Bajo costo', margen_bajo: 'Margen bajo', sin_costo: 'Sin costo' } as const
export const ALERT_TONE = { bajo_costo: 'bad', margen_bajo: 'warn', sin_costo: '' } as const
export const priceLabel = (d: Data) => (d.settings.pricesIncludeTax ? 'Precio (con IVA)' : 'Precio (antes de IVA)')
export const priceNote = (d: Data) => (d.settings.pricesIncludeTax ? 'El precio capturado ya incluye IVA.' : 'El precio capturado es antes de IVA; el impuesto se suma al vender.')

export type PayState = { label: string; tone: '' | 'ok' | 'warn' | 'bad' | 'info'; paid: number; balance: number; late: boolean }
/** Estado de pago de una recepción: independiente de que la mercancía ya esté recibida o la factura registrada. */
export function payState(r: PurchaseReceipt, ledger: readonly LedgerEntry[], today: string): PayState {
  const paid = receiptPaid(r, ledger), balance = r.totalCents - paid, late = balance > 0 && r.dueDate < today
  if (balance <= 0) return { label: 'Pagada', tone: 'ok', paid, balance, late: false }
  if (late) return { label: paid > 0 ? 'Vencida (pago parcial)' : 'Vencida', tone: 'bad', paid, balance, late }
  return { label: paid > 0 ? 'Pago parcial' : 'Por pagar', tone: paid > 0 ? 'warn' : 'info', paid, balance, late }
}

/** Acciones reales sobre órdenes de compra (enviar y cancelar con motivo). */
export function usePoActions() {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const send = (po: PurchaseOrder) => guard(async () => {
    if (!(await ui.confirm(`La orden ${po.folio} pasará a «Enviada» y se podrá recibir. Después de enviarla solo podrás editarla mientras no tenga recepciones.`, 'Marcar como enviada'))) return
    return ui.run(() => sendPurchaseOrder(ctx, po.id).then(() => true), `Orden ${po.folio} enviada`)
  })
  const cancel = (po: PurchaseOrder) => guard(async () => {
    const why = await ui.askReason(`Cancelar ${po.folio}`, 'Motivo de la cancelación', 'Cancelar orden')
    if (!why) return
    return ui.run(() => cancelPurchaseOrder(ctx, po.id, why).then(() => true), `Orden ${po.folio} cancelada`)
  })
  return { busy, send, cancel }
}
