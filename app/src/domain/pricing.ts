import { round } from './money'

/**
 * Definiciones (base explícita):
 *  - Margen = utilidad ÷ VENTA NETA (antes de impuestos) × 100
 *  - Markup = utilidad ÷ COSTO × 100
 * Devuelven null cuando la base es cero o negativa («no calculable»): nunca un porcentaje engañoso.
 */
export const profitCents = (netCents: number, costCents: number): number => netCents - costCents

export function marginPct(netCents: number, costCents: number): number | null {
  if (!(netCents > 0)) return null
  return ((netCents - costCents) / netCents) * 100
}

export function markupPct(netCents: number, costCents: number): number | null {
  if (!(costCents > 0)) return null
  return ((netCents - costCents) / costCents) * 100
}

/** Precio objetivo = costo ÷ (1 − margen). No calculable si margen ≥ 100 % o costo ≤ 0. */
export function targetPriceCents(costCents: number, targetMarginPct: number): number | null {
  if (!(costCents > 0) || !(targetMarginPct < 100) || !isFinite(targetMarginPct)) return null
  return round(costCents / (1 - targetMarginPct / 100))
}

export interface PriceQuoteInput {
  purchaseCostCents: number; extraCostCents?: number; laborCostCents?: number
  targetMarginPct: number; taxRate: number; discountPct?: number
}
export interface PriceQuoteResult {
  totalCostCents: number
  /** Precio de lista (antes de descuento e impuestos) que logra el margen objetivo después del descuento previsto. */
  suggestedNetCents: number | null
  netAfterDiscountCents: number | null
  profitCents: number | null; marginPct: number | null; markupPct: number | null
  finalPriceWithTaxCents: number | null
}
/** Calculadora de precios: el descuento previsto reduce el ingreso, por lo que el precio de lista se ajusta para conservar el margen. */
export function priceCalculator(i: PriceQuoteInput): PriceQuoteResult {
  const cost = round(i.purchaseCostCents + (i.extraCostCents ?? 0) + (i.laborCostCents ?? 0))
  const netAfter = targetPriceCents(cost, i.targetMarginPct)
  const disc = i.discountPct ?? 0
  if (netAfter === null || disc >= 100 || disc < 0) {
    return { totalCostCents: cost, suggestedNetCents: null, netAfterDiscountCents: null, profitCents: null, marginPct: null, markupPct: null, finalPriceWithTaxCents: null }
  }
  const list = round(netAfter / (1 - disc / 100))
  return {
    totalCostCents: cost, suggestedNetCents: list, netAfterDiscountCents: netAfter,
    profitCents: netAfter - cost, marginPct: marginPct(netAfter, cost), markupPct: markupPct(netAfter, cost),
    finalPriceWithTaxCents: round(netAfter * (1 + i.taxRate / 100)),
  }
}

export interface BreakEvenInput { fixedCostsCents: number; variableCostPct: number; actualSalesCents?: number }
export interface BreakEvenResult {
  contributionMarginPct: number; breakEvenSalesCents: number | null; reachable: boolean; message: string
  gapCents: number | null; coveredPct: number | null
}
/** Punto de equilibrio en ventas = costos fijos ÷ margen de contribución (%). Es una proyección, no un resultado real. */
export function breakEven(i: BreakEvenInput): BreakEvenResult {
  const cm = 100 - i.variableCostPct
  if (!(cm > 0)) {
    return { contributionMarginPct: cm, breakEvenSalesCents: null, reachable: false, gapCents: null, coveredPct: null,
      message: 'El margen de contribución es cero o negativo: con esta estructura de costos variables no existe un punto de equilibrio alcanzable.' }
  }
  const be = round(i.fixedCostsCents / (cm / 100))
  const actual = i.actualSalesCents
  return {
    contributionMarginPct: cm, breakEvenSalesCents: be, reachable: true,
    gapCents: actual === undefined ? null : actual - be,
    coveredPct: actual === undefined || be <= 0 ? null : (actual / be) * 100,
    message: actual === undefined ? 'Proyección con los supuestos indicados.' : actual >= be ? 'Las ventas del periodo superan el punto de equilibrio.' : 'Las ventas del periodo aún no cubren el punto de equilibrio.',
  }
}
