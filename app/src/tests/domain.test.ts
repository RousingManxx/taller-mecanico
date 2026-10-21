import { describe, expect, it } from 'vitest'
import { addMonths, bucketKeys, diffDays, localDate, periodRange, previousRange, startOfWeek } from '../domain/dates'
import { agingBucket, allocateOverhead, cashFlow, delta, incomeStatement, payStatus, saleBalance, breakEvenFromStatement } from '../domain/finance'
import { InsufficientStock, avgCost, issue, receive } from '../domain/inventory'
import { hourlyLaborCost, laborCostForMinutes } from '../domain/labor'
import { lineAmounts, sumLines } from '../domain/lines'
import { formatMXN, parseNum, round } from '../domain/money'
import { breakEven, markupPct, marginPct, priceCalculator, targetPriceCents } from '../domain/pricing'
import { can, ROLE_PERMISSIONS } from '../domain/permissions'
import type { ExpenseCategory, Expense, LedgerEntry, Sale, SaleItem } from '../domain/types'

const cats: ExpenseCategory[] = [
  { id: 'renta', name: 'Renta', kind: 'operativo', allocate: true },
  { id: 'nomina', name: 'Nómina mecánicos', kind: 'mano_obra_directa', allocate: false },
]
const item = (o: Partial<SaleItem>): SaleItem => ({ id: 'i' + Math.random(), type: 'refaccion', description: 'x', qty: 1, unit: 'pza', unitPriceCents: 0, discountCents: 0, taxRate: 16, netCents: 0, taxCents: 0, totalCents: 0, costCents: 0, costEstimated: false, movementIds: [], stdHours: 0, hours: 0, ...o })
const sale = (o: Partial<Sale> & { items: SaleItem[] }): Sale => {
  const net = o.items.reduce((a, i) => a + i.netCents, 0), cost = o.items.reduce((a, i) => a + i.costCents, 0)
  return { id: 's' + Math.random(), orgId: 'o', createdAt: '', updatedAt: '', folio: 'V-1', kind: 'mostrador', status: 'emitida', customerName: 'c', date: '2026-03-10', dueDate: '2026-03-10', netCents: net, taxCents: Math.round(net * 0.16), totalCents: Math.round(net * 1.16), costCents: cost, otherCostCents: 0, laborHours: 0, returns: [], notes: '', userId: 'u', ...o }
}
const led = (o: Partial<LedgerEntry>): LedgerEntry => ({ id: 'l' + Math.random(), orgId: 'o', kind: 'cobro_cliente', direction: 'in', amountCents: 0, date: '2026-03-10', at: '', methodId: 'efectivo', account: 'caja', reference: '', note: '', userId: 'u', ...o })

describe('margen, markup y precio objetivo', () => {
  it('venta rentable: margen ≠ markup', () => {
    // costo 600, venta 1000 → utilidad 400: margen 40 %, markup 66.67 %
    expect(marginPct(100000, 60000)).toBeCloseTo(40, 6)
    expect(markupPct(100000, 60000)).toBeCloseTo(66.6667, 3)
  })
  it('venta sin utilidad y con pérdida', () => {
    expect(marginPct(50000, 50000)).toBe(0)
    expect(marginPct(40000, 50000)).toBeCloseTo(-25, 6)
    expect(markupPct(40000, 50000)).toBeCloseTo(-20, 6)
  })
  it('margen no calculable cuando la base es cero (sin porcentajes engañosos)', () => {
    expect(marginPct(0, 5000)).toBeNull()
    expect(marginPct(-100, 0)).toBeNull()
    expect(markupPct(5000, 0)).toBeNull()
    expect(targetPriceCents(0, 30)).toBeNull()
    expect(targetPriceCents(1000, 100)).toBeNull()
    expect(targetPriceCents(1000, 120)).toBeNull()
  })
  it('precio objetivo = costo / (1 - margen)', () => {
    expect(targetPriceCents(60000, 40)).toBe(100000)
    expect(targetPriceCents(10000, 25)).toBe(13333)
  })
  it('calculadora: el descuento previsto no destruye el margen', () => {
    const r = priceCalculator({ purchaseCostCents: 50000, extraCostCents: 10000, targetMarginPct: 40, taxRate: 16, discountPct: 10 })
    expect(r.totalCostCents).toBe(60000)
    expect(r.netAfterDiscountCents).toBe(100000)
    expect(r.suggestedNetCents).toBe(111111)
    expect(r.marginPct).toBeCloseTo(40, 6)
    expect(r.finalPriceWithTaxCents).toBe(116000)
    expect(priceCalculator({ purchaseCostCents: 0, targetMarginPct: 40, taxRate: 16 }).suggestedNetCents).toBeNull()
  })
})

describe('impuestos y descuentos en partidas', () => {
  it('precio sin IVA incluido', () => {
    const a = lineAmounts({ qty: 2, unitPriceCents: 50000, discountCents: 10000, taxRate: 16 }, false)
    expect(a).toEqual({ netCents: 90000, taxCents: 14400, totalCents: 104400 })
  })
  it('precio con IVA incluido', () => {
    const a = lineAmounts({ qty: 1, unitPriceCents: 116000, discountCents: 0, taxRate: 16 }, true)
    expect(a).toEqual({ netCents: 100000, taxCents: 16000, totalCents: 116000 })
  })
  it('tasa 0 / exento', () => {
    expect(lineAmounts({ qty: 3, unitPriceCents: 1000, discountCents: 0, taxRate: 0 }, false)).toEqual({ netCents: 3000, taxCents: 0, totalCents: 3000 })
  })
  it('redondeo monetario sin deriva al sumar', () => {
    // 3 líneas de 3.33 con IVA 16 %: se redondea por línea y se suman enteros
    const l = lineAmounts({ qty: 1, unitPriceCents: 333, discountCents: 0, taxRate: 16 }, false)
    expect(l.taxCents).toBe(53)
    const t = sumLines([l, l, l])
    expect(t.totalCents).toBe(l.totalCents * 3)
    expect(round(0.5)).toBe(1); expect(round(-0.5)).toBe(-1); expect(round(1.005 * 100)).toBe(101)
  })
  it('parseNum y formato MXN', () => {
    expect(parseNum('1,250.50')).toBe(1250.5); expect(parseNum('$180')).toBe(180); expect(parseNum('1250,5')).toBe(1250.5); expect(parseNum('abc')).toBeNaN()
    expect(formatMXN(123456)).toMatch(/1,234\.56/)
  })
})

describe('inventario: costo promedio ponderado móvil', () => {
  it('promedia compras y valora salidas con el promedio vigente', () => {
    let b = { qty: 0, valueCents: 0 }
    b = receive(b, 10, 100000) // 10 × $100
    b = receive(b, 10, 140000) // 10 × $140 → promedio $120
    expect(avgCost(b)).toBe(12000)
    const out = issue(b, 5)
    expect(out.costCents).toBe(60000)
    expect(out.balance).toEqual({ qty: 15, valueCents: 180000 })
    expect(avgCost(out.balance)).toBe(12000)
  })
  it('la salida total vacía el valor sin residuos de redondeo', () => {
    let b = receive({ qty: 0, valueCents: 0 }, 3, 1000) // 333.33 por pieza
    const a = issue(b, 1); b = a.balance
    const c = issue(b, 1); b = c.balance
    const d = issue(b, 1)
    expect(a.costCents + c.costCents + d.costCents).toBe(1000)
    expect(d.balance).toEqual({ qty: 0, valueCents: 0 })
  })
  it('inventario insuficiente', () => {
    expect(() => issue({ qty: 2, valueCents: 2000 }, 3)).toThrow(InsufficientStock)
  })
  it('un cambio de costo posterior no altera costos ya aplicados (salida congelada)', () => {
    let b = receive({ qty: 0, valueCents: 0 }, 10, 500000) // $500 c/u
    const first = issue(b, 1); b = first.balance
    b = receive(b, 10, 1000000) // sube a $1000 c/u
    expect(first.costCents).toBe(50000) // lo ya vendido conserva su costo
    expect(avgCost(b)).toBeGreaterThan(50000)
  })
})

describe('mano de obra', () => {
  it('costo laboral por hora productiva', () => {
    // $16,000 al mes con 30 % de cargas ÷ 160 h productivas = $130/h
    expect(hourlyLaborCost({ monthlyCostCents: 1600000 }, { labor: { productiveHoursPerMonth: 160, loadPct: 30, defaultRateCents: 0 } })).toBe(13000)
    expect(hourlyLaborCost({ monthlyCostCents: 1600000, loadPct: 0, productiveHoursPerMonth: 100 }, { labor: { productiveHoursPerMonth: 160, loadPct: 30, defaultRateCents: 0 } })).toBe(16000)
    expect(hourlyLaborCost({ monthlyCostCents: 1600000 }, { labor: { productiveHoursPerMonth: 0, loadPct: 30, defaultRateCents: 0 } })).toBe(0)
  })
  it('costo de un tramo de minutos', () => expect(laborCostForMinutes(90, 13000)).toBe(19500))
})

describe('fechas y periodos', () => {
  it('fecha local en la zona del taller', () => {
    expect(localDate(new Date('2026-03-10T03:30:00Z'), 'America/Mexico_City')).toBe('2026-03-09')
    expect(localDate(new Date('2026-03-10T15:30:00Z'), 'America/Mexico_City')).toBe('2026-03-10')
  })
  it('aritmética de meses con fin de mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'); expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(diffDays('2026-03-01', '2026-03-31')).toBe(30)
    expect(startOfWeek('2026-03-12')).toBe('2026-03-09')
  })
  it('mes actual vs mismos días del mes anterior', () => {
    const r = periodRange('mes', '2026-03-10')
    expect(r).toEqual({ from: '2026-03-01', to: '2026-03-10' })
    expect(previousRange('mes', r)).toEqual({ from: '2026-02-01', to: '2026-02-10' })
    expect(previousRange('mes_anterior', periodRange('mes_anterior', '2026-03-10'))).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(bucketKeys({ from: '2026-03-01', to: '2026-03-03' }, 'dia')).toHaveLength(3)
  })
  it('variación sin base de comparación no inventa porcentajes', () => {
    expect(delta(100, 0).pct).toBeNull(); expect(delta(150, 100).pct).toBe(50)
  })
})

describe('cuentas por cobrar y antigüedad', () => {
  it('pago parcial, saldo y estado', () => {
    const s = sale({ id: 'S1', items: [item({ netCents: 100000, costCents: 40000 })], totalCents: 116000 })
    expect(saleBalance(s, [])).toBe(116000); expect(payStatus(s, [])).toBe('pendiente')
    const l = [led({ saleId: 'S1', amountCents: 50000 })]
    expect(saleBalance(s, l)).toBe(66000); expect(payStatus(s, l)).toBe('parcial')
    l.push(led({ saleId: 'S1', amountCents: 66000 }))
    expect(saleBalance(s, l)).toBe(0); expect(payStatus(s, l)).toBe('pagada')
    l.push(led({ saleId: 'S1', kind: 'reembolso_cliente', direction: 'out', amountCents: 10000 }))
    expect(saleBalance(s, l)).toBe(10000)
  })
  it('los anticipos de la orden se aplican a su venta', () => {
    const s = sale({ id: 'S2', workOrderId: 'W1', items: [item({ netCents: 10000 })], totalCents: 11600 })
    expect(saleBalance(s, [led({ workOrderId: 'W1', amountCents: 5000 })])).toBe(6600)
  })
  it('una devolución reduce el saldo; una venta cancelada no genera saldo', () => {
    const s = sale({ id: 'S3', items: [item({ id: 'a', netCents: 10000 })], totalCents: 11600, returns: [{ id: 'r', at: '', date: '2026-03-11', itemId: 'a', qty: 1, netCents: 10000, taxCents: 1600, costRecoveredCents: 0, reason: '', userId: '' }] })
    expect(saleBalance(s, [])).toBe(0)
    expect(saleBalance({ ...s, status: 'cancelada', returns: [] }, [])).toBe(0)
  })
  it('antigüedad de saldos', () => {
    expect(agingBucket('2026-03-10', '2026-03-10')).toEqual({ bucket: 'no_vencido', daysLate: 0 })
    expect(agingBucket('2026-03-01', '2026-03-10').bucket).toBe('d1_30')
    expect(agingBucket('2026-01-20', '2026-03-10').bucket).toBe('d31_60')
    expect(agingBucket('2025-12-01', '2026-03-10').bucket).toBe('d90_mas')
  })
})

describe('estado de resultados y flujo de efectivo', () => {
  const r = { from: '2026-03-01', to: '2026-03-31' }
  const exp = (o: Partial<Expense>): Expense => ({ id: 'e' + Math.random(), orgId: 'o', createdAt: '', updatedAt: '', concept: 'x', categoryId: 'renta', date: '2026-03-05', amountCents: 0, taxCents: 0, costCenter: '', notes: '', attachmentIds: [], ...o })
  it('ventas, costo, utilidad bruta y operativa; la nómina no se resta dos veces', () => {
    const s1 = sale({ items: [item({ netCents: 100000, costCents: 60000 }), item({ type: 'servicio', netCents: 50000, costCents: 20000 })] })
    const st = incomeStatement([s1], [exp({ amountCents: 30000 }), exp({ categoryId: 'nomina', amountCents: 50000 })], cats, r)
    expect(st.netSalesCents).toBe(150000)
    expect(st.cogs.totalCents).toBe(80000)
    expect(st.grossProfitCents).toBe(70000)
    expect(st.grossMarginPct).toBeCloseTo(46.67, 1)
    // nómina 500 vs mano de obra imputada 200 → 300 de capacidad ociosa (se resta); el resto de la nómina ya está en el costo
    expect(st.idleLaborCents).toBe(30000)
    expect(st.opex.totalCents).toBe(30000 + 30000)
    expect(st.operatingProfitCents).toBe(70000 - 60000)
  })
  it('ventas canceladas y fuera de periodo no cuentan; las devoluciones restan en su fecha', () => {
    const a = sale({ date: '2026-03-10', items: [item({ id: 'x', netCents: 10000, costCents: 6000 })], returns: [{ id: 'r', at: '', date: '2026-03-12', itemId: 'x', qty: 1, netCents: 10000, taxCents: 1600, costRecoveredCents: 6000, reason: '', userId: '' }] })
    const b = sale({ status: 'cancelada', items: [item({ netCents: 999999 })] })
    const c = sale({ date: '2026-02-10', items: [item({ netCents: 777777 })] })
    const st = incomeStatement([a, b, c], [], cats, r)
    expect(st.netSalesCents).toBe(0); expect(st.cogs.totalCents).toBe(0)
  })
  it('costos estimados se señalan como advertencia', () => {
    const st = incomeStatement([sale({ items: [item({ type: 'servicio', netCents: 10000, costCents: 3000, costEstimated: true })] })], [], cats, r)
    expect(st.estimatedCostLines).toBe(1); expect(st.warnings.length).toBeGreaterThan(0)
  })
  it('flujo de efectivo separa cobros de ventas y no mezcla aportaciones con ingresos operativos', () => {
    const f = cashFlow([
      led({ amountCents: 80000 }), led({ kind: 'aportacion_dueno', amountCents: 500000 }),
      led({ kind: 'pago_gasto', direction: 'out', amountCents: 20000 }), led({ kind: 'retiro_dueno', direction: 'out', amountCents: 100000, account: 'banco' }),
      led({ date: '2026-02-01', amountCents: 999 }),
    ], r)
    expect(f.collectedCents).toBe(80000); expect(f.inCents).toBe(580000); expect(f.outCents).toBe(120000)
    expect(f.netCents).toBe(460000); expect(f.nonOperatingNetCents).toBe(400000)
  })
  it('equilibrio: costos fijos ÷ margen de contribución', () => {
    expect(breakEven({ fixedCostsCents: 3000000, variableCostPct: 60 }).breakEvenSalesCents).toBe(7500000)
    const bad = breakEven({ fixedCostsCents: 100, variableCostPct: 100 })
    expect(bad.reachable).toBe(false); expect(bad.breakEvenSalesCents).toBeNull()
    expect(breakEven({ fixedCostsCents: 100, variableCostPct: 120 }).reachable).toBe(false)
    const s1 = sale({ items: [item({ netCents: 100000, costCents: 40000 })] })
    const be = breakEvenFromStatement(incomeStatement([s1], [exp({ amountCents: 30000 })], cats, r))
    expect(be.variableCostPct).toBeCloseTo(40, 6); expect(be.breakEvenSalesCents).toBe(50000)
  })
})

describe('costos indirectos', () => {
  const s = (net: number, hours: number) => sale({ id: 'a' + net, items: [item({ netCents: net })], laborHours: hours })
  it('el reparto nunca supera el fondo (sin doble conteo) y respeta el método', () => {
    const sales = [s(100000, 1), s(300000, 3)]
    const pct = allocateOverhead(40000, 'porcentaje_ventas', sales)
    expect([...pct.values()].reduce((a, b) => a + b, 0)).toBe(40000)
    expect(pct.get('a100000')).toBe(10000)
    const hrs = allocateOverhead(40000, 'hora_productiva', sales)
    expect(hrs.get('a300000')).toBe(30000)
    expect(allocateOverhead(40001, 'por_orden', sales).get('a100000')! + allocateOverhead(40001, 'por_orden', sales).get('a300000')!).toBe(40001)
    expect(allocateOverhead(40000, 'ninguno', sales).size).toBe(0)
    expect(allocateOverhead(40000, 'hora_productiva', [s(100, 0)]).size).toBe(0)
  })
})

describe('permisos por rol', () => {
  it('el mecánico no ve finanzas ni salarios; el propietario sí', () => {
    const mec = { role: 'mecanico' as const }
    expect(can(mec, 'finanzas.ver')).toBe(false); expect(can(mec, 'personal.salarios')).toBe(false); expect(can(mec, 'ordenes.tiempos')).toBe(true)
    expect(can({ role: 'propietario' }, 'personal.salarios')).toBe(true)
    expect(can(null, 'clientes.ver')).toBe(false)
    expect(can({ role: 'recepcion', revoke: ['clientes.editar'] }, 'clientes.editar')).toBe(false)
    expect(can({ role: 'recepcion', grant: ['gastos.ver'] }, 'gastos.ver')).toBe(true)
    expect(ROLE_PERMISSIONS.gerente).not.toContain('usuarios.admin')
  })
})

describe('evolución de saldos', () => {
  it('cuentas por cobrar e inventario a una fecha de corte', async () => {
    const { receivablesAt, inventoryValueAt } = await import('../domain/finance')
    const s = sale({ id: 'A', date: '2026-03-05', items: [item({ netCents: 10000 })], totalCents: 11600 })
    const pay = led({ saleId: 'A', amountCents: 5000, date: '2026-03-08' })
    expect(receivablesAt([s], [pay], '2026-03-04')).toBe(0)
    expect(receivablesAt([s], [pay], '2026-03-06')).toBe(11600)
    expect(receivablesAt([s], [pay], '2026-03-09')).toBe(6600)
    const mv = [{ date: '2026-03-01', totalCostCents: 1000 }, { date: '2026-03-03', totalCostCents: -400 }]
    expect(inventoryValueAt(mv, '2026-03-02')).toBe(1000); expect(inventoryValueAt(mv, '2026-03-05')).toBe(600)
  })
})
