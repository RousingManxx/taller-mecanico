import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { localDate } from '../domain/dates'
import { can, type Permission } from '../domain/permissions'
import type { ReportData } from '../domain/reports'
import type {
  Appointment, CashSession, Customer, Employee, InventoryBalance, Product, PriceProposal, PurchaseOrder, Quotation, RecurringExpense, ServiceDef, Settings, Supplier, SupplierProduct, Vehicle, Warehouse, WorkOrder,
} from '../domain/types'
import { redactEmployee } from '../services/people'
import type { Ctx } from '../services/core'
import { defaultSettings } from '../db/defaults'

export interface Data extends ReportData {
  ready: boolean
  quotations: Quotation[]; purchaseOrders: PurchaseOrder[]; cashSessions: CashSession[]; recurring: RecurringExpense[]; appointments: Appointment[]
  priceProposals: PriceProposal[]; warehouses: Warehouse[]; supplierProducts: SupplierProduct[]
  custMap: Map<string, Customer>; vehMap: Map<string, Vehicle>; prodMap: Map<string, Product>; svcMap: Map<string, ServiceDef>; empMap: Map<string, Employee>; supMap: Map<string, Supplier>; orderMap: Map<string, WorkOrder>
  /** Existencias y valor por producto, sumando almacenes. */
  stock: Map<string, { qty: number; valueCents: number }>
  today: string; settings: Settings
  /** Permisos del usuario actual (la verificación real está en la capa de servicios). */
  can: (p: Permission) => boolean
}

const E: never[] = []
export function useData(ctx: Ctx): Data {
  const db = ctx.db
  const settings = useLiveQuery(() => db.settings.get('main'), [db])
  const customers = useLiveQuery(() => db.customers.toArray(), [db])
  const vehicles = useLiveQuery(() => db.vehicles.toArray(), [db])
  const services = useLiveQuery(() => db.services.toArray(), [db])
  const products = useLiveQuery(() => db.products.toArray(), [db])
  const balances = useLiveQuery(() => db.balances.toArray(), [db])
  const movements = useLiveQuery(() => db.movements.toArray(), [db])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [db])
  const supplierProducts = useLiveQuery(() => db.supplierProducts.toArray(), [db])
  const purchaseOrders = useLiveQuery(() => db.purchaseOrders.toArray(), [db])
  const receipts = useLiveQuery(() => db.receipts.toArray(), [db])
  const orders = useLiveQuery(() => db.workOrders.toArray(), [db])
  const quotations = useLiveQuery(() => db.quotations.toArray(), [db])
  const sales = useLiveQuery(() => db.sales.toArray(), [db])
  const ledger = useLiveQuery(() => db.ledger.toArray(), [db])
  const cashSessions = useLiveQuery(() => db.cashSessions.toArray(), [db])
  const expenses = useLiveQuery(() => db.expenses.toArray(), [db])
  const recurring = useLiveQuery(() => db.recurring.toArray(), [db])
  const employees = useLiveQuery(() => db.employees.toArray(), [db])
  const appointments = useLiveQuery(() => db.appointments.toArray(), [db])
  const priceProposals = useLiveQuery(() => db.priceProposals.toArray(), [db])
  const warehouses = useLiveQuery(() => db.warehouses.toArray(), [db])
  const all = [settings, customers, vehicles, services, products, balances, movements, suppliers, supplierProducts, purchaseOrders, receipts, orders, quotations, sales, ledger, cashSessions, expenses, recurring, employees, appointments, priceProposals, warehouses]
  const ready = all.every((x) => x !== undefined)
  const user = ctx.user
  return useMemo(() => {
    const s = settings ?? defaultSettings(ctx.orgId, '', '')
    const canSalary = can(user, 'personal.salarios')
    const emps = (employees ?? E).map((e) => redactEmployee(e, canSalary))
    // Un mecánico solo ve sus órdenes asignadas.
    const allOrders = orders ?? E
    const ord = can(user, 'ordenes.ver_todas') ? allOrders : allOrders.filter((o) => !!user.employeeId && o.mechanicId === user.employeeId)
    const stock = new Map<string, { qty: number; valueCents: number }>()
    for (const b of (balances ?? E) as InventoryBalance[]) { const c = stock.get(b.productId) ?? { qty: 0, valueCents: 0 }; stock.set(b.productId, { qty: c.qty + b.qty, valueCents: c.valueCents + b.valueCents }) }
    const m = <T extends { id: string }>(a: readonly T[]) => new Map(a.map((x) => [x.id, x]))
    return {
      ready, settings: s, customers: customers ?? E, vehicles: vehicles ?? E, services: services ?? E, products: products ?? E, balances: balances ?? E, movements: movements ?? E,
      suppliers: suppliers ?? E, supplierProducts: supplierProducts ?? E, purchaseOrders: purchaseOrders ?? E, receipts: receipts ?? E, orders: ord, quotations: quotations ?? E,
      sales: sales ?? E, ledger: ledger ?? E, cashSessions: cashSessions ?? E, expenses: expenses ?? E, recurring: recurring ?? E, employees: emps, appointments: appointments ?? E,
      priceProposals: priceProposals ?? E, warehouses: warehouses ?? E,
      custMap: m(customers ?? E), vehMap: m(vehicles ?? E), prodMap: m(products ?? E), svcMap: m(services ?? E), empMap: m(emps), supMap: m(suppliers ?? E), orderMap: m(ord), stock,
      today: localDate(new Date(), s.timezone), can: (p: Permission) => can(user, p),
    } satisfies Data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ...all, user])
}

export function download(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const todayISO = (tz = 'America/Mexico_City') => localDate(new Date(), tz)
export const fmtDate = (iso?: string) => iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00:00' : iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
export const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
export const fmtHours = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${m} min` : `${m} min` }
/** Valor para <input type="datetime-local"> en hora local del dispositivo. */
export const toLocalInput = (iso?: string) => { const d = iso ? new Date(iso) : new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
export const plateOf = (v?: Vehicle) => (v ? `${v.make} ${v.model}${v.year ? ' ' + v.year : ''} · ${v.plate || v.vin}` : '—')
