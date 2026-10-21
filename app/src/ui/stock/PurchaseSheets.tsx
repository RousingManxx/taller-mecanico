import { useMemo } from 'react'
import { receiptBalance } from '../../domain/finance'
import { formatMXN, formatQty } from '../../domain/money'
import type { PurchaseOrder } from '../../domain/types'
import { useOpen } from '../create'
import { fmtDate, fmtDateTime, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Empty, Sheet } from '../ui'
import { PO_LABEL, PO_TONE, canEditPO, isLate, payState, pendingQty, poTotals, usePoActions, useUserNames } from './helpers'
import { Di, Dl, Sec } from './parts'

/** Botones de acción de una orden de compra según su estado (lista y detalle). */
export function PoButtons({ data: d, po, onDone }: { data: Data; po: PurchaseOrder; onDone?: () => void }) {
  const open = useOpen()
  const { busy, send, cancel } = usePoActions()
  const edit = d.can('compras.editar'), canEdit = canEditPO(po, d.receipts)
  const go = (fn: () => void) => () => { onDone?.(); fn() }
  return (
    <>
      {edit && po.status === 'borrador' && <button className="btn small primary" disabled={busy} onClick={() => send(po).then((r) => r && onDone?.())}>Enviar</button>}
      {d.can('compras.recibir') && ['borrador', 'enviada', 'parcial'].includes(po.status) && <button className="btn small primary" onClick={go(() => open({ k: 'receive', poId: po.id }))}>Recibir</button>}
      {edit && canEdit && <button className="btn small" onClick={go(() => open({ k: 'purchase', v: po }))}>Editar</button>}
      {edit && ['borrador', 'enviada', 'parcial'].includes(po.status) && <button className="btn small danger" disabled={busy} onClick={() => cancel(po).then((r) => r && onDone?.())}>Cancelar</button>}
      <a className="btn small" href={`#/imprimir/compra/${po.id}`}>Imprimir</a>
    </>
  )
}

export function PoSheet({ data: d, id, onClose }: { data: Data; id: string; onClose: () => void }) {
  const po = d.purchaseOrders.find((x) => x.id === id)
  if (!po) return <Sheet title="Orden de compra" onClose={onClose}><Empty title="La orden ya no existe" /></Sheet>
  const t = poTotals(po), sup = d.supMap.get(po.supplierId)
  const recs = d.receipts.filter((r) => r.purchaseOrderId === po.id).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <Sheet title={`Orden ${po.folio}`} wide onClose={onClose} footer={<><div className="stk-acts" style={{ marginRight: 'auto' }}><PoButtons data={d} po={po} onDone={onClose} /></div><button className="btn primary" onClick={onClose}>Cerrar</button></>}>
      <div className="stack-lg">
        <div className="row wrap"><Badge tone={PO_TONE[po.status]}>{PO_LABEL[po.status]}</Badge>{isLate(po, d.today) && <Badge tone="bad">Atrasada</Badge>}</div>
        <Sec title="Datos">
          <Dl>
            <Di k="Proveedor">{sup?.name ?? '—'}</Di><Di k="Fecha de la orden">{fmtDate(po.date)}</Di><Di k="Entrega esperada">{po.expectedDate ? fmtDate(po.expectedDate) : 'Sin fecha'}</Di>
            {po.notes && <Di k="Notas" wide>{po.notes}</Di>}
            {po.cancelReason && <Di k="Motivo de cancelación" wide>{po.cancelReason}</Di>}
          </Dl>
        </Sec>
        <Sec title="Partidas">
          <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Producto</th><th className="r">Pedido</th><th className="r">Recibido</th><th className="r">Pendiente</th><th className="r">Costo unit.</th><th className="r">Descuento</th></tr></thead>
            <tbody>{po.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="r num">{formatQty(i.qty)}</td><td className="r num">{formatQty(i.receivedQty)}</td><td className="r num">{po.status === 'cancelada' ? '—' : formatQty(pendingQty(i))}</td><td className="r num">{formatMXN(i.unitCostCents)}</td><td className="r num">{i.discountCents ? formatMXN(i.discountCents) : '—'}</td></tr>)}</tbody></table></div>
          <div className="stk-totals">
            <span>Mercancía (con descuentos)</span><span>{formatMXN(t.goods)}</span><span>Flete</span><span>{formatMXN(t.freight)}</span><span>IVA ({po.taxRate} %)</span><span>{formatMXN(t.tax)}</span><span className="big">Total estimado</span><span className="big">{formatMXN(t.total)}</span>
          </div>
          <div className="small muted">Estimado según lo pedido. Lo que se debe al proveedor es lo realmente recibido (ver recepciones).</div>
        </Sec>
        <Sec title="Recepciones de esta orden">
          {recs.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Folio</th><th>Fecha</th><th>Factura</th><th className="r">Total</th><th className="r">Saldo</th><th>Estado</th></tr></thead>
              <tbody>{recs.map((r) => { const s = payState(r, d.ledger, d.today); return <tr key={r.id}><td>{r.folio}</td><td>{fmtDate(r.date)}</td><td>{r.invoiceRef || 'Sin factura'}</td><td className="r num">{formatMXN(r.totalCents)}</td><td className="r num">{formatMXN(s.balance)}</td><td><Badge tone={s.tone}>{s.label}</Badge></td></tr> })}</tbody></table></div>
          ) : <div className="small muted">Todavía no se recibe nada de esta orden.</div>}
        </Sec>
      </div>
    </Sheet>
  )
}

export function ReceiptSheet({ data: d, id, onClose }: { data: Data; id: string; onClose: () => void }) {
  const open = useOpen()
  const names = useUserNames(useCtx())
  const r = d.receipts.find((x) => x.id === id)
  const pays = useMemo(() => d.ledger.filter((l) => (l.kind === 'pago_proveedor' || l.kind === 'reembolso_proveedor') && l.allocations?.some((a) => a.receiptId === id)).sort((a, b) => a.at.localeCompare(b.at)), [d.ledger, id])
  if (!r) return <Sheet title="Recepción" onClose={onClose}><Empty title="La recepción ya no existe" /></Sheet>
  const st = payState(r, d.ledger, d.today), po = d.purchaseOrders.find((o) => o.id === r.purchaseOrderId)
  return (
    <Sheet title={`Recepción ${r.folio}`} wide onClose={onClose} footer={<>
      {st.balance > 0 && d.can('pagos_proveedor.registrar') && <button className="btn primary" onClick={() => open({ k: 'supplierpay', receiptId: r.id })}>Pagar</button>}
      <button className="btn" onClick={onClose}>Cerrar</button>
    </>}>
      <div className="stack-lg">
        <div className="row wrap"><Badge tone="ok">Compra recibida</Badge><Badge tone={r.invoiceRef ? 'ok' : ''}>{r.invoiceRef ? `Factura ${r.invoiceRef}` : 'Sin factura registrada'}</Badge><Badge tone={st.tone}>{st.label}</Badge></div>
        <Sec title="Datos">
          <Dl><Di k="Proveedor">{d.supMap.get(r.supplierId)?.name ?? '—'}</Di><Di k="Orden de compra">{po?.folio ?? '—'}</Di><Di k="Fecha de recepción">{fmtDate(r.date)}</Di><Di k="Vencimiento del pago">{fmtDate(r.dueDate)}</Di></Dl>
        </Sec>
        <Sec title="Lo recibido (costo de adquisición)">
          <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Producto</th><th className="r">Cantidad</th><th className="r">Mercancía</th><th className="r">Flete prorrateado</th><th className="r">Costo de adquisición</th><th className="r">Costo unit.</th></tr></thead>
            <tbody>{r.items.map((i) => <tr key={i.itemId}><td>{d.prodMap.get(i.productId)?.name ?? '—'}</td><td className="r num">{formatQty(i.qty)}</td><td className="r num">{formatMXN(i.goodsCents)}</td><td className="r num">{formatMXN(i.freightCents)}</td><td className="r num">{formatMXN(i.landedCents)}</td><td className="r num">{formatMXN(Math.round(i.landedCents / i.qty))}</td></tr>)}</tbody></table></div>
          <div className="stk-totals">
            <span>Mercancía</span><span>{formatMXN(r.goodsCents)}</span><span>Flete</span><span>{formatMXN(r.freightCents)}</span><span>IVA</span><span>{formatMXN(r.taxCents)}</span>
            <span className="big">Total por pagar</span><span className="big">{formatMXN(r.totalCents)}</span>
            <span>Pagado</span><span>{formatMXN(st.paid)}</span><span><b>Saldo</b></span><span><b>{formatMXN(st.balance)}</b></span>
          </div>
        </Sec>
        <Sec title="Pagos aplicados">
          {pays.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th className="r">Aplicado</th><th>Usuario</th></tr></thead>
              <tbody>{pays.map((l) => { const a = l.allocations?.filter((x) => x.receiptId === id).reduce((s, x) => s + x.amountCents, 0) ?? 0; return <tr key={l.id}><td>{fmtDateTime(l.at)}</td><td>{d.settings.paymentMethods.find((m) => m.id === l.methodId)?.name ?? '—'}</td><td>{l.reference || '—'}</td><td className="r num">{l.direction === 'out' ? '' : '−'}{formatMXN(a)}</td><td>{names.get(l.userId) ?? '—'}</td></tr> })}</tbody></table></div>
          ) : <div className="small muted">Aún no se registra ningún pago. Recibir la mercancía no es pagarla: este documento sigue por pagar.</div>}
        </Sec>
      </div>
    </Sheet>
  )
}

export function SupplierSheet({ data: d, id, onClose }: { data: Data; id: string; onClose: () => void }) {
  const open = useOpen()
  const s = d.supMap.get(id)
  const go = (fn: () => void) => () => { onClose(); fn() }
  const data = useMemo(() => {
    const recs = d.receipts.filter((r) => r.supplierId === id).sort((a, b) => b.date.localeCompare(a.date))
    return {
      recs, balance: recs.reduce((a, r) => a + Math.max(0, receiptBalance(r, d.ledger)), 0),
      pos: d.purchaseOrders.filter((o) => o.supplierId === id).sort((a, b) => b.date.localeCompare(a.date)),
      pays: d.ledger.filter((l) => l.supplierId === id && (l.kind === 'pago_proveedor' || l.kind === 'reembolso_proveedor')).sort((a, b) => b.at.localeCompare(a.at)),
      prods: d.supplierProducts.filter((x) => x.supplierId === id).map((x) => ({ ...x, name: d.prodMap.get(x.productId)?.name ?? '—', sku: d.prodMap.get(x.productId)?.sku ?? '' })).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    }
  }, [d, id])
  if (!s) return <Sheet title="Proveedor" onClose={onClose}><Empty title="El proveedor ya no existe" /></Sheet>
  const { recs, balance, pos, pays, prods } = data
  const bought = recs.reduce((a, r) => a + r.totalCents, 0)
  return (
    <Sheet title={s.name} wide onClose={onClose} footer={<>
      {d.can('compras.editar') && <button className="btn" onClick={go(() => open({ k: 'supplier', v: s }))}>Editar</button>}
      {d.can('compras.editar') && s.active && <button className="btn" onClick={go(() => open({ k: 'purchase', supplierId: id }))}>Nueva orden</button>}
      {balance > 0 && d.can('pagos_proveedor.registrar') && <button className="btn primary" onClick={go(() => open({ k: 'supplierpay', supplierId: id }))}>Pagar</button>}
      <button className="btn" onClick={onClose}>Cerrar</button>
    </>}>
      <div className="stack-lg">
        <div className="row wrap"><Badge tone={s.active ? 'ok' : ''}>{s.active ? 'Activo' : 'Inactivo'}</Badge>{balance > 0 ? <Badge tone="warn">Saldo pendiente {formatMXN(balance)}</Badge> : <Badge tone="ok">Sin saldo pendiente</Badge>}</div>
        <Sec title="Contacto y condiciones">
          <Dl>
            <Di k="Contacto">{s.contact || '—'}</Di>
            <Di k="Teléfono">{s.phone ? <a href={`tel:${s.phone}`}>{s.phone}</a> : '—'}</Di>
            <Di k="Correo">{s.email ? <a href={`mailto:${s.email}`}>{s.email}</a> : '—'}</Di>
            <Di k="RFC">{s.taxId || '—'}</Di>
            <Di k="Condiciones de pago">{s.paymentTermsDays > 0 ? `Crédito de ${s.paymentTermsDays} días` : 'Contado'}</Di>
            <Di k="Plazo de entrega">{s.leadDays} día(s)</Di>
            {s.address && <Di k="Dirección" wide>{s.address}</Di>}
            {s.notes && <Di k="Notas" wide>{s.notes}</Di>}
          </Dl>
        </Sec>
        <Sec title="Cuenta">
          <Dl><Di k="Saldo pendiente"><span className="num">{formatMXN(balance)}</span></Di><Di k="Recibido en total (con IVA)"><span className="num">{formatMXN(bought)}</span></Di><Di k="Órdenes / recepciones">{pos.length} / {recs.length}</Di></Dl>
        </Sec>
        <Sec title="Productos que suministra">
          {prods.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Producto</th><th>SKU proveedor</th><th className="r">Último costo</th><th>Actualizado</th></tr></thead>
              <tbody>{prods.map((p) => <tr key={p.id}><td>{p.name} <span className="stk-sub stk-mono">{p.sku}</span></td><td>{p.supplierSku || '—'}</td><td className="r num">{formatMXN(p.lastCostCents)}</td><td>{fmtDate(p.updatedAt)}</td></tr>)}</tbody></table></div>
          ) : <div className="small muted">Aún no se le ha comprado nada: los productos aparecen al recibir una compra.</div>}
        </Sec>
        <Sec title="Historial de compras">
          {pos.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Orden</th><th>Fecha</th><th>Estado</th><th className="r">Total estimado</th></tr></thead>
              <tbody>{pos.slice(0, 15).map((o) => <tr key={o.id}><td>{o.folio}</td><td>{fmtDate(o.date)}</td><td><Badge tone={PO_TONE[o.status]}>{PO_LABEL[o.status]}</Badge></td><td className="r num">{formatMXN(poTotals(o).total)}</td></tr>)}</tbody></table></div>
          ) : <div className="small muted">Sin órdenes de compra.</div>}
        </Sec>
        <Sec title="Recepciones y saldo">
          {recs.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Recepción</th><th>Fecha</th><th>Vence</th><th className="r">Total</th><th className="r">Saldo</th></tr></thead>
              <tbody>{recs.slice(0, 15).map((r) => { const st = payState(r, d.ledger, d.today); return <tr key={r.id}><td>{r.folio}</td><td>{fmtDate(r.date)}</td><td>{fmtDate(r.dueDate)} {st.late && <Badge tone="bad">Vencida</Badge>}</td><td className="r num">{formatMXN(r.totalCents)}</td><td className="r num">{formatMXN(st.balance)}</td></tr> })}</tbody></table></div>
          ) : <div className="small muted">Sin recepciones.</div>}
        </Sec>
        <Sec title="Pagos efectuados">
          {pays.length ? (
            <div className="stk-scroll"><table className="stk-mini"><thead><tr><th>Fecha</th><th>Método</th><th>Referencia</th><th className="r">Importe</th></tr></thead>
              <tbody>{pays.slice(0, 15).map((l) => <tr key={l.id}><td>{fmtDate(l.date)}</td><td>{d.settings.paymentMethods.find((m) => m.id === l.methodId)?.name ?? '—'}</td><td>{l.reference || '—'}</td><td className="r num">{l.direction === 'out' ? '' : '−'}{formatMXN(l.amountCents)}</td></tr>)}</tbody></table></div>
          ) : <div className="small muted">Sin pagos registrados.</div>}
        </Sec>
      </div>
    </Sheet>
  )
}
