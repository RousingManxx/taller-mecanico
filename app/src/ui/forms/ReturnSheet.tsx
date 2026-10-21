import { useMemo, useState } from 'react'
import { saleBalance, salePaid, saleReturnsTotal } from '../../domain/finance'
import { formatMXN, formatQty, round } from '../../domain/money'
import { returnSaleItem } from '../../services/sales'
import type { Data } from '../data'
import { CashGate, MethodSelect } from '../money/common'
import { isCashMethod } from '../money/helpers'
import { useCtx } from '../session'
import { Field, NumInput, Sheet, useBusy, useUi } from '../ui'

export function ReturnSheet({ data, saleId, onClose }: { data: Data; saleId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const sale = data.sales.find((s) => s.id === saleId)
  const items = useMemo(() => (sale ? sale.items.map((it) => ({ it, left: it.qty - sale.returns.filter((r) => r.itemId === it.id).reduce((a, r) => a + r.qty, 0) })).filter((x) => x.left > 1e-9) : []), [sale])
  const [itemId, setItemId] = useState(items[0]?.it.id ?? '')
  const [qty, setQty] = useState<number | undefined>(1)
  const [reason, setReason] = useState('')
  const [refund, setRefund] = useState<boolean | undefined>(undefined)
  const [methodId, setMethodId] = useState(data.settings.paymentMethods[0]?.id ?? '')

  if (!sale) return <Sheet title="Devolución" onClose={onClose}><div className="banner">La venta no existe.</div></Sheet>
  if (sale.status !== 'emitida') return <Sheet title="Devolución" onClose={onClose}><div className="banner">Solo se pueden devolver partidas de ventas emitidas.</div></Sheet>
  if (!items.length) return <Sheet title={`Devolución · ${sale.folio}`} onClose={onClose}><div className="banner info">Todas las partidas de esta venta ya fueron devueltas.</div></Sheet>

  const cur = items.find((x) => x.it.id === itemId) ?? items[0]
  const it = cur.it
  const q = qty ?? 0
  const last = Math.abs(q - cur.left) < 1e-9
  const prior = sale.returns.filter((r) => r.itemId === it.id)
  // Misma proporción que aplica el servicio: la última unidad toma el remanente.
  const net = last ? it.netCents - prior.reduce((a, r) => a + r.netCents, 0) : round((it.netCents * q) / it.qty)
  const tax = last ? it.taxCents - prior.reduce((a, r) => a + r.taxCents, 0) : round((it.taxCents * q) / it.qty)
  const credit = q > 0 ? net + tax : 0
  const paid = salePaid(sale, data.ledger)
  const owed = Math.max(0, paid - (sale.totalCents - saleReturnsTotal(sale) - credit))
  const wantRefund = refund ?? owed > 0
  const inv = !!it.refId && it.movementIds.length > 0 && (it.type === 'refaccion' || it.type === 'consumible')
  const qErr = qty === undefined || qty <= 0 ? 'Indica una cantidad mayor que cero.' : q > cur.left + 1e-9 ? `Solo quedan ${formatQty(cur.left)} por devolver de esta partida.` : undefined
  const valid = !qErr && reason.trim().length > 0
  const save = () => guard(async () => {
    if (!valid) { ui.toast(qErr ?? 'Indica el motivo de la devolución.', true); return }
    const r = await ui.run(() => returnSaleItem(ctx, sale.id, it.id, q, reason, wantRefund && owed > 0 ? { refund: { methodId } } : {}), 'Devolución registrada')
    if (r) onClose()
  })
  return (
    <Sheet title={`Devolución · ${sale.folio}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !valid} onClick={save}>Registrar devolución</button></>}>
      <div className="stack">
        <Field label="Partida a devolver">
          <select value={cur.it.id} onChange={(e) => { setItemId(e.target.value); setQty(1) }}>{items.map((x) => <option key={x.it.id} value={x.it.id}>{x.it.description} (quedan {formatQty(x.left)})</option>)}</select>
        </Field>
        <Field label="Cantidad a devolver" error={qErr}><NumInput value={qty} onChange={setQty} invalid={!!qErr} aria-label="Cantidad a devolver" /></Field>
        <Field label="Motivo de la devolución"><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej. refacción incorrecta, el cliente no la usó…" /></Field>
        <div className="mny-sum">
          <div className="mny-kv"><span>Nota de crédito (sin IVA)</span><span className="num">{formatMXN(net)}</span></div>
          <div className="mny-kv"><span>IVA</span><span className="num">{formatMXN(tax)}</span></div>
          <div className="mny-kv total"><span>Total devuelto</span><span className="num">{formatMXN(credit)}</span></div>
        </div>
        <div className="small muted">{inv ? 'La refacción regresa al inventario al costo con el que salió originalmente, y la utilidad de la venta se ajusta.' : 'Esta partida no mueve inventario (servicio u otro cargo): solo se reduce la venta.'}</div>
        {owed > 0 ? (
          <div className="stack">
            <div className="banner info">El cliente ya pagó {formatMXN(paid)}. Con esta devolución se le deben <b>{formatMXN(owed)}</b>.</div>
            <label className="chk"><input type="checkbox" checked={wantRefund} onChange={(e) => setRefund(e.target.checked)} />Reembolsar ahora {formatMXN(owed)} al cliente</label>
            {wantRefund && <><MethodSelect data={data} value={methodId} onChange={setMethodId} label="Forma de reembolso" /><CashGate data={data} needed={isCashMethod(data, methodId)} /></>}
            {!wantRefund && <div className="small muted">Sin reembolso: la devolución queda como saldo a favor del cliente (no se registra salida de dinero).</div>}
          </div>
        ) : (
          <div className="small muted">Saldo actual de la venta: {formatMXN(saleBalance(sale, data.ledger))}. La devolución lo reduce a {formatMXN(Math.max(0, saleBalance(sale, data.ledger) - credit))}; no hay dinero que reembolsar.</div>
        )}
      </div>
    </Sheet>
  )
}
