import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Appointment, Customer, Employee, Expense, Product, PurchaseOrder, Quotation, RecurringExpense, ServiceDef, Supplier, User, Vehicle } from '../domain/types'
import type { Data } from './data'
import { AdjustSheet } from './forms/AdjustSheet'
import { AppointmentForm } from './forms/AppointmentForm'
import { AuthorizeSheet } from './forms/AuthorizeSheet'
import { CashCloseSheet, CashMoveSheet, CashOpenSheet } from './forms/CashSheets'
import { CountSheet } from './forms/CountSheet'
import { CustomerForm } from './forms/CustomerForm'
import { DeliverSheet } from './forms/DeliverSheet'
import { EmployeeForm } from './forms/EmployeeForm'
import { ExpenseForm } from './forms/ExpenseForm'
import { ExpensePaySheet } from './forms/ExpensePaySheet'
import { ItemForm } from './forms/ItemForm'
import { ManualTimeSheet } from './forms/ManualTimeSheet'
import { OrderForm } from './forms/OrderForm'
import { PaymentSheet } from './forms/PaymentSheet'
import { ProductForm } from './forms/ProductForm'
import { PurchaseForm } from './forms/PurchaseForm'
import { QuoteForm } from './forms/QuoteForm'
import { ReceiveSheet } from './forms/ReceiveSheet'
import { RecurringForm } from './forms/RecurringForm'
import { ReturnSheet } from './forms/ReturnSheet'
import { SaleForm } from './forms/SaleForm'
import { ServiceForm } from './forms/ServiceForm'
import { SupplierForm } from './forms/SupplierForm'
import { SupplierPaySheet } from './forms/SupplierPaySheet'
import { UserForm } from './forms/UserForm'
import { VehicleForm } from './forms/VehicleForm'
import { WarrantySheet } from './forms/WarrantySheet'

/** Hojas (formularios y acciones) que se pueden abrir desde cualquier pantalla con `useOpen()`. */
export type Sheet =
  | { k: 'customer'; v?: Customer }
  | { k: 'vehicle'; v?: Vehicle; customerId?: string }
  | { k: 'appointment'; v?: Appointment; start?: string; customerId?: string; vehicleId?: string }
  | { k: 'order'; customerId?: string; vehicleId?: string; appointmentId?: string }
  | { k: 'item'; orderId: string }
  | { k: 'authorize'; orderId: string; itemIds?: string[] }
  | { k: 'deliver'; orderId: string }
  | { k: 'warranty'; orderId: string }
  | { k: 'manualtime'; orderId: string }
  | { k: 'quote'; v?: Quotation; customerId?: string; vehicleId?: string }
  | { k: 'sale'; customerId?: string; productId?: string }
  | { k: 'payment'; saleId?: string; workOrderId?: string }
  | { k: 'return'; saleId: string }
  | { k: 'product'; v?: Product }
  | { k: 'service'; v?: ServiceDef }
  | { k: 'adjust'; productId?: string }
  | { k: 'count' }
  | { k: 'supplier'; v?: Supplier }
  | { k: 'purchase'; v?: PurchaseOrder; supplierId?: string; items?: { productId: string; qty: number }[] }
  | { k: 'receive'; poId: string }
  | { k: 'supplierpay'; supplierId?: string; receiptId?: string }
  | { k: 'expense'; v?: Expense }
  | { k: 'expensepay'; expenseId: string }
  | { k: 'recurring'; v?: RecurringExpense }
  | { k: 'cashopen' } | { k: 'cashclose' } | { k: 'cashmove' }
  | { k: 'employee'; v?: Employee }
  | { k: 'user'; v?: Omit<User, 'pinHash' | 'pinSalt'> }

const Ctx = createContext<(s: Sheet) => void>(() => {})
export const useOpen = () => useContext(Ctx)

export function SheetHost({ data, children }: { data: Data; children: ReactNode }) {
  const [s, setS] = useState<Sheet | null>(null)
  const onClose = () => setS(null)
  const key = s ? JSON.stringify(s, (_k, v) => (v && typeof v === 'object' && 'id' in v ? v.id : v)) : ''
  return (
    <Ctx.Provider value={setS}>
      {children}
      {s?.k === 'customer' && <CustomerForm key={key} data={data} customer={s.v} onClose={onClose} />}
      {s?.k === 'vehicle' && <VehicleForm key={key} data={data} vehicle={s.v} customerId={s.customerId} onClose={onClose} />}
      {s?.k === 'appointment' && <AppointmentForm key={key} data={data} appointment={s.v} start={s.start} customerId={s.customerId} vehicleId={s.vehicleId} onClose={onClose} />}
      {s?.k === 'order' && <OrderForm key={key} data={data} customerId={s.customerId} vehicleId={s.vehicleId} appointmentId={s.appointmentId} onClose={onClose} />}
      {s?.k === 'item' && <ItemForm key={key} data={data} orderId={s.orderId} onClose={onClose} />}
      {s?.k === 'authorize' && <AuthorizeSheet key={key} data={data} orderId={s.orderId} itemIds={s.itemIds} onClose={onClose} />}
      {s?.k === 'deliver' && <DeliverSheet key={key} data={data} orderId={s.orderId} onClose={onClose} />}
      {s?.k === 'warranty' && <WarrantySheet key={key} data={data} orderId={s.orderId} onClose={onClose} />}
      {s?.k === 'manualtime' && <ManualTimeSheet key={key} data={data} orderId={s.orderId} onClose={onClose} />}
      {s?.k === 'quote' && <QuoteForm key={key} data={data} quote={s.v} customerId={s.customerId} vehicleId={s.vehicleId} onClose={onClose} />}
      {s?.k === 'sale' && <SaleForm key={key} data={data} customerId={s.customerId} productId={s.productId} onClose={onClose} />}
      {s?.k === 'payment' && <PaymentSheet key={key} data={data} saleId={s.saleId} workOrderId={s.workOrderId} onClose={onClose} />}
      {s?.k === 'return' && <ReturnSheet key={key} data={data} saleId={s.saleId} onClose={onClose} />}
      {s?.k === 'product' && <ProductForm key={key} data={data} product={s.v} onClose={onClose} />}
      {s?.k === 'service' && <ServiceForm key={key} data={data} service={s.v} onClose={onClose} />}
      {s?.k === 'adjust' && <AdjustSheet key={key} data={data} productId={s.productId} onClose={onClose} />}
      {s?.k === 'count' && <CountSheet key={key} data={data} onClose={onClose} />}
      {s?.k === 'supplier' && <SupplierForm key={key} data={data} supplier={s.v} onClose={onClose} />}
      {s?.k === 'purchase' && <PurchaseForm key={key} data={data} purchase={s.v} supplierId={s.supplierId} items={s.items} onClose={onClose} />}
      {s?.k === 'receive' && <ReceiveSheet key={key} data={data} poId={s.poId} onClose={onClose} />}
      {s?.k === 'supplierpay' && <SupplierPaySheet key={key} data={data} supplierId={s.supplierId} receiptId={s.receiptId} onClose={onClose} />}
      {s?.k === 'expense' && <ExpenseForm key={key} data={data} expense={s.v} onClose={onClose} />}
      {s?.k === 'expensepay' && <ExpensePaySheet key={key} data={data} expenseId={s.expenseId} onClose={onClose} />}
      {s?.k === 'recurring' && <RecurringForm key={key} data={data} recurring={s.v} onClose={onClose} />}
      {s?.k === 'cashopen' && <CashOpenSheet key={key} data={data} onClose={onClose} />}
      {s?.k === 'cashclose' && <CashCloseSheet key={key} data={data} onClose={onClose} />}
      {s?.k === 'cashmove' && <CashMoveSheet key={key} data={data} onClose={onClose} />}
      {s?.k === 'employee' && <EmployeeForm key={key} data={data} employee={s.v} onClose={onClose} />}
      {s?.k === 'user' && <UserForm key={key} data={data} user={s.v} onClose={onClose} />}
    </Ctx.Provider>
  )
}

