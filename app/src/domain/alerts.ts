import { marginPct } from './pricing'
import { round } from './money'
import type { Product, ServiceDef, Settings } from './types'

export type PriceAlertKind = 'bajo_costo' | 'margen_bajo' | 'sin_costo' | null
export interface PriceAlert { kind: PriceAlertKind; marginPct: number | null; minMarginPct: number; netPriceCents: number }

/** Precio neto (antes de impuestos) a partir del precio de catálogo. */
export function netPrice(priceCents: number, taxRate: number, pricesIncludeTax: boolean): number {
  return pricesIncludeTax ? round(priceCents / (1 + taxRate / 100)) : priceCents
}
export function taxRateOf(s: Pick<Settings, 'taxes'>, taxId: string): number { return s.taxes.find((t) => t.id === taxId)?.rate ?? 0 }

/** Alerta de rentabilidad de un precio contra un costo unitario (centavos, decimal). */
export function priceAlert(priceCents: number, unitCost: number, taxRate: number, s: Pick<Settings, 'pricesIncludeTax' | 'minMarginPct'>, minMargin?: number): PriceAlert {
  const net = netPrice(priceCents, taxRate, s.pricesIncludeTax)
  const min = minMargin ?? s.minMarginPct
  if (!(unitCost > 0)) return { kind: 'sin_costo', marginPct: null, minMarginPct: min, netPriceCents: net }
  const m = marginPct(net, unitCost)
  const kind: PriceAlertKind = net < unitCost ? 'bajo_costo' : m !== null && m < min ? 'margen_bajo' : null
  return { kind, marginPct: m, minMarginPct: min, netPriceCents: net }
}
export const PRICE_ALERT_TEXT: Record<Exclude<PriceAlertKind, null>, string> = {
  bajo_costo: 'Precio por debajo del costo', margen_bajo: 'Margen por debajo del mínimo', sin_costo: 'Sin costo registrado',
}

export const productAlertFor = (p: Product, unitCost: number, s: Settings): PriceAlert => priceAlert(p.priceCents, unitCost, taxRateOf(s, p.taxId), s, p.minMarginPct)
export const serviceAlertFor = (d: ServiceDef, unitCost: number, s: Settings): PriceAlert => priceAlert(d.priceCents, unitCost, taxRateOf(s, d.taxId), s, d.minMarginPct)

/** El costo subió y el precio no se actualizó: el costo vigente supera el costo con el que se fijó el margen mínimo. */
export const costIncreased = (lastCost: number | undefined, newCost: number, thresholdPct = 5): boolean => !!lastCost && lastCost > 0 && newCost > lastCost * (1 + thresholdPct / 100)
