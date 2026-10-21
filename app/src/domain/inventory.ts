import { round, round3 } from './money'

/** Saldo de un producto en un almacén. El valor se lleva en centavos enteros; el costo promedio es valor ÷ existencias. */
export interface Balance { qty: number; valueCents: number }
export class InsufficientStock extends Error {
  available: number; requested: number
  constructor(available: number, requested: number) { super(`Inventario insuficiente: hay ${available} y se piden ${requested}.`); this.available = available; this.requested = requested }
}
const EPS = 1e-9
export const avgCost = (b: Balance): number => (b.qty > EPS ? b.valueCents / b.qty : 0)

/** Costo promedio ponderado móvil: una entrada suma cantidad y valor. */
export function receive(b: Balance, qty: number, totalCostCents: number): Balance {
  if (!(qty > 0)) throw new Error('La cantidad debe ser mayor que cero.')
  return { qty: round3(b.qty + qty), valueCents: b.valueCents + totalCostCents }
}

/** Una salida cuesta lo que indique el promedio vigente; si sale todo, sale todo el valor (sin residuos de redondeo). */
export function issue(b: Balance, qty: number): { balance: Balance; costCents: number; unitCost: number } {
  if (!(qty > 0)) throw new Error('La cantidad debe ser mayor que cero.')
  if (qty > b.qty + EPS) throw new InsufficientStock(b.qty, qty)
  const costCents = Math.abs(b.qty - qty) < EPS ? b.valueCents : round((b.valueCents * qty) / b.qty)
  return { balance: { qty: round3(b.qty - qty), valueCents: b.valueCents - costCents }, costCents, unitCost: qty > 0 ? costCents / qty : 0 }
}
