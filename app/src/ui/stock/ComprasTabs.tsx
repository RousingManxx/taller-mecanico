import { useMemo, useState } from 'react'
import { receiptBalance } from '../../domain/finance'
import { formatMXN, formatNum } from '../../domain/money'
import type { PurchaseOrder, PurchaseReceipt, Supplier } from '../../domain/types'
import { useOpen } from '../create'
import { fmtDate, type Data } from '../data'
import { Badge, Chips, Empty, Icon, type Column } from '../ui'
import { PO_LABEL, PO_TONE, isLate, norm, outflows, payState, poTotals, suggestQty, useParam, useQParam } from './helpers'
import { ActionList } from './parts'
import { PoButtons } from './PurchaseSheets'

/* ───────── Órdenes de compra ───────── */
type OF = 'todas' | 'abiertas' | 'atrasadas' | 'borrador' | 'enviada' | 'parcial' | 'recibida' | 'cancelada'
export function OrdersTab({ data: d, openPo }: { data: Data; openPo: (id: string) => void }) {
  const open = useOpen()
  const [q, setQ] = useQParam()
  const [f, setF] = useState<OF>('todas')
  const test: Record<OF, (o: PurchaseOrder) => boolean> = {
    todas: () => true, abiertas: (o) => ['borrador', 'enviada', 'parcial'].includes(o.status), atrasadas: (o) => isLate(o, d.today),
    borrador: (o) => o.status === 'borrador', enviada: (o) => o.status === 'enviada', parcial: (o) => o.status === 'parcial', recibida: (o) => o.status === 'recibida', cancelada: (o) => o.status === 'cancelada',
  }
  const list = useMemo(() => {
    const t = norm(q.trim())
    return d.purchaseOrders.filter((o) => test[f](o) && (!t || norm(o.folio).includes(t) || norm(d.supMap.get(o.supplierId)?.name).includes(t) || o.items.some((i) => norm(i.description).includes(t)))).sort((a, b) => b.date.localeCompare(a.date) || b.folio.localeCompare(a.folio))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.purchaseOrders, d.supMap, d.today, q, f])
  const cols: Column<PurchaseOrder>[] = [
    { key: 'folio', label: 'Orden', primary: true, render: (o) => <span><span className="stk-name">{o.folio}</span> <Badge tone={PO_TONE[o.status]}>{PO_LABEL[o.status]}</Badge>{isLate(o, d.today) && <> <Badge tone="bad">Atrasada</Badge></>}</span> },
    { key: 'sup', label: 'Proveedor', render: (o) => d.supMap.get(o.supplierId)?.name ?? '—' },
    { key: 'date', label: 'Fecha', hideMobile: true, render: (o) => fmtDate(o.date) },
    { key: 'exp', label: 'Entrega esperada', render: (o) => o.expectedDate ? fmtDate(o.expectedDate) : <span className="muted">Sin fecha</span> },
    { key: 'total', label: 'Total estimado', align: 'r', render: (o) => <span className="num">{formatMXN(poTotals(o).total)}</span> },
  ]
  const count = (k: OF) => d.purchaseOrders.filter(test[k]).length
  return (
    <div className="stack">
      <div className="stk-tools t3">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Folio, proveedor o producto" /></div></label>
        {d.can('compras.editar') && <button className="btn primary" onClick={() => open({ k: 'purchase' })}><Icon n="plus" size={18} />Nueva orden de compra</button>}
      </div>
      <Chips<OF> value={f} onChange={setF} options={[['todas', `Todas (${count('todas')})`], ['abiertas', `Abiertas (${count('abiertas')})`], ['atrasadas', `Atrasadas (${count('atrasadas')})`], ['borrador', 'Borrador'], ['enviada', 'Enviadas'], ['parcial', 'Parciales'], ['recibida', 'Recibidas'], ['cancelada', 'Canceladas']]} />
      <ActionList rows={list} columns={cols} rowKey={(o) => o.id} onRow={(o) => openPo(o.id)} actions={(o) => <PoButtons data={d} po={o} />}
        empty={d.purchaseOrders.length ? <Empty title="Sin órdenes con ese filtro" /> : <Empty title="Aún no hay órdenes de compra" text="Crea una orden para pedir mercancía, recibirla por partes y llevar el costo real." action={d.can('compras.editar') ? <button className="btn primary" onClick={() => open({ k: 'purchase' })}>Nueva orden de compra</button> : undefined} />} />
      <div className="small muted">El total es estimado (según lo pedido, con IVA). Atrasada = enviada o parcial con fecha esperada vencida.</div>
    </div>
  )
}

/* ───────── Proveedores ───────── */
export function SuppliersTab({ data: d, openSupplier }: { data: Data; openSupplier: (id: string) => void }) {
  const open = useOpen()
  const [q, setQ] = useQParam()
  const [inactive, setInactive] = useState(false)
  const bal = useMemo(() => { const m = new Map<string, number>(); for (const r of d.receipts) m.set(r.supplierId, (m.get(r.supplierId) ?? 0) + Math.max(0, receiptBalance(r, d.ledger))); return m }, [d.receipts, d.ledger])
  const list = useMemo(() => {
    const t = norm(q.trim())
    return d.suppliers.filter((s) => (inactive || s.active || (bal.get(s.id) ?? 0) > 0) && (!t || [s.name, s.contact, s.phone, s.email, s.taxId].some((x) => norm(x).includes(t)))).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [d.suppliers, q, inactive, bal])
  const cols: Column<Supplier>[] = [
    { key: 'name', label: 'Proveedor', primary: true, render: (s) => <span><span className="stk-name">{s.name}</span>{!s.active && <> <Badge>Inactivo</Badge></>}<br /><span className="stk-sub">{s.contact || 'Sin contacto'}</span></span> },
    { key: 'phone', label: 'Teléfono', hideMobile: true, render: (s) => s.phone || '—' },
    { key: 'terms', label: 'Condiciones de pago', render: (s) => s.paymentTermsDays > 0 ? `Crédito ${s.paymentTermsDays} días` : 'Contado' },
    { key: 'lead', label: 'Plazo de entrega', render: (s) => `${s.leadDays} día(s)` },
    { key: 'bal', label: 'Saldo pendiente', align: 'r', render: (s) => { const b = bal.get(s.id) ?? 0; return b > 0 ? <b className="num">{formatMXN(b)}</b> : <span className="muted">—</span> } },
  ]
  return (
    <div className="stack">
      <div className="stk-tools t3">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, contacto, teléfono o RFC" /></div></label>
        {d.can('compras.editar') && <button className="btn primary" onClick={() => open({ k: 'supplier' })}><Icon n="plus" size={18} />Nuevo proveedor</button>}
      </div>
      <label className="chk"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />Mostrar proveedores inactivos</label>
      <ActionList rows={list} columns={cols} rowKey={(s) => s.id} onRow={(s) => openSupplier(s.id)}
        actions={(s) => <>
          {(bal.get(s.id) ?? 0) > 0 && d.can('pagos_proveedor.registrar') && <button className="btn small primary" onClick={() => open({ k: 'supplierpay', supplierId: s.id })}>Pagar</button>}
          {s.active && d.can('compras.editar') && <button className="btn small" onClick={() => open({ k: 'purchase', supplierId: s.id })}>Nueva orden</button>}
        </>}
        empty={d.suppliers.length ? <Empty title="Sin proveedores con esa búsqueda" /> : <Empty title="Aún no hay proveedores" text="Registra a quién le compras para ordenar, recibir y controlar lo que debes." action={d.can('compras.editar') ? <button className="btn primary" onClick={() => open({ k: 'supplier' })}>Nuevo proveedor</button> : undefined} />} />
      <div className="small muted">Saldo pendiente = suma de lo que falta pagar de sus recepciones.</div>
    </div>
  )
}

/* ───────── Recepciones (obligaciones por pagar) ───────── */
type RF = 'todas' | 'porpagar' | 'vencidas' | 'pagadas'
export function ReceiptsTab({ data: d, openReceipt }: { data: Data; openReceipt: (id: string) => void }) {
  const open = useOpen()
  const [q, setQ] = useQParam()
  const [f, setF] = useState<RF>('todas')
  const rows = useMemo(() => d.receipts.map((r) => ({ r, st: payState(r, d.ledger, d.today) })), [d.receipts, d.ledger, d.today])
  type Row = (typeof rows)[number]
  const test: Record<RF, (x: Row) => boolean> = { todas: () => true, porpagar: (x) => x.st.balance > 0, vencidas: (x) => x.st.late, pagadas: (x) => x.st.balance <= 0 }
  const list = useMemo(() => {
    const t = norm(q.trim())
    return rows.filter((x) => test[f](x) && (!t || [x.r.folio, x.r.invoiceRef, d.supMap.get(x.r.supplierId)?.name, d.purchaseOrders.find((o) => o.id === x.r.purchaseOrderId)?.folio].some((s) => norm(s).includes(t))))
      .sort((a, b) => (a.st.balance > 0 ? 0 : 1) - (b.st.balance > 0 ? 0 : 1) || a.r.dueDate.localeCompare(b.r.dueDate))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, f, d.supMap, d.purchaseOrders])
  const count = (k: RF) => rows.filter(test[k]).length
  const owedTotal = rows.reduce((a, x) => a + Math.max(0, x.st.balance), 0)
  const cols: Column<Row>[] = [
    { key: 'folio', label: 'Recepción', primary: true, render: (x) => <span><span className="stk-name">{x.r.folio}</span> <Badge tone={x.st.tone}>{x.st.label}</Badge><br /><span className="stk-sub">{d.supMap.get(x.r.supplierId)?.name ?? '—'}</span></span> },
    { key: 'po', label: 'Orden', hideMobile: true, render: (x) => d.purchaseOrders.find((o) => o.id === x.r.purchaseOrderId)?.folio ?? '—' },
    { key: 'inv', label: 'Factura', hideMobile: true, render: (x) => x.r.invoiceRef || <span className="muted">Sin factura</span> },
    { key: 'date', label: 'Fecha', hideMobile: true, render: (x) => fmtDate(x.r.date) },
    { key: 'due', label: 'Vence', render: (x) => fmtDate(x.r.dueDate) },
    { key: 'total', label: 'Total', align: 'r', render: (x) => <span className="num">{formatMXN(x.r.totalCents)}</span> },
    { key: 'paid', label: 'Pagado', align: 'r', hideMobile: true, render: (x) => <span className="num">{formatMXN(x.st.paid)}</span> },
    { key: 'bal', label: 'Saldo', align: 'r', render: (x) => <b className={`num ${x.st.late ? 'neg' : ''}`}>{formatMXN(x.st.balance)}</b> },
  ]
  return (
    <div className="stack">
      <div className="banner info">Recibir la mercancía, registrar la factura y pagar son tres cosas distintas: una recepción sin pago sigue por pagar hasta que registres el pago.</div>
      <div className="stk-tools t3">
        <label className="f">Buscar<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Folio, factura, orden o proveedor" /></div></label>
        <div className="small muted" style={{ alignSelf: 'center' }}>Por pagar en total: <b className="num">{formatMXN(owedTotal)}</b></div>
      </div>
      <Chips<RF> value={f} onChange={setF} options={[['todas', `Todas (${count('todas')})`], ['porpagar', `Por pagar (${count('porpagar')})`], ['vencidas', `Vencidas (${count('vencidas')})`], ['pagadas', `Pagadas (${count('pagadas')})`]]} />
      <ActionList rows={list} columns={cols} rowKey={(x) => x.r.id} onRow={(x) => openReceipt(x.r.id)}
        actions={(x) => <>{x.st.balance > 0 && d.can('pagos_proveedor.registrar') && <button className="btn small primary" onClick={() => open({ k: 'supplierpay', receiptId: x.r.id })}>Pagar</button>}</>}
        empty={d.receipts.length ? <Empty title="Sin recepciones con ese filtro" /> : <Empty title="Aún no hay recepciones" text="Cuando recibas una orden de compra aparecerá aquí como cuenta por pagar." />} />
    </div>
  )
}
export type { PurchaseReceipt }

/* ───────── Comparar precios ───────── */
export function CompareTab({ data: d }: { data: Data }) {
  const open = useOpen()
  const [q, setQ] = useQParam()
  const [mode, setMode] = useParam('m')
  const multi = mode !== 'todos'
  const out = useMemo(() => outflows(d.movements, d.today), [d.movements, d.today])
  const groups = useMemo(() => {
    const m = new Map<string, typeof d.supplierProducts>()
    for (const sp of d.supplierProducts) { if (!d.prodMap.has(sp.productId) || !d.supMap.has(sp.supplierId)) continue; m.set(sp.productId, [...(m.get(sp.productId) ?? []), sp]) }
    const t = norm(q.trim())
    return [...m].map(([pid, sps]) => ({ p: d.prodMap.get(pid)!, sps: [...sps].sort((a, b) => a.lastCostCents - b.lastCostCents) }))
      .filter((g) => (!multi || g.sps.length >= 2) && (!t || [g.p.name, g.p.sku, g.p.partNo, g.p.brand].some((x) => norm(x).includes(t))))
      .sort((a, b) => b.sps.length - a.sps.length || a.p.name.localeCompare(b.p.name, 'es'))
  }, [d, q, multi])
  const buy = (pid: string, sid: string) => {
    const p = d.prodMap.get(pid)
    if (!p) return
    const st = d.stock.get(pid)?.qty ?? 0
    const sug = suggestQty(p.minStock, st, (out.get(pid) ?? 0) / 60, d.supMap.get(sid)?.leadDays ?? 0)
    open({ k: 'purchase', supplierId: sid, items: [{ productId: pid, qty: sug || Math.max(1, Math.ceil(p.minStock)) }] })
  }
  return (
    <div className="stack">
      <div className="stk-tools t3">
        <label className="f">Buscar producto<div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, nombre, parte o marca" /></div></label>
        <label className="f">Mostrar<select value={multi ? 'multi' : 'todos'} onChange={(e) => setMode(e.target.value === 'todos' ? 'todos' : '')}><option value="multi">Productos con 2 o más proveedores</option><option value="todos">Todos los productos comprados</option></select></label>
      </div>
      <div className="small muted">Se compara el último costo unitario de adquisición con cada proveedor (incluye el flete prorrateado, sin IVA). El menor costo no siempre es la mejor compra: revisa también el crédito y el plazo de entrega.</div>
      {!groups.length && (d.supplierProducts.length
        ? <Empty title={multi ? 'Ningún producto se ha comprado a 2 o más proveedores' : 'Sin resultados'} text={multi ? 'Cuando compres el mismo producto a distintos proveedores podrás compararlos aquí. Mientras tanto, mira todos los productos comprados.' : undefined} action={multi ? <button className="btn" onClick={() => setMode('todos')}>Ver todos los productos comprados</button> : undefined} />
        : <Empty title="Aún no hay costos por proveedor" text="Los costos aparecen cuando recibes compras." />)}
      {groups.map(({ p, sps }) => {
        const min = sps[0].lastCostCents
        return (
          <section key={p.id} className="card stack" aria-label={p.name}>
            <div className="row between wrap"><div><span className="stk-name">{p.name}</span> <span className="stk-sub stk-mono">{p.sku}</span></div>{sps.length > 1 && <span className="small muted">{sps.length} proveedores</span>}</div>
            <div className="tablewrap"><table className="table"><thead><tr><th>Proveedor</th><th className="r">Último costo</th><th className="r">Diferencia</th><th className="stk-hm">Crédito</th><th className="stk-hm">Entrega</th><th className="stk-hm">Actualizado</th>{d.can('compras.editar') && <th><span className="sr-only">Acción</span></th>}</tr></thead>
              <tbody>{sps.map((sp, i) => {
                const s = d.supMap.get(sp.supplierId)!
                const best = sp.lastCostCents === min && sps.length > 1
                const diff = min > 0 ? ((sp.lastCostCents - min) / min) * 100 : 0
                return (
                  <tr key={sp.id} className={best ? 'stk-best' : undefined}>
                    <td>{s.name} {best && <Badge tone="ok">Más barato</Badge>}{sp.supplierSku && <div className="stk-sub">SKU {sp.supplierSku}</div>}</td>
                    <td className="r num">{formatMXN(sp.lastCostCents)}</td>
                    <td className="r num">{i === 0 || diff === 0 ? '—' : `+${formatNum(Math.round(diff * 10) / 10)} %`}</td>
                    <td className="stk-hm">{s.paymentTermsDays > 0 ? `${s.paymentTermsDays} días` : 'Contado'}</td>
                    <td className="stk-hm">{s.leadDays} día(s)</td>
                    <td className="stk-hm">{fmtDate(sp.updatedAt)}</td>
                    {d.can('compras.editar') && <td className="r">{s.active && <button className="btn small" onClick={() => buy(p.id, s.id)}>Comprar</button>}</td>}
                  </tr>
                )
              })}</tbody></table></div>
          </section>
        )
      })}
    </div>
  )
}
