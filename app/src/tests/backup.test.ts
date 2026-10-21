import { describe, expect, it } from 'vitest'
import { exportCsvs, reportToCsv, toCsv, cell } from '../domain/csv'
import { REPORTS, type ReportData } from '../domain/reports'
import { createBackup, parseBackup, restoreAsNewOrganization, restoreBackup } from '../services/backup'
import { dropOrgDb, registry } from '../db/db'
import { createCounterSale } from '../services/sales'
import { saveCustomer } from '../services/customers'
import { saveUser, login } from '../services/auth'
import { basics, stockFiltros, withCash, world } from './helpers'

async function snapshot(ctx: Awaited<ReturnType<typeof world>>['ctx']): Promise<ReportData> {
  const d = ctx.db
  const [sales, ledger, expenses, receipts, balances, movements, orders, customers, vehicles, employees, suppliers, services, products, settings] = await Promise.all([d.sales.toArray(), d.ledger.toArray(), d.expenses.toArray(), d.receipts.toArray(), d.balances.toArray(), d.movements.toArray(), d.workOrders.toArray(), d.customers.toArray(), d.vehicles.toArray(), d.employees.toArray(), d.suppliers.toArray(), d.services.toArray(), d.products.toArray(), d.settings.get('main')])
  return { sales, ledger, expenses, receipts, balances, movements, orders, customers, vehicles, employees, suppliers, services, products, settings: settings! }
}

describe('Respaldo y restauración', () => {
  it('restaura (reemplazar) tras perder datos y rechaza copias ajenas o dañadas', async () => {
    const { ctx } = await world({ name: 'Taller A' })
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    const sale = await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 2 }], payments: [{ methodId: 'efectivo', amountCents: 10000 }] })
    const file = await createBackup(ctx)
    expect(file.format).toBe('torque-backup'); expect(file.tables.sales).toHaveLength(1)
    const text = JSON.stringify(file)
    const rep = parseBackup(text, ctx.orgId)
    expect(rep.ok).toBe(true); expect(rep.counts.sales).toBe(1)

    // otro taller no puede importar esta copia
    const other = await world({ name: 'Taller B' })
    const bad = parseBackup(text, other.ctx.orgId)
    expect(bad.ok).toBe(false); expect(bad.errors[0]).toMatch(/otro taller/)
    expect(parseBackup('{no es json', ctx.orgId).errors[0]).toMatch(/JSON/)
    expect(parseBackup(JSON.stringify({ format: 'otra-cosa' }), ctx.orgId).ok).toBe(false)
    expect(parseBackup(JSON.stringify({ ...file, schemaVersion: 99 }), ctx.orgId).errors[0]).toMatch(/más nueva/)
    // referencias rotas
    const broken = JSON.parse(text); broken.tables.sales[0].customerId = 'inexistente'
    expect(parseBackup(JSON.stringify(broken), ctx.orgId).errors.join()).toMatch(/inexistente/)
    // id duplicado
    const dup = JSON.parse(text); dup.tables.customers.push({ ...dup.tables.customers[0] })
    expect(parseBackup(JSON.stringify(dup), ctx.orgId).errors.join()).toMatch(/duplicado/)

    // combinar: no duplica nada
    const m = await restoreBackup(ctx, rep.data!, 'combinar')
    expect(m.added).toBe(0); expect(m.skipped).toBeGreaterThan(0)
    expect(await ctx.db.sales.count()).toBe(1)

    // reemplazar tras borrar: todo regresa, incluidos los movimientos y folios
    await ctx.db.sales.clear(); await ctx.db.customers.clear(); await ctx.db.balances.clear()
    await restoreBackup(ctx, rep.data!, 'reemplazar')
    expect(await ctx.db.sales.count()).toBe(1)
    expect((await ctx.db.sales.get(sale.id))!.folio).toBe(sale.folio)
    expect((await ctx.db.balances.toArray())[0].qty).toBe(8)
    expect((await ctx.db.settings.get('main'))!.counters.venta).toBe(2)
  })
  it('un usuario sin permiso no puede exportar ni restaurar', async () => {
    const { ctx, clk } = await world()
    const uid = await saveUser(ctx, { name: 'Rita', role: 'recepcion', pin: '4321' })
    const rec = await login(ctx.orgId, uid, '4321', () => clk.t)
    await expect(createBackup(rec)).rejects.toThrow(/No tienes permiso/)
    const file = await createBackup(ctx)
    await expect(restoreBackup(rec, file, 'combinar')).rejects.toThrow(/No tienes permiso/)
  })
})

describe('Cambio de dispositivo', () => {
  it('restaura una copia como taller nuevo conservando usuarios y PIN', async () => {
    const { ctx, clk } = await world({ name: 'Taller Origen' })
    const b = await basics(ctx); await stockFiltros(ctx, b)
    const text = JSON.stringify(await createBackup(ctx))
    await expect(restoreAsNewOrganization(text)).rejects.toThrow(/ya existe/)
    await dropOrgDb(ctx.orgId); await registry.orgs.delete(ctx.orgId) // «dispositivo nuevo»
    const r = await restoreAsNewOrganization(text)
    expect(r.orgId).toBe(ctx.orgId)
    const again = await login(r.orgId, ctx.user.id, '1234', () => clk.t)
    expect(await again.db.receipts.count()).toBe(1)
    expect((await again.db.balances.toArray())[0].qty).toBe(10)
    await expect(restoreAsNewOrganization('{}')).rejects.toThrow()
  })
})

describe('Exportación CSV', () => {
  it('protege contra inyección de fórmulas y respeta permisos de costos y salarios', async () => {
    expect(cell('=1+1', ',')).toBe("'=1+1"); expect(cell('+cmd', ',')).toBe("'+cmd"); expect(cell('a,b', ',')).toBe('"a,b"'); expect(cell(5, ',')).toBe('5')
    expect(toCsv(['a'], [['x']]).startsWith('﻿')).toBe(true)
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b)
    await saveCustomer(ctx, { name: '=HYPERLINK("http://malo")' })
    await createCounterSale(ctx, { lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }] })
    const d = await snapshot(ctx)
    const full = exportCsvs(d, { costs: true, salaries: true })
    const lim = exportCsvs(d, { costs: false, salaries: false })
    expect(full['ventas.csv']).toMatch(/costo_directo_mxn/); expect(lim['ventas.csv']).not.toMatch(/costo/)
    expect(full['empleados.csv']).toMatch(/costo_laboral/); expect(lim['empleados.csv']).not.toMatch(/costo_laboral|1600000|16000\.00/)
    expect(full['movimientos_inventario.csv']).toBeTruthy(); expect(lim['movimientos_inventario.csv']).toBeUndefined()
    expect(full['clientes.csv']).toMatch(/'=HYPERLINK/)
  })
  it('cada reporte exporta con periodo, filtros, definición y fuente', async () => {
    const { ctx } = await world()
    const b = await basics(ctx); await stockFiltros(ctx, b); await withCash(ctx)
    await createCounterSale(ctx, { customerId: b.customer.id, lines: [{ kind: 'producto', productId: b.filtro.id, qty: 1 }], payments: [{ methodId: 'efectivo', amountCents: 5000 }] })
    const d = await snapshot(ctx)
    const r = REPORTS.find((x) => x.id === 'rent_refaccion')!.run(d, { from: '2026-03-01', to: '2026-03-31' }, '2026-03-31T00:00:00Z')
    const csv = reportToCsv(r)
    expect(csv).toMatch(/Periodo,2026-03-01 a 2026-03-31/); expect(csv).toMatch(/Definición/); expect(csv).toMatch(/Fuente/); expect(csv).toMatch(/Filtro de aceite/)
    expect(csv).toMatch(/200\.00/) // dinero en pesos con dos decimales
  })
})
