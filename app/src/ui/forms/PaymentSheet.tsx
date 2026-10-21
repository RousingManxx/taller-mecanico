import { useMemo, useState } from 'react'
import { receivables, saleBalance } from '../../domain/finance'
import { formatMXN } from '../../domain/money'
import { orderTotals, STATUS_LABEL } from '../../domain/orders'
import type { LedgerEntry } from '../../domain/types'
import { registerPayment } from '../../services/sales'
import { fmtDate, type Data } from '../data'
import { CashGate, MethodSelect } from '../money/common'
import { isCashMethod } from '../money/helpers'
import { useCtx } from '../session'
import { Field, MoneyInput, Seg, Sheet, useBusy, useOpKey, useUi } from '../ui'

export function PaymentSheet({ data, saleId: saleIdProp, workOrderId, onClose }: { data: Data; saleId?: string; workOrderId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const today = data.today
  // Si la orden ya tiene venta emitida, el cobro se aplica a esa venta.
  const initial = useMemo(() => {
    if (workOrderId) {
      const o = data.orderMap.get(workOrderId)
      const s = o?.saleId ? data.sales.find((x) => x.id === o.saleId && x.status === 'emitida') : undefined
      if (s) return { mode: 'venta' as const, saleId: s.id, orderId: '' }
      return { mode: 'orden' as const, saleId: '', orderId: workOrderId }
    }
    return { mode: 'venta' as const, saleId: saleIdProp ?? '', orderId: '' }
  }, [workOrderId, saleIdProp, data.orderMap, data.sales])
  const [mode, setMode] = useState<'venta' | 'orden'>(initial.mode)
  const [saleId, setSaleId] = useState(initial.saleId)
  const [orderId, setOrderId] = useState(initial.orderId)
  const [q, setQ] = useState('')
  const [amount, setAmount] = useState<number | undefined>(() => {
    const s = initial.saleId ? data.sales.find((x) => x.id === initial.saleId) : undefined
    return s ? Math.max(0, saleBalance(s, data.ledger)) || undefined : undefined
  })
  const [methodId, setMethodId] = useState(data.settings.paymentMethods[0]?.id ?? '')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [done, setDone] = useState<LedgerEntry | null>(null)

  const due = useMemo(() => receivables(data.sales, data.ledger, today), [data.sales, data.ledger, today])
  const pickList = useMemo(() => {
    const t = q.trim().toLowerCase()
    return due.filter((r) => !t || r.folio.toLowerCase().includes(t) || r.party.toLowerCase().includes(t)).slice(0, 30)
  }, [due, q])
  const openOrders = useMemo(() => {
    const t = q.trim().toLowerCase()
    return data.orders.filter((o) => o.status !== 'entregada' && o.status !== 'cancelada' && (!t || o.folio.toLowerCase().includes(t) || (data.custMap.get(o.customerId)?.name ?? '').toLowerCase().includes(t))).slice(0, 30)
  }, [data.orders, data.custMap, q])

  const sale = data.sales.find((s) => s.id === saleId)
  const order = data.orderMap.get(orderId)
  const bal = sale ? saleBalance(sale, data.ledger) : 0
  const advances = order ? data.ledger.reduce((a, l) => (l.workOrderId === order.id && !l.saleId && (l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente') ? a + (l.direction === 'in' ? l.amountCents : -l.amountCents) : a), 0) : 0

  const pickSale = (id: string) => { setSaleId(id); const s = data.sales.find((x) => x.id === id); setAmount(s ? saleBalance(s, data.ledger) || undefined : undefined) }
  const err = mode === 'venta'
    ? (!sale ? undefined : sale.status === 'cancelada' ? 'La venta está cancelada.' : bal <= 0 ? 'Esta venta no tiene saldo pendiente.' : amount !== undefined && amount > bal ? `El cobro no puede superar el saldo pendiente (${formatMXN(bal)}).` : undefined)
    : undefined
  const ready = mode === 'venta' ? !!sale && bal > 0 && !err : !!order
  const valid = ready && amount !== undefined && amount > 0
  const save = () => guard(async () => {
    if (!valid || amount === undefined) { ui.toast(!ready ? 'Elige la venta u orden que se cobra.' : 'El importe debe ser mayor que cero.', true); return }
    const e = await ui.run(() => registerPayment(ctx, { saleId: mode === 'venta' ? saleId : undefined, workOrderId: mode === 'orden' ? orderId : undefined, amountCents: amount, methodId, reference, date, note }, opKey), 'Cobro registrado')
    if (e) setDone(e)
  })

  if (done) return (
    <Sheet title="Cobro registrado" onClose={onClose} footer={<><a className="btn" href={`#/imprimir/comprobante/${done.id}`}>Imprimir comprobante</a><button className="btn primary" onClick={onClose}>Listo</button></>}>
      <div className="stack">
        <div className="banner ok"><b>{formatMXN(done.amountCents)}</b> recibidos por {data.settings.paymentMethods.find((m) => m.id === done.methodId)?.name ?? done.methodId}{done.reference ? ` (ref. ${done.reference})` : ''}.</div>
        {mode === 'venta' && sale && (() => {
          const nb = saleBalance(sale, data.ledger)
          return <p className="muted" style={{ margin: 0 }}>{nb > 0 ? <>Saldo pendiente de {sale.folio}: <b className="num">{formatMXN(nb)}</b>.</> : <>{sale.folio} quedó <b>pagada</b>.</>}</p>
        })()}
        {mode === 'orden' && order && <p className="muted" style={{ margin: 0 }}>Se registró como <b>anticipo</b> de {order.folio}. Queda identificado y se aplicará cuando se emita la venta de la orden.</p>}
      </div>
    </Sheet>
  )

  return (
    <Sheet title="Registrar cobro" onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !valid || !!err} onClick={save}>Registrar cobro</button></>}>
      <div className="stack-lg">
        <div className="stack">
          {!workOrderId && !saleIdProp && <Seg value={mode} options={[['venta', 'Cobrar una venta'], ['orden', 'Anticipo de una orden']]} onChange={(m) => { setMode(m); setQ(''); setAmount(undefined) }} label="Qué se cobra" />}
          {mode === 'venta' ? (
            sale ? (
              <div className="card flat stack">
                <div className="row between"><div><b>{sale.folio}</b> · {sale.customerName}<div className="small muted">Venta del {fmtDate(sale.date)} · vence {fmtDate(sale.dueDate)}</div></div>{!saleIdProp && <button className="btn small ghost" onClick={() => { setSaleId(''); setAmount(undefined) }}>Cambiar</button>}</div>
                <div className="mny-sum">
                  <div className="mny-kv"><span>Total pendiente de cobro</span><b className="num">{formatMXN(bal)}</b></div>
                  <div className="mny-kv"><span>Saldo después de este cobro</span><span className="num">{formatMXN(Math.max(0, bal - (amount ?? 0)))}</span></div>
                </div>
                {!ready && err && <div className="banner">{err}</div>}
              </div>
            ) : (
              <div className="stack">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar venta por folio o cliente" aria-label="Buscar venta con saldo" />
                {pickList.length === 0 ? <div className="banner info">{due.length === 0 ? 'No hay ventas con saldo pendiente.' : 'Sin coincidencias.'}</div> : (
                  <div className="mny-results">{pickList.map((r) => <button key={r.id} className="mny-res" onClick={() => pickSale(r.docId)}><span className="row between"><b>{r.folio} · {r.party}</b><b className="num">{formatMXN(r.balanceCents)}</b></span><span className="small muted">{fmtDate(r.date)} · {r.daysLate > 0 ? `${r.daysLate} día(s) de atraso` : `vence ${fmtDate(r.dueDate)}`}</span></button>)}</div>
                )}
              </div>
            )
          ) : order ? (
            <div className="card flat stack">
              <div className="row between"><div><b>{order.folio}</b> · {data.custMap.get(order.customerId)?.name ?? '—'}<div className="small muted">{STATUS_LABEL[order.status]}</div></div>{!workOrderId && <button className="btn small ghost" onClick={() => setOrderId('')}>Cambiar</button>}</div>
              <div className="mny-sum">
                <div className="mny-kv"><span>Importe actual de la orden (referencia)</span><span className="num">{formatMXN(orderTotals(order, data.settings).totalCents)}</span></div>
                <div className="mny-kv"><span>Anticipos ya recibidos</span><span className="num">{formatMXN(advances)}</span></div>
              </div>
              <div className="small muted">Un anticipo es dinero recibido antes de la venta. No es una venta ni utilidad: queda identificado hasta que la venta de la orden lo absorba.</div>
            </div>
          ) : (
            <div className="stack">
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar orden por folio o cliente" aria-label="Buscar orden abierta" />
              {openOrders.length === 0 ? <div className="banner info">No hay órdenes abiertas.</div> : (
                <div className="mny-results">{openOrders.map((o) => <button key={o.id} className="mny-res" onClick={() => setOrderId(o.id)}><b>{o.folio} · {data.custMap.get(o.customerId)?.name ?? '—'}</b><span className="small muted">{STATUS_LABEL[o.status]}</span></button>)}</div>
              )}
            </div>
          )}
        </div>

        {ready && (
          <div className="stack">
            <h3>Datos del cobro</h3>
            <div className="grid2">
              <Field label="Importe" error={err}><MoneyInput cents={amount} onChange={setAmount} invalid={!!err} aria-label="Importe del cobro" /></Field>
              <MethodSelect data={data} value={methodId} onChange={setMethodId} />
            </div>
            {mode === 'venta' && bal > 0 && amount !== undefined && amount > 0 && amount < bal && <div className="small muted">Cobro parcial: el resto ({formatMXN(bal - amount)}) seguirá por cobrar.</div>}
            <CashGate data={data} needed={isCashMethod(data, methodId)} />
            <div className="grid2">
              <Field label="Referencia (opcional)"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Folio de terminal, SPEI…" /></Field>
              <Field label="Fecha del cobro"><input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
            </div>
            <Field label="Nota (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </Sheet>
  )
}
