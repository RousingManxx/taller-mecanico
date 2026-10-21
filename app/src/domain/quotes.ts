import { lineAmounts, sumLines } from './lines'
import { marginPct, markupPct } from './pricing'
import { round } from './money'
import type { QuoteItem, QuoteVersion, Settings } from './types'

export interface QuoteSummary {
  netCents: number; taxCents: number; totalCents: number; discountCents: number
  byType: { servicio: number; refaccion: number; otros: number }
  /** Resumen interno: costo estimado y margen previsto. Nunca se muestra en la cotización del cliente salvo configuración explícita. */
  estCostCents: number; estProfitCents: number; estMarginPct: number | null; estMarkupPct: number | null
}
export function quoteSummary(items: readonly QuoteItem[], s: Pick<Settings, 'pricesIncludeTax'>): QuoteSummary {
  const lines = items.map((i) => ({ i, a: lineAmounts(i, s.pricesIncludeTax) }))
  const t = sumLines(lines.map((l) => l.a))
  const byType = { servicio: 0, refaccion: 0, otros: 0 }
  for (const { i, a } of lines) byType[i.type === 'servicio' ? 'servicio' : i.type === 'refaccion' ? 'refaccion' : 'otros'] += a.netCents
  const cost = round(items.reduce((a, i) => a + i.estUnitCost * i.qty, 0))
  return {
    ...t, discountCents: items.reduce((a, i) => a + i.discountCents, 0), byType,
    estCostCents: cost, estProfitCents: t.netCents - cost, estMarginPct: marginPct(t.netCents, cost), estMarkupPct: markupPct(t.netCents, cost),
  }
}
export const currentVersion = (q: { versions: QuoteVersion[]; currentVersion: number }): QuoteVersion => q.versions.find((v) => v.n === q.currentVersion) ?? q.versions[q.versions.length - 1]
export const QUOTE_LABEL: Record<string, string> = { borrador: 'Borrador', enviada: 'Enviada', vista: 'Vista', aprobada: 'Aprobada', rechazada: 'Rechazada', vencida: 'Vencida', convertida: 'Convertida en orden' }
