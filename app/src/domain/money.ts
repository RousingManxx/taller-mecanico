// Estrategia: todos los importes se guardan como centavos enteros. Los costos unitarios promediados pueden ser
// decimales, pero solo se redondean (half-up, simétrico) al calcular importes; los importes ya redondeados se suman
// como enteros, así no se acumulan errores de redondeo.
export const round = (n: number): number => Math.sign(n) * Math.round(Math.abs(n) + 1e-9)
export const round3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000

export const pesosToCents = (p: number): number => round(p * 100)
export const centsToPesos = (c: number): number => c / 100

const fmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
export const formatMXN = (cents: number): string => fmt.format(cents / 100)

const numFmt = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 })
export const formatNum = (n: number): string => numFmt.format(n)
export const formatPct = (n: number | null): string => (n === null ? 'n/c' : numFmt.format(n) + ' %')
export const formatQty = (n: number): string => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(n)

/** Parsea entradas del usuario: acepta "1,250.50", "1250,5" y "$180". Devuelve NaN si no es válido. */
export function parseNum(s: string): number {
  let t = s.replace(/[$\s%]/g, '')
  if (!t) return NaN
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else if (t.includes(',')) t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.')
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN
}

export const sum = <T,>(a: readonly T[], f: (x: T) => number): number => a.reduce((s, x) => s + f(x), 0)
