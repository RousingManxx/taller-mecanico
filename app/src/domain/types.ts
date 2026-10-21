/** Modelo de datos de Torque. Importes en centavos enteros (MXN). Fechas de negocio 'YYYY-MM-DD'; eventos en ISO-8601. */
export type Cents = number
export type ISODate = string
export type ISODateTime = string

export interface Base { id: string; orgId: string; createdAt: ISODateTime; updatedAt: ISODateTime }

/* ───────── Configuración ───────── */
export type DocKind = 'orden' | 'cotizacion' | 'venta' | 'compra' | 'recepcion'
export interface TaxRate { id: string; name: string; rate: number }
export interface ExpenseCategory {
  id: string; name: string
  /** 'operativo': se resta en el resultado operativo. 'mano_obra_directa': nómina de mecánicos; ya está representada por el costo laboral imputado a las órdenes (no se resta dos veces). */
  kind: 'operativo' | 'mano_obra_directa'
  /** Si participa del fondo de costos indirectos que se puede asignar a órdenes. */
  allocate: boolean
}
export interface PaymentMethod { id: string; name: string; account: 'caja' | 'banco' }
export type OverheadMethod = 'ninguno' | 'porcentaje_ventas' | 'hora_productiva' | 'por_orden'

export interface Settings extends Base {
  businessName: string; legalName: string; taxId: string; address: string; phone: string; email: string
  currency: 'MXN'; timezone: string; locale: string
  taxes: TaxRate[]; defaultTaxId: string
  /** true: los precios capturados ya incluyen impuestos. */
  pricesIncludeTax: boolean
  targetMarginPct: number; minMarginPct: number
  counters: Record<DocKind, number>; prefixes: Record<DocKind, string>
  labor: { productiveHoursPerMonth: number; loadPct: number; defaultRateCents: Cents }
  overheadMethod: OverheadMethod
  requireAuthorization: boolean
  warrantyDays: number; warrantyText: string; quoteValidDays: number; quoteTerms: string
  showCostsInQuote: false
  paymentMethods: PaymentMethod[]
  expenseCategories: ExpenseCategory[]
  productCategories: string[]; serviceCategories: string[]; units: string[]
  lowStockDefault: number
  onboardingDone: boolean
  lastBackupAt?: ISODateTime
  logoId?: string
  schemaVersion: number
}

/* ───────── Usuarios y permisos ───────── */
export type RoleId = 'propietario' | 'gerente' | 'recepcion' | 'mecanico' | 'almacen' | 'finanzas'
export interface User extends Base {
  name: string; role: RoleId; active: boolean
  pinHash: string; pinSalt: string
  employeeId?: string
  /** Permisos adicionales o retirados respecto al rol. */
  grant?: string[]; revoke?: string[]
}

/* ───────── Clientes y vehículos ───────── */
export interface Customer extends Base {
  name: string; phone: string; email: string; address: string; taxId: string; fiscalName: string; fiscalAddress: string
  contactPref: 'telefono' | 'whatsapp' | 'correo' | 'ninguna'; notes: string; active: boolean
}
export interface Vehicle extends Base {
  customerId: string; make: string; model: string; year?: number; version: string; plate: string; vin: string
  km: number; fuel: 'gasolina' | 'diesel' | 'hibrido' | 'electrico' | 'gas' | ''; transmission: 'manual' | 'automatica' | ''
  color: string; engineNo: string; notes: string; photoIds: string[]; active: boolean
}

/* ───────── Catálogos ───────── */
export interface ServiceDef extends Base {
  name: string; category: string; description: string; stdHours: number; priceCents: Cents; taxId: string
  minMarginPct?: number; active: boolean
}
export type ProductType = 'refaccion' | 'consumible'
export interface Product extends Base {
  sku: string; barcode: string; name: string; description: string; category: string; brand: string; partNo: string
  type: ProductType; unit: string; supplierId?: string; priceCents: Cents; taxId: string
  minStock: number; location: string; minMarginPct?: number; compat: string
  /** Último costo de compra unitario (centavos, decimal), para detectar aumentos. */
  lastPurchaseCost?: number
  /** Costo de compra anterior, para detectar aumentos de costo. */
  prevPurchaseCost?: number
  photoId?: string; active: boolean
}
export interface Warehouse extends Base { name: string; isDefault: boolean }
export interface InventoryBalance { id: string; orgId: string; productId: string; warehouseId: string; qty: number; valueCents: Cents }

export type MovementType =
  | 'compra' | 'entrada' | 'venta' | 'consumo_orden' | 'devolucion_cliente' | 'devolucion_orden'
  | 'ajuste_positivo' | 'ajuste_negativo' | 'merma' | 'traspaso_salida' | 'traspaso_entrada' | 'inventario_fisico' | 'devolucion_proveedor'
export interface InventoryMovement {
  id: string; orgId: string; productId: string; warehouseId: string; type: MovementType
  /** Con signo: + entra, − sale. */
  qty: number; unitCost: number; totalCostCents: Cents
  refType: string; refId: string; userId: string; reason: string; at: ISODateTime; date: ISODate
  reverses?: string; opKey?: string
}

/* ───────── Compras ───────── */
export interface Supplier extends Base {
  name: string; contact: string; phone: string; email: string; address: string; taxId: string
  paymentTermsDays: number; leadDays: number; notes: string; active: boolean
}
export interface SupplierProduct { id: string; orgId: string; supplierId: string; productId: string; supplierSku: string; lastCostCents: number; updatedAt: ISODateTime }
export type PurchaseStatus = 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada'
export interface PurchaseItem { id: string; productId: string; description: string; qty: number; receivedQty: number; unitCostCents: number; discountCents: Cents }
export interface PurchaseOrder extends Base {
  folio: string; supplierId: string; status: PurchaseStatus; date: ISODate; expectedDate?: ISODate
  items: PurchaseItem[]; freightCents: Cents; taxRate: number; notes: string; cancelReason?: string
}
export interface ReceiptItem { itemId: string; productId: string; qty: number; goodsCents: Cents; freightCents: Cents; landedCents: Cents; movementId: string }
export interface PurchaseReceipt extends Base {
  folio: string; purchaseOrderId: string; supplierId: string; date: ISODate; dueDate: ISODate; invoiceRef: string
  items: ReceiptItem[]; goodsCents: Cents; freightCents: Cents; taxCents: Cents; totalCents: Cents; opKey?: string
}

/* ───────── Órdenes de trabajo ───────── */
export type OrderStatus =
  | 'borrador' | 'pendiente_autorizacion' | 'autorizada' | 'espera_diagnostico' | 'en_diagnostico' | 'esperando_refacciones'
  | 'en_reparacion' | 'en_pruebas' | 'lista_entrega' | 'entregada' | 'cancelada'
export type ItemType = 'servicio' | 'refaccion' | 'consumible' | 'externo' | 'otro'
export type ItemStatus = 'sugerido' | 'cotizado' | 'autorizado' | 'ejecutado' | 'rechazado'
export interface WorkItem {
  id: string; type: ItemType; refId?: string; description: string; qty: number; unit: string
  unitPriceCents: Cents; discountCents: Cents; taxRate: number; status: ItemStatus
  /** Costo total atribuido (refacciones: suma de movimientos de salida; externos: costo del proveedor). */
  costCents: Cents; movementIds: string[]; stdHours: number; mechanicId?: string
  /** Cantidad ya consumida del inventario (refacciones/consumibles). */
  consumedQty: number
  authorizedAt?: ISODateTime; authorizedBy?: string; note?: string
}
export interface TimeEntry {
  id: string; employeeId: string; itemId?: string; kind: 'trabajo' | 'espera'
  startAt: ISODateTime; endAt?: ISODateTime; minutes: number
  /** Costo por hora vigente al cerrar el tramo (instantánea). */
  hourlyCostCents: Cents; costCents: Cents
}
export interface Authorization {
  id: string; at: ISODateTime; userId: string; approvedBy: string; via: 'presencial' | 'telefono' | 'whatsapp' | 'firma' | 'otro'
  amountCents: Cents; itemIds: string[]; quotationId?: string; quotationVersion?: number; notes: string
}
export interface StatusChange { at: ISODateTime; from: OrderStatus | null; to: OrderStatus; userId: string; note: string }
export interface WorkOrder extends Base {
  folio: string; status: OrderStatus; customerId: string; vehicleId: string
  receivedAt: ISODateTime; km: number; kmOut?: number; fuelLevel: string
  complaint: string; symptoms: string; inspection: string; diagnosis: string
  damages: string; accessories: string
  mechanicId?: string; priority: 'baja' | 'normal' | 'alta' | 'urgente'; promisedAt?: ISODateTime
  notesInternal: string; notesCustomer: string
  items: WorkItem[]; timeEntries: TimeEntry[]; statusHistory: StatusChange[]; authorizations: Authorization[]
  photoIds: string[]; quotationId?: string; appointmentId?: string; saleId?: string
  isWarranty: boolean; warrantyOfOrderId?: string
  deliveredAt?: ISODateTime; cancelReason?: string; waitingParts: boolean
}

/* ───────── Cotizaciones ───────── */
export type QuoteStatus = 'borrador' | 'enviada' | 'vista' | 'aprobada' | 'rechazada' | 'vencida' | 'convertida'
export interface QuoteItem {
  id: string; type: ItemType; refId?: string; description: string; qty: number; unit: string
  unitPriceCents: Cents; discountCents: Cents; taxRate: number
  /** Costo unitario estimado (centavos, decimal): solo uso interno. */
  estUnitCost: number; stdHours: number
}
export interface QuoteVersion {
  n: number; createdAt: ISODateTime; userId: string; items: QuoteItem[]; notes: string; terms: string; warranty: string; estimatedDays: number
}
export interface Quotation extends Base {
  folio: string; customerId: string; vehicleId: string; status: QuoteStatus; issueDate: ISODate; validUntil: ISODate
  versions: QuoteVersion[]; currentVersion: number; approvedVersion?: number; approvedBy?: string; approvedAt?: ISODateTime
  workOrderId?: string; rejectReason?: string
}

/* ───────── Ventas y dinero ───────── */
export interface SaleItem {
  id: string; type: ItemType; refId?: string; description: string; qty: number; unit: string
  unitPriceCents: Cents; discountCents: Cents; taxRate: number
  netCents: Cents; taxCents: Cents; totalCents: Cents
  /** Costo directo atribuido a la partida (refacciones: costo de salida; servicios: mano de obra imputada). */
  costCents: Cents; costEstimated: boolean; movementIds: string[]; mechanicId?: string; stdHours: number; hours: number
}
export interface SaleReturn {
  id: string; at: ISODateTime; date: ISODate; itemId: string; qty: number; netCents: Cents; taxCents: Cents
  costRecoveredCents: Cents; movementId?: string; reason: string; userId: string
}
export type SaleStatus = 'emitida' | 'cancelada'
export interface Sale extends Base {
  folio: string; kind: 'orden' | 'mostrador'; status: SaleStatus; workOrderId?: string; customerId?: string; customerName: string
  date: ISODate; dueDate: ISODate; items: SaleItem[]
  netCents: Cents; taxCents: Cents; totalCents: Cents
  /** Costo directo total al emitir (suma de partidas + otros costos). */
  costCents: Cents; otherCostCents: Cents; laborHours: number
  returns: SaleReturn[]; notes: string; cancelReason?: string; opKey?: string; userId: string
}
export type LedgerKind =
  | 'cobro_cliente' | 'reembolso_cliente' | 'pago_gasto' | 'pago_proveedor' | 'aportacion_dueno' | 'retiro_dueno'
  | 'prestamo_recibido' | 'pago_prestamo' | 'transferencia_entrada' | 'transferencia_salida' | 'reembolso_proveedor' | 'otro_ingreso' | 'otro_egreso'
export interface LedgerEntry {
  id: string; orgId: string; kind: LedgerKind; direction: 'in' | 'out'; amountCents: Cents; date: ISODate; at: ISODateTime
  methodId: string; account: 'caja' | 'banco'; reference: string; note: string; userId: string
  saleId?: string; workOrderId?: string; customerId?: string; expenseId?: string; supplierId?: string
  allocations?: { receiptId: string; amountCents: Cents }[]
  sessionId?: string; reversalOf?: string; opKey?: string
}
export interface CashSession {
  id: string; orgId: string; status: 'abierta' | 'cerrada'; openedAt: ISODateTime; openedBy: string; openingCents: Cents
  closedAt?: ISODateTime; closedBy?: string; expectedCents?: Cents; countedCents?: Cents; differenceCents?: Cents; note: string; authorizedBy?: string
}

export interface Expense extends Base {
  concept: string; categoryId: string; date: ISODate; amountCents: Cents; taxCents: Cents; supplierId?: string
  dueDate?: ISODate; costCenter: string; notes: string; recurringId?: string; recurringKey?: string; attachmentIds: string[]; cancelled?: boolean
}
export interface RecurringExpense extends Base {
  concept: string; categoryId: string; amountCents: Cents; taxCents: Cents; frequency: 'mensual' | 'semanal'; dayOfMonth: number
  supplierId?: string; costCenter: string; active: boolean; startDate: ISODate
}

/* ───────── Personal y agenda ───────── */
export interface Employee extends Base {
  name: string; role: string; specialty: string; hireDate?: ISODate; phone: string; email: string; active: boolean
  isMechanic: boolean
  /** Costo laboral mensual (salario). Dato sensible. */
  monthlyCostCents: Cents
  /** Sobrescribe la carga laboral y las horas productivas globales. */
  loadPct?: number; productiveHoursPerMonth?: number
  commercialRateCents: Cents
}
export type AppointmentStatus = 'solicitada' | 'confirmada' | 'en_recepcion' | 'convertida' | 'completada' | 'cancelada' | 'no_asistio'
export interface Appointment extends Base {
  customerId: string; vehicleId?: string; start: ISODateTime; durationMin: number; reason: string; serviceId?: string
  mechanicId?: string; status: AppointmentStatus; notes: string; workOrderId?: string
}

/* ───────── Precios, auditoría, archivos ───────── */
export interface PriceHistory {
  id: string; orgId: string; kind: 'producto' | 'servicio'; refId: string; at: ISODateTime; userId: string
  oldPriceCents: Cents; newPriceCents: Cents; reason: string
}
export interface PriceProposal extends Base {
  kind: 'producto' | 'servicio'; refId: string; name: string; currentPriceCents: Cents; proposedPriceCents: Cents
  costBasis: number; targetMarginPct: number; status: 'pendiente' | 'aprobada' | 'rechazada'; decidedBy?: string; decidedAt?: ISODateTime
}
export interface AuditLog {
  id: string; orgId: string; at: ISODateTime; userId: string; userName: string; action: string
  entity: string; entityId: string; before?: unknown; after?: unknown; reason?: string
}
export interface Attachment { id: string; orgId: string; ownerType: string; ownerId: string; name: string; mime: string; size: number; dataUrl: string; createdAt: ISODateTime }
export interface OpRecord { key: string; orgId: string; kind: string; resultId: string; at: ISODateTime }
