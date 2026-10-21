import { round } from './money'
import { marginPct, markupPct } from './pricing'

export interface LineInput { qty: number; unitPriceCents: number; discountCents: number; taxRate: number }
export interface LineAmounts { netCents: number; taxCents: number; totalCents: number }

/**
 * Importes de una partida. Con `pricesIncludeTax` el precio capturado ya incluye impuestos:
 * total = qty×precio − descuento; neto = total ÷ (1+tasa). Si no, neto = qty×precio − descuento; impuesto = neto×tasa.
 * El descuento se expresa en la misma base que el precio (con o sin impuestos).
 */
export function lineAmounts(l: LineInput, pricesIncludeTax: boolean): LineAmounts {
  const gross = round(l.qty * l.unitPriceCents) - l.discountCents
  const r = l.taxRate / 100
  if (pricesIncludeTax) {
    const net = round(gross / (1 + r))
    return { netCents: net, taxCents: gross - net, totalCents: gross }
  }
  const tax = round(gross * r)
  return { netCents: gross, taxCents: tax, totalCents: gross + tax }
}

export function sumLines(ls: LineAmounts[]): LineAmounts {
  return ls.reduce((a, l) => ({ netCents: a.netCents + l.netCents, taxCents: a.taxCents + l.taxCents, totalCents: a.totalCents + l.totalCents }), { netCents: 0, taxCents: 0, totalCents: 0 })
}

export interface LineProfit { netCents: number; costCents: number; profitCents: number; marginPct: number | null; markupPct: number | null }
export const lineProfit = (netCents: number, costCents: number): LineProfit => ({
  netCents, costCents, profitCents: netCents - costCents, marginPct: marginPct(netCents, costCents), markupPct: markupPct(netCents, costCents),
})
