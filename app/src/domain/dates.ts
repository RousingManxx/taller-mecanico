import type { ISODate } from './types'

/** Fecha local 'YYYY-MM-DD' en la zona horaria del taller (no la del dispositivo, para que los cortes sean consistentes). */
export function localDate(d: Date, tz = 'America/Mexico_City'): ISODate {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return p // en-CA → YYYY-MM-DD
}
const utc = (s: ISODate) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const iso = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (s: ISODate, n: number): ISODate => { const d = utc(s); d.setUTCDate(d.getUTCDate() + n); return iso(d) }
export const diffDays = (a: ISODate, b: ISODate): number => Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000)
export function addMonths(s: ISODate, n: number): ISODate {
  const d = utc(s), day = d.getUTCDate()
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return iso(d)
}
export const startOfMonth = (s: ISODate): ISODate => s.slice(0, 8) + '01'
export const endOfMonth = (s: ISODate): ISODate => iso(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)))
/** Lunes como inicio de semana. */
export function startOfWeek(s: ISODate): ISODate { const wd = (utc(s).getUTCDay() + 6) % 7; return addDays(s, -wd) }
export const startOfQuarter = (s: ISODate): ISODate => { const m = +s.slice(5, 7); const q = Math.floor((m - 1) / 3) * 3 + 1; return `${s.slice(0, 4)}-${String(q).padStart(2, '0')}-01` }
export const startOfYear = (s: ISODate): ISODate => s.slice(0, 4) + '-01-01'

export type Period = 'hoy' | 'semana' | 'mes' | 'mes_anterior' | 'trimestre' | 'anio' | 'custom'
export interface Range { from: ISODate; to: ISODate }
export const PERIOD_LABEL: Record<Period, string> = { hoy: 'Hoy', semana: 'Semana', mes: 'Mes', mes_anterior: 'Mes anterior', trimestre: 'Trimestre', anio: 'Año', custom: 'Personalizado' }

export function periodRange(p: Period, today: ISODate, custom?: Range): Range {
  switch (p) {
    case 'hoy': return { from: today, to: today }
    case 'semana': return { from: startOfWeek(today), to: today }
    case 'mes': return { from: startOfMonth(today), to: today }
    case 'mes_anterior': { const f = startOfMonth(addMonths(today, -1)); return { from: f, to: endOfMonth(f) } }
    case 'trimestre': return { from: startOfQuarter(today), to: today }
    case 'anio': return { from: startOfYear(today), to: today }
    case 'custom': return custom ?? { from: today, to: today }
  }
}

/** Periodo equivalente anterior: mismos días transcurridos del periodo previo (mes vs. mismos días del mes pasado). */
export function previousRange(p: Period, r: Range): Range {
  const len = diffDays(r.from, r.to) + 1
  switch (p) {
    case 'mes': case 'mes_anterior': {
      const f = startOfMonth(addMonths(r.from, -1))
      return { from: f, to: p === 'mes_anterior' ? endOfMonth(f) : minDate(addDays(f, len - 1), endOfMonth(f)) }
    }
    case 'trimestre': { const f = startOfQuarter(addMonths(r.from, -3)); return { from: f, to: addDays(f, len - 1) } }
    case 'anio': { const f = `${+r.from.slice(0, 4) - 1}-01-01`; return { from: f, to: addDays(f, len - 1) } }
    default: return { from: addDays(r.from, -len), to: addDays(r.from, -1) }
  }
}
const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b)
export const inRange = (d: ISODate, r: Range): boolean => d >= r.from && d <= r.to

export type Bucket = 'dia' | 'semana' | 'mes'
export function bucketFor(r: Range): Bucket { const n = diffDays(r.from, r.to) + 1; return n <= 35 ? 'dia' : n <= 120 ? 'semana' : 'mes' }
export function bucketKey(d: ISODate, b: Bucket): ISODate { return b === 'dia' ? d : b === 'semana' ? startOfWeek(d) : startOfMonth(d) }
export function bucketKeys(r: Range, b: Bucket): ISODate[] {
  const out: ISODate[] = []
  let k = bucketKey(r.from, b)
  while (k <= r.to) { out.push(k); k = b === 'dia' ? addDays(k, 1) : b === 'semana' ? addDays(k, 7) : addMonths(k, 1) }
  return out
}
