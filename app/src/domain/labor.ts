import { round } from './money'
import type { Employee, Settings } from './types'

/**
 * Costo laboral por hora PRODUCTIVA = costo mensual × (1 + carga %) ÷ horas productivas del mes.
 * Horas pagadas ≠ horas productivas ≠ horas facturables: aquí se divide entre las productivas configuradas.
 */
export function hourlyLaborCost(e: Pick<Employee, 'monthlyCostCents' | 'loadPct' | 'productiveHoursPerMonth'>, s: Pick<Settings, 'labor'>): number {
  const hours = e.productiveHoursPerMonth ?? s.labor.productiveHoursPerMonth
  if (!(hours > 0)) return 0
  const load = e.loadPct ?? s.labor.loadPct
  return round((e.monthlyCostCents * (1 + load / 100)) / hours)
}
export const laborCostForMinutes = (minutes: number, hourlyCents: number): number => round((minutes / 60) * hourlyCents)
export const minutesBetween = (a: string, b: string): number => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
