import Dexie, { type Table } from 'dexie'
import type {
  Appointment, Attachment, AuditLog, CashSession, Customer, Employee, Expense, InventoryBalance, InventoryMovement, LedgerEntry, OpRecord,
  PriceHistory, PriceProposal, Product, PurchaseOrder, PurchaseReceipt, Quotation, RecurringExpense, Sale, ServiceDef, Settings, Supplier,
  SupplierProduct, User, Vehicle, Warehouse, WorkOrder,
} from '../domain/types'

export const SCHEMA_VERSION = 1

/**
 * Una base de datos por taller (organización): el aislamiento entre talleres es físico en este dispositivo.
 * Además cada registro lleva su `orgId` y los servicios lo verifican.
 */
export class OrgDB extends Dexie {
  settings!: Table<Settings, string>
  users!: Table<User, string>
  customers!: Table<Customer, string>
  vehicles!: Table<Vehicle, string>
  services!: Table<ServiceDef, string>
  products!: Table<Product, string>
  warehouses!: Table<Warehouse, string>
  balances!: Table<InventoryBalance, string>
  movements!: Table<InventoryMovement, string>
  suppliers!: Table<Supplier, string>
  supplierProducts!: Table<SupplierProduct, string>
  purchaseOrders!: Table<PurchaseOrder, string>
  receipts!: Table<PurchaseReceipt, string>
  workOrders!: Table<WorkOrder, string>
  quotations!: Table<Quotation, string>
  sales!: Table<Sale, string>
  ledger!: Table<LedgerEntry, string>
  cashSessions!: Table<CashSession, string>
  expenses!: Table<Expense, string>
  recurring!: Table<RecurringExpense, string>
  employees!: Table<Employee, string>
  appointments!: Table<Appointment, string>
  priceHistory!: Table<PriceHistory, string>
  priceProposals!: Table<PriceProposal, string>
  audit!: Table<AuditLog, string>
  attachments!: Table<Attachment, string>
  ops!: Table<OpRecord, string>

  orgId: string
  /** Solo la restauración de una copia completa puede reescribir tablas históricas (dentro de una transacción atómica). */
  restoring = false
  constructor(orgId: string) {
    super(`torque-${orgId}`)
    this.orgId = orgId
    this.version(1).stores({
      settings: 'id',
      users: 'id, name, role',
      customers: 'id, name, phone, active',
      vehicles: 'id, customerId, plate, vin',
      services: 'id, name, category',
      products: 'id, sku, barcode, name, category, supplierId',
      warehouses: 'id',
      balances: 'id, productId, warehouseId',
      movements: 'id, productId, date, type, refId',
      suppliers: 'id, name',
      supplierProducts: 'id, supplierId, productId',
      purchaseOrders: 'id, folio, supplierId, status, date',
      receipts: 'id, folio, supplierId, purchaseOrderId, date, dueDate',
      workOrders: 'id, folio, status, customerId, vehicleId, mechanicId, receivedAt',
      quotations: 'id, folio, customerId, status, issueDate',
      sales: 'id, folio, customerId, date, status, workOrderId',
      ledger: 'id, date, kind, saleId, workOrderId, expenseId, sessionId',
      cashSessions: 'id, status, openedAt',
      expenses: 'id, date, categoryId, supplierId, recurringKey',
      recurring: 'id',
      employees: 'id, name',
      appointments: 'id, start, status, mechanicId',
      priceHistory: 'id, refId, at',
      priceProposals: 'id, status',
      audit: 'id, at, entity, entityId, userId',
      attachments: 'id, ownerId',
      ops: 'key',
    })
    // Tablas de solo anexar: el historial no se edita ni se borra; los errores se corrigen con movimientos compensatorios.
    for (const t of [this.movements, this.ledger, this.audit, this.priceHistory] as Table[]) {
      t.hook('updating', () => { if (!this.restoring) throw new Error('Los registros históricos no se pueden modificar: registra un movimiento compensatorio.') })
      t.hook('deleting', () => { if (!this.restoring) throw new Error('Los registros históricos no se pueden eliminar.') })
    }
  }
}

/* ───────── Registro de talleres (organizaciones) en este dispositivo ───────── */
export interface OrgRecord { id: string; name: string; demo: boolean; createdAt: string }
export class RegistryDB extends Dexie {
  orgs!: Table<OrgRecord, string>
  constructor() {
    super('torque-registry')
    this.version(1).stores({ orgs: 'id, demo' })
  }
}
export const registry = new RegistryDB()

const open = new Map<string, OrgDB>()
export function openOrgDb(orgId: string): OrgDB {
  let d = open.get(orgId)
  if (!d) { d = new OrgDB(orgId); open.set(orgId, d) }
  return d
}
export async function dropOrgDb(orgId: string): Promise<void> {
  const d = open.get(orgId)
  if (d) { d.close(); open.delete(orgId) }
  await Dexie.delete(`torque-${orgId}`)
}
