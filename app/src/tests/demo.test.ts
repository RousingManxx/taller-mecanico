import { describe, expect, it } from 'vitest'
import { createDemoOrganization } from '../db/demo'
import { openOrgDb, registry } from '../db/db'
import { deleteDemoOrganizations } from '../services/auth'
import { cashFlow, incomeStatement, receivables, saleBalance, payables, inventoryValue } from '../domain/finance'
import { REPORTS, type ReportData } from '../domain/reports'
import { periodRange } from '../domain/dates'
import { world } from './helpers'
import { saveCustomer } from '../services/customers'

describe('Taller de demostración', () => {
  it('se genera con los mismos servicios, es consistente y no toca datos reales', async () => {
    const real = await world({ name: 'Taller Real' })
    await saveCustomer(real.ctx, { name: 'Cliente Real' })
    const ctx = await createDemoOrganization(30)
    const rec = await registry.orgs.get(ctx.orgId)
    expect(rec?.demo).toBe(true)
    const db = ctx.db
    expect(await db.workOrders.count()).toBeGreaterThan(20)
    expect(await db.sales.count()).toBeGreaterThan(20)
    // El taller real no se mezcló
    expect(await real.ctx.db.customers.count()).toBe(1)

    const [sales, ledger, expenses, receipts, balances, movements, orders, customers, vehicles, employees, suppliers, services, products, settings] = await Promise.all([
      db.sales.toArray(), db.ledger.toArray(), db.expenses.toArray(), db.receipts.toArray(), db.balances.toArray(), db.movements.toArray(), db.workOrders.toArray(), db.customers.toArray(), db.vehicles.toArray(), db.employees.toArray(), db.suppliers.toArray(), db.services.toArray(), db.products.toArray(), db.settings.get('main'),
    ])
    const data: ReportData = { sales, ledger, expenses, receipts, balances, movements, orders, customers, vehicles, employees, suppliers, services, products, settings: settings! }
    const today = new Date().toISOString().slice(0, 10)
    const r = periodRange('anio', today)
    // Invariantes de integridad
    const st = incomeStatement(sales, expenses, settings!.expenseCategories, r)
    expect(st.netSalesCents).toBeGreaterThan(0)
    expect(st.cogs.totalCents).toBeGreaterThan(0)
    // Valor de inventario = suma de movimientos (conservación)
    const byProduct = new Map<string, number>()
    for (const m of movements) byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.totalCostCents)
    expect(inventoryValue(balances)).toBe([...byProduct.values()].reduce((a, b) => a + b, 0))
    for (const b of balances) { expect(b.qty).toBeGreaterThanOrEqual(0); expect(b.valueCents).toBeGreaterThanOrEqual(0) }
    // Ninguna venta pagada de más
    for (const s of sales) expect(saleBalance(s, ledger)).toBeGreaterThanOrEqual(0)
    // Caja: cada sesión cerrada cuadra con sus movimientos
    for (const sess of await db.cashSessions.toArray()) {
      if (sess.status !== 'cerrada') continue
      const mv = ledger.filter((l) => l.sessionId === sess.id && l.account === 'caja')
      const exp = sess.openingCents + mv.reduce((a, l) => a + (l.direction === 'in' ? l.amountCents : -l.amountCents), 0)
      expect(sess.expectedCents).toBe(exp)
    }
    expect(cashFlow(ledger, r).inCents).toBeGreaterThan(0)
    expect(receivables(sales, ledger, today).length + payables(receipts, expenses, ledger, () => '', today).length).toBeGreaterThan(0)
    // Los 24 reportes corren sin error y devuelven estructura válida
    expect(REPORTS.length).toBe(24)
    for (const def of REPORTS) {
      const res = def.run(data, r, new Date().toISOString())
      expect(res.columns.length).toBeGreaterThan(0)
      for (const row of res.rows) expect(row.length).toBe(res.columns.length)
      expect(res.definition.length).toBeGreaterThan(10)
    }
    // Reiniciar la demostración solo borra talleres demo
    expect(await deleteDemoOrganizations()).toBe(1)
    expect(await registry.orgs.get(ctx.orgId)).toBeUndefined()
    expect(await registry.orgs.get(real.ctx.orgId)).toBeTruthy()
    expect(await openOrgDb(real.ctx.orgId).customers.count()).toBe(1)
  }, 180000)
})

describe('La demostración no depende del día ni de la hora', () => {
  it('se genera sin errores cualquier día de la semana, de madrugada y de tarde (UTC)', async () => {
    const { vi } = await import('vitest')
    for (const iso of ['2026-10-19T01:40:00Z', '2026-10-20T01:40:00Z', '2026-10-21T14:00:00Z', '2026-10-22T23:50:00Z', '2026-10-23T03:00:00Z', '2026-10-24T18:00:00Z', '2026-10-25T10:00:00Z']) {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso))
      try {
        const ctx = await createDemoOrganization(14)
        expect(await ctx.db.workOrders.count(), iso).toBeGreaterThan(3)
      } finally { vi.useRealTimers() }
    }
    await deleteDemoOrganizations()
  }, 240000)
})
