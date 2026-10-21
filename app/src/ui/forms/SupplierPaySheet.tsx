import { useMemo, useState } from 'react'
import '../css/stock.css'
import { receiptBalance } from '../../domain/finance'
import { formatMXN } from '../../domain/money'
import { paySupplier } from '../../services/purchasing'
import { fmtDate, type Data } from '../data'
import { useCtx } from '../session'
import { Badge, Field, MoneyInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

export function SupplierPaySheet({ data: d, supplierId, receiptId, onClose }: { data: Data; supplierId?: string; receiptId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const rc0 = receiptId ? d.receipts.find((r) => r.id === receiptId) : undefined
  const [sid, setSid] = useState(supplierId ?? rc0?.supplierId ?? '')
  const bal = (r: (typeof d.receipts)[number]) => receiptBalance(r, d.ledger)
  const owed = useMemo(() => d.receipts.filter((r) => receiptBalance(r, d.ledger) > 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [d.receipts, d.ledger])
  const mine = owed.filter((r) => r.supplierId === sid)
  const cashOpen = d.cashSessions.some((c) => c.status === 'abierta')
  const methods = d.settings.paymentMethods
  const [method, setMethod] = useState(() => (cashOpen ? methods[0] : methods.find((m) => m.account === 'banco') ?? methods[0])?.id ?? '')
  const [sel, setSel] = useState<Record<string, number | undefined>>(() => (rc0 && receiptBalance(rc0, d.ledger) > 0 ? { [rc0.id]: receiptBalance(rc0, d.ledger) } : {}))
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(d.today)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const m = methods.find((x) => x.id === method)
  const noCash = m?.account === 'caja' && !cashOpen
  const supBal = (id: string) => owed.filter((r) => r.supplierId === id).reduce((a, r) => a + bal(r), 0)
  const suppliers = [...d.suppliers].filter((s) => s.active || supBal(s.id) > 0 || s.id === sid).sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const picked = mine.filter((r) => r.id in sel)
  const total = picked.reduce((a, r) => a + (sel[r.id] ?? 0), 0)
  const docErr = (r: (typeof mine)[number]) => { const v = sel[r.id]; return v === undefined || v <= 0 ? 'Indica el importe a pagar.' : v > bal(r) ? `No puede ser mayor al saldo (${formatMXN(bal(r))}).` : undefined }
  const err = { sid: !sid ? 'Elige el proveedor.' : undefined, docs: !picked.length ? 'Marca al menos un documento por pagar.' : picked.some((r) => docErr(r)) ? 'Corrige los importes marcados.' : undefined, method: !method ? 'Elige el método de pago.' : undefined }
  const hasErr = Object.values(err).some(Boolean)

  const toggle = (r: (typeof mine)[number], on: boolean) => setSel((x) => { const n = { ...x }; if (on) n[r.id] = bal(r); else delete n[r.id]; return n })
  const save = () => guard(async () => {
    setTried(true)
    if (hasErr) { ui.toast(err.sid ?? err.docs ?? err.method ?? 'Revisa los datos del pago.', true); return }
    if (noCash) { ui.toast('Abre la caja antes de pagar en efectivo, o elige otro método de pago.', true); return }
    const r = await ui.run(() => paySupplier(ctx, { supplierId: sid, allocations: picked.map((x) => ({ receiptId: x.id, amountCents: sel[x.id] as number })), methodId: method, reference: ref, date, note }, opKey), `Pago registrado: ${formatMXN(total)} a ${d.supMap.get(sid)?.name ?? 'proveedor'}`)
    if (r) onClose()
  })
  return (
    <Sheet title="Pagar a proveedor" wide onClose={onClose} footer={<>
      <span className="grow" style={{ alignSelf: 'center' }}>Total a pagar: <b className="num">{formatMXN(total)}</b></span>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy || noCash} onClick={save}>Registrar pago</button>
    </>}>
      <div className="stack">
        <Field label="Proveedor *" error={tried ? err.sid : undefined}>
          <select value={sid} onChange={(e) => { setSid(e.target.value); setSel({}) }} disabled={!!supplierId || !!receiptId}>
            <option value="">— Elegir proveedor —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{supBal(s.id) > 0 ? ` · debes ${formatMXN(supBal(s.id))}` : ''}</option>)}
          </select>
        </Field>

        {sid && (
          <section className="stack"><div className="row between wrap"><h3>Documentos por pagar</h3>{mine.length > 1 && <button className="btn small ghost" onClick={() => setSel(Object.fromEntries(mine.map((r) => [r.id, bal(r)])))}>Seleccionar todos</button>}</div>
            {!mine.length && <div className="banner ok">Este proveedor no tiene saldo pendiente.</div>}
            {tried && err.docs && mine.length > 0 && <div className="err" role="alert">{err.docs}</div>}
            <div>
              {mine.map((r) => {
                const on = r.id in sel, e = tried && on ? docErr(r) : undefined
                const late = r.dueDate < d.today
                return (
                  <div key={r.id} className="stk-pay">
                    <input type="checkbox" checked={on} onChange={(ev) => toggle(r, ev.target.checked)} aria-label={`Pagar ${r.folio}`} />
                    <div>
                      <div className="row between wrap"><b>{r.folio}</b><span className="num">Saldo <b>{formatMXN(bal(r))}</b></span></div>
                      <div className="small muted">{d.purchaseOrders.find((o) => o.id === r.purchaseOrderId)?.folio ?? 'Orden'} · {r.invoiceRef ? `Factura ${r.invoiceRef}` : 'Sin factura registrada'} · total {formatMXN(r.totalCents)} · vence {fmtDate(r.dueDate)} {late && <Badge tone="bad">Vencida</Badge>}</div>
                    </div>
                    {on && <div className="amt"><Field label="Importe a aplicar" error={e}><MoneyInput cents={sel[r.id]} onChange={(v) => setSel((x) => ({ ...x, [r.id]: v }))} invalid={!!e} /></Field></div>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        <div className="grid">
          <Field label="Método de pago *" error={tried ? err.method : undefined}><select value={method} onChange={(e) => setMethod(e.target.value)}>{methods.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.account === 'caja' ? 'efectivo en caja' : 'banco'})</option>)}</select></Field>
          <Field label="Fecha del pago"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Referencia"><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Folio de transferencia, cheque…" autoComplete="off" /></Field>
        </div>
        {noCash && <div className="banner" role="alert">No hay una caja abierta y este método sale de caja. Abre la caja en «Caja y dinero» o elige otro método (transferencia, tarjeta…).</div>}
        <Field label="Nota"><input value={note} onChange={(e) => setNote(e.target.value)} autoComplete="off" /></Field>
        <div className="small muted">Un pago parcial deja el resto como saldo. Registrar el pago es independiente de recibir la mercancía o registrar la factura.</div>
      </div>
    </Sheet>
  )
}
