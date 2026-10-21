import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import '../ui/css/stock.css'
import { receiptBalance } from '../domain/finance'
import { formatMXN } from '../domain/money'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { Icon, Seg, Stat } from '../ui/ui'
import { CompareTab, OrdersTab, ReceiptsTab, SuppliersTab } from '../ui/stock/ComprasTabs'
import { isLate } from '../ui/stock/helpers'
import { PoSheet, ReceiptSheet, SupplierSheet } from '../ui/stock/PurchaseSheets'

type Tab = 'ordenes' | 'proveedores' | 'recepciones' | 'comparar'
const TABS: [Tab, string][] = [['ordenes', 'Órdenes de compra'], ['proveedores', 'Proveedores'], ['recepciones', 'Recepciones'], ['comparar', 'Comparar precios']]

export function Compras({ data: d }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const open = useOpen()
  const raw = sp.get('t') as Tab | null
  const t: Tab = raw && TABS.some(([k]) => k === raw) ? raw : 'ordenes'
  const id = sp.get('id')
  const setTab = (v: Tab) => setSp({ t: v }, { replace: true })
  const setId = (v: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set('id', v); else n.delete('id'); return n }, { replace: true })
  const k = useMemo(() => {
    const owed = d.receipts.map((r) => ({ bal: receiptBalance(r, d.ledger), due: r.dueDate }))
    return {
      open: d.purchaseOrders.filter((o) => ['borrador', 'enviada', 'parcial'].includes(o.status)).length,
      late: d.purchaseOrders.filter((o) => isLate(o, d.today)).length,
      owed: owed.reduce((a, x) => a + Math.max(0, x.bal), 0),
      overdue: owed.filter((x) => x.bal > 0 && x.due < d.today).reduce((a, x) => a + x.bal, 0),
    }
  }, [d.purchaseOrders, d.receipts, d.ledger, d.today])
  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Compras y proveedores</h1><div className="sub">Pide, recibe y paga mercancía con el costo real de lo que llega.</div></div>
        <div className="row wrap">
          {d.can('compras.editar') && <button className="btn primary" onClick={() => open({ k: 'purchase' })}><Icon n="plus" size={18} />Nueva orden</button>}
          {d.can('compras.editar') && <button className="btn" onClick={() => open({ k: 'supplier' })}>Nuevo proveedor</button>}
          {d.can('pagos_proveedor.registrar') && k.owed > 0 && <button className="btn" onClick={() => open({ k: 'supplierpay' })}>Pagar a proveedor</button>}
        </div>
      </div>
      <div className="grid" role="group" aria-label="Resumen de compras">
        <Stat label="Órdenes abiertas" value={k.open} to="/compras?t=ordenes" hint="Borrador, enviadas o parciales" />
        <Stat label="Entregas atrasadas" value={k.late} tone={k.late ? 'bad' : undefined} hint="Fecha esperada vencida" />
        <Stat label="Por pagar a proveedores" value={formatMXN(k.owed)} to="/compras?t=recepciones" hint="Saldo de recepciones" />
        <Stat label="Vencido por pagar" value={formatMXN(k.overdue)} tone={k.overdue ? 'bad' : undefined} hint="Recepciones vencidas" />
      </div>
      <Seg<Tab> value={t} options={TABS} onChange={setTab} label="Secciones de compras" />
      {t === 'ordenes' && <OrdersTab data={d} openPo={setId} />}
      {t === 'proveedores' && <SuppliersTab data={d} openSupplier={setId} />}
      {t === 'recepciones' && <ReceiptsTab data={d} openReceipt={setId} />}
      {t === 'comparar' && <CompareTab data={d} />}
      {id && t === 'ordenes' && <PoSheet data={d} id={id} onClose={() => setId(null)} />}
      {id && t === 'proveedores' && <SupplierSheet data={d} id={id} onClose={() => setId(null)} />}
      {id && t === 'recepciones' && <ReceiptSheet data={d} id={id} onClose={() => setId(null)} />}
    </div>
  )
}
