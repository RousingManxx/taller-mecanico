import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saleBalance } from '../../domain/finance'
import { formatMXN, formatQty } from '../../domain/money'
import { canTransition, orderTotals } from '../../domain/orders'
import type { Sale } from '../../domain/types'
import { deliverOrder } from '../../services/workorders'
import { useOpen } from '../create'
import type { Data } from '../data'
import { advancesOf, isTrackable, printHref, remainingQty } from '../orders/helpers'
import { useCtx } from '../session'
import { Empty, Field, NumInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

const Check = ({ ok, children }: { ok: boolean; children: string }) => <li className="row" style={{ alignItems: 'flex-start', gap: 8 }}><span aria-hidden="true" style={{ fontWeight: 700 }} className={ok ? 'pos' : 'neg'}>{ok ? '✓' : '✗'}</span><span>{children}<span className="sr-only">{ok ? ' (cumplido)' : ' (pendiente)'}</span></span></li>

export function DeliverSheet({ data, orderId, onClose }: { data: Data; orderId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate(), open = useOpen()
  const opKey = useOpKey()
  const [busy, guard] = useBusy()
  const order = data.orderMap.get(orderId)
  const [kmOut, setKmOut] = useState<number | undefined>(() => (order ? Math.max(order.km, data.vehMap.get(order.vehicleId)?.km ?? 0) : undefined))
  const [tested, setTested] = useState(false)
  const [warrantyExplained, setWarrantyExplained] = useState(false)
  const [note, setNote] = useState('')
  const [result, setResult] = useState<Sale>()

  if (!order) return <Sheet title="Entregar vehículo" onClose={onClose}><Empty title="La orden no existe" /></Sheet>

  if (result) {
    const bal = saleBalance(result, data.ledger)
    const money = data.can('ventas.ver')
    return (
      <Sheet title="Vehículo entregado" onClose={onClose} footer={<>
        <a className="btn" href={printHref('entrega', orderId)} target="_blank" rel="noopener">Imprimir entrega</a>
        {money && <button className="btn" onClick={() => { onClose(); nav(`/ventas/${result.id}`) }}>Ver venta</button>}
        {data.can('cobros.registrar') && bal > 0 && <button className="btn primary" onClick={() => open({ k: 'payment', saleId: result.id })}>Registrar cobro</button>}
        {!(data.can('cobros.registrar') && bal > 0) && <button className="btn primary" onClick={onClose}>Listo</button>}
      </>}>
        <div className="stack">
          <div className="banner ok" role="status">La orden {order.folio} quedó entregada y se emitió la venta {result.folio}.</div>
          {money && (
            <div className="card flat ord-totals">
              <div><span>Venta neta (antes de IVA)</span><span className="num">{formatMXN(result.netCents)}</span></div>
              <div><span>IVA</span><span className="num">{formatMXN(result.taxCents)}</span></div>
              <div className="big"><span>Total de la venta</span><span className="num">{formatMXN(result.totalCents)}</span></div>
              <div><span>Saldo pendiente de cobro</span><b className={`num ${bal > 0 ? 'neg' : 'pos'}`}>{bal > 0 ? formatMXN(bal) : 'Pagada'}</b></div>
            </div>
          )}
          <p className="small muted">Vender no es cobrar: la venta ya cuenta como ingreso del periodo y su cobro se registra aparte.</p>
        </div>
      </Sheet>
    )
  }

  const g = canTransition(order, 'entregada')
  const t = orderTotals(order, data.settings)
  const done = order.items.filter((i) => i.status === 'ejecutado' && !isTrackable(i))
  const parts = order.items.filter((i) => isTrackable(i) && (i.status === 'autorizado' || i.status === 'ejecutado'))
  const partsPending = parts.filter((i) => remainingQty(i) > 1e-9)
  const adv = advancesOf(data.ledger, order.id)
  const money = data.can('ventas.ver')
  const kmErr = kmOut === undefined ? 'Captura el kilometraje de salida.' : kmOut < order.km ? `No puede ser menor al de entrada (${order.km.toLocaleString('es-MX')} km).` : ''
  const invalid = !g.ok || !!kmErr || !tested || !warrantyExplained

  const save = () => guard(async () => {
    const r = await ui.run(() => deliverOrder(ctx, orderId, { kmOut, note }, opKey), 'Vehículo entregado')
    if (r) setResult(r.sale)
  })

  return (
    <Sheet title="Entregar vehículo" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || invalid} onClick={save}>Entregar y emitir venta</button></>}>
      <div className="stack">
        <div className="small muted">Orden {order.folio} · {data.custMap.get(order.customerId)?.name} · Al entregar se emite la venta con los costos congelados y la orden se cierra.</div>
        {!g.ok && <div className="banner bad" role="alert">{g.reason}</div>}

        <section className="stack-sm" aria-label="Verificación">
          <h3>Verificación previa</h3>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} className="stack-sm">
            <Check ok={!order.items.some((i) => i.status === 'autorizado' && !isTrackable(i))}>{`Trabajos completados: ${done.length} partida(s) ejecutada(s)${order.items.some((i) => i.status === 'autorizado' && !isTrackable(i)) ? ', hay trabajos autorizados sin ejecutar' : ''}.`}</Check>
            <Check ok={!partsPending.length}>{parts.length ? `Refacciones instaladas: ${parts.length - partsPending.length} de ${parts.length} partida(s) consumida(s) del inventario${partsPending.length ? ` (faltan ${partsPending.map((i) => `${formatQty(remainingQty(i))} de ${i.description}`).join(', ')})` : ''}.` : 'Refacciones instaladas: la orden no tiene refacciones.'}</Check>
          </ul>
          <label className="chk"><input type="checkbox" checked={tested} onChange={(e) => setTested(e.target.checked)} />Se realizaron las pruebas finales y el vehículo quedó funcionando.</label>
        </section>

        <section className="stack-sm" aria-label="Salida">
          <h3>Salida</h3>
          <div className="ord-form-grid">
            <Field label="Kilometraje de salida" error={kmErr} hint={`Entrada: ${order.km.toLocaleString('es-MX')} km`}><NumInput value={kmOut} onChange={setKmOut} invalid={!!kmErr} /></Field>
            <Field label="Nota de entrega (opcional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. Recibió llaves y piezas sustituidas" /></Field>
          </div>
        </section>

        {money && (
          <section className="stack-sm" aria-label="Importes">
            <h3>Importe final y cobros</h3>
            <div className="card flat ord-totals">
              <div><span>Venta neta (antes de IVA)</span><span className="num">{formatMXN(t.netCents)}</span></div>
              <div><span>IVA</span><span className="num">{formatMXN(t.taxCents)}</span></div>
              <div className="big"><span>Importe final</span><span className="num">{formatMXN(t.totalCents)}</span></div>
              <div><span>Pagos recibidos (anticipos)</span><span className="num">{formatMXN(adv)}</span></div>
              <div><span>Saldo pendiente tras la entrega</span><b className={`num ${t.totalCents - adv > 0 ? 'neg' : 'pos'}`}>{t.totalCents - adv > 0 ? formatMXN(t.totalCents - adv) : 'Sin saldo'}</b></div>
            </div>
            {t.pendingApprovalCents > 0 && <div className="banner">Hay {formatMXN(t.pendingApprovalCents)} en partidas sin autorizar que NO se cobrarán.</div>}
            {order.isWarranty && <div className="banner info">Orden de garantía: sin cobro al cliente.</div>}
          </section>
        )}

        <section className="stack-sm" aria-label="Garantía">
          <h3>Condiciones de garantía</h3>
          <div className="card flat small">{data.settings.warrantyDays} días. {data.settings.warrantyText || 'Sin texto de garantía configurado en Ajustes.'}</div>
          <label className="chk"><input type="checkbox" checked={warrantyExplained} onChange={(e) => setWarrantyExplained(e.target.checked)} />Se explicaron al cliente las condiciones de garantía.</label>
        </section>
      </div>
    </Sheet>
  )
}
