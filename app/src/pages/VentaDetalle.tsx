import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LEDGER_LABEL, payStatus, saleBalance, salePaid, saleReturnsNet, saleReturnsTotal } from '../domain/finance'
import { formatMXN, formatNum, formatPct, formatQty } from '../domain/money'
import { markupPct, marginPct } from '../domain/pricing'
import { ITEM_TYPE_LABEL } from '../domain/orders'
import type { LedgerEntry, SaleItem } from '../domain/types'
import { cancelSale, voidPayment } from '../services/sales'
import { fmtDate, fmtDateTime, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { PayBadge } from '../ui/money/common'
import { methodName, useUserNames } from '../ui/money/helpers'
import { useCtx } from '../ui/session'
import { Badge, DataTable, Empty, Stat, useBusy, useUi } from '../ui/ui'

export function VentaDetalle({ data }: { data: Data }) {
  const { id } = useParams()
  const ctx = useCtx(), ui = useUi(), open = useOpen(), nav = useNavigate()
  const [busy, guard] = useBusy()
  const userName = useUserNames()
  const sale = data.sales.find((s) => s.id === id)
  const costs = data.can('costos.ver')

  const pays = useMemo(() => {
    if (!sale) return [] as LedgerEntry[]
    return data.ledger.filter((l) => (l.kind === 'cobro_cliente' || l.kind === 'reembolso_cliente') && (l.saleId === sale.id || (!l.saleId && sale.workOrderId && l.workOrderId === sale.workOrderId))).sort((a, b) => a.at.localeCompare(b.at))
  }, [sale, data.ledger])
  const reversed = useMemo(() => new Set(data.ledger.filter((l) => l.reversalOf).map((l) => l.reversalOf as string)), [data.ledger])

  if (!sale) return <Empty title="Venta no encontrada" text="Puede que el enlace sea incorrecto o que la venta ya no exista." action={<Link className="btn primary" to="/ventas">Ir a ventas</Link>} />

  const cust = sale.customerId ? data.custMap.get(sale.customerId) : undefined
  const order = sale.workOrderId ? data.orderMap.get(sale.workOrderId) : undefined
  const status = payStatus(sale, data.ledger)
  const paid = salePaid(sale, data.ledger), bal = saleBalance(sale, data.ledger)
  const retTotal = saleReturnsTotal(sale), retNet = saleReturnsNet(sale)
  const cancelled = sale.status === 'cancelada'
  const emitted = sale.status === 'emitida'
  const hasLeft = sale.items.some((it) => it.qty - sale.returns.filter((r) => r.itemId === it.id).reduce((a, r) => a + r.qty, 0) > 1e-9)
  const retOf = (it: SaleItem) => sale.returns.filter((r) => r.itemId === it.id).reduce((a, r) => a + r.qty, 0)

  // Resumen económico (solo con permiso de costos)
  const costRecovered = sale.returns.reduce((a, r) => a + r.costRecoveredCents, 0)
  const netAfter = sale.netCents - retNet, costAfter = sale.costCents - costRecovered, profit = netAfter - costAfter
  const estLines = sale.items.filter((i) => i.costEstimated)
  const estCents = estLines.reduce((a, i) => a + i.costCents, 0)
  const priorRefunds = data.ledger.some((l) => l.kind === 'reembolso_cliente' && !l.reversalOf && (l.saleId === sale.id))

  const doVoid = (l: LedgerEntry) => guard(async () => {
    const why = await ui.askReason('Anular cobro', 'Motivo de la anulación', 'Anular cobro')
    if (!why) return
    await ui.run(() => voidPayment(ctx, l.id, why), 'Cobro anulado: se registró un movimiento inverso y el original se conserva')
  })
  const doCancel = () => guard(async () => {
    const why = await ui.askReason('Cancelar venta', 'Motivo de la cancelación', 'Cancelar venta')
    if (!why) return
    let refund = false
    if (paid > 0) {
      const ok = await ui.confirm(`La venta tiene cobros netos por ${formatMXN(paid)}. Para cancelarla se reembolsará ese dinero al cliente (un reembolso por cada cobro, con su misma forma de pago; en efectivo se necesita caja abierta).${priorRefunds ? ' Atención: ya hubo reembolsos por devoluciones y el sistema reembolsa cada cobro completo.' : ''}`, 'Cancelar y reembolsar', true)
      if (!ok) return
      refund = true
    } else if (!(await ui.confirm('Se cancelará la venta, se devolverá al inventario lo vendido y no quedará saldo por cobrar. El registro se conserva.', 'Cancelar venta', true))) return
    const r = await ui.run(() => cancelSale(ctx, sale.id, why, { refund }).then(() => true), refund ? 'Venta cancelada y cobros reembolsados' : 'Venta cancelada')
    if (r) nav('/ventas')
  })

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="stack-sm">
          <Link to="/ventas" className="small">‹ Ventas</Link>
          <div className="row wrap"><h1>{sale.folio}</h1><PayBadge status={status} />{cancelled && <Badge tone="bad">Cancelada</Badge>}<Badge>{sale.kind === 'orden' ? 'De orden' : 'Mostrador'}</Badge></div>
          <div className="sub">
            Emitida el {fmtDate(sale.date)} · vence {fmtDate(sale.dueDate)} · Cliente: {cust ? <Link to={`/clientes/${cust.id}`}>{cust.name}</Link> : sale.customerName}
            {sale.workOrderId && <> · Orden: <Link to={`/ordenes/${sale.workOrderId}`}>{order?.folio ?? 'ver orden'}</Link></>}
          </div>
        </div>
        <div className="row wrap">
          {emitted && bal > 0 && data.can('cobros.registrar') && <button className="btn primary" onClick={() => open({ k: 'payment', saleId: sale.id })}>Cobrar</button>}
          {emitted && hasLeft && data.can('ventas.cancelar') && <button className="btn" onClick={() => open({ k: 'return', saleId: sale.id })}>Devolver</button>}
          <a className="btn" href={`#/imprimir/venta/${sale.id}`}>Imprimir</a>
          {emitted && data.can('ventas.cancelar') && <button className="btn danger" disabled={busy} onClick={doCancel}>Cancelar venta</button>}
        </div>
      </div>

      {cancelled && <div className="banner bad"><b>Venta cancelada.</b> Motivo: {sale.cancelReason ?? '—'}. No genera saldo por cobrar; el historial se conserva.</div>}
      {sale.notes && <div className="banner info">Notas: {sale.notes}</div>}

      <div className="mny-main">
        <div className="stack-lg">
          <section className="stack" aria-label="Partidas">
            <h2>Partidas</h2>
            <DataTable
              rows={sale.items} rowKey={(i) => i.id}
              columns={[
                { key: 'd', label: 'Descripción', primary: true, render: (i) => <span>{i.description}<span className="small muted"> · {ITEM_TYPE_LABEL[i.type]}</span></span> },
                { key: 'q', label: 'Cantidad', align: 'r', render: (i) => <>{formatQty(i.qty)} {i.unit}{retOf(i) > 0 && <span className="small muted"> (dev. {formatQty(retOf(i))})</span>}</> },
                { key: 'p', label: 'Precio unit.', align: 'r', render: (i) => formatMXN(i.unitPriceCents) },
                { key: 'disc', label: 'Descuento', align: 'r', render: (i) => (i.discountCents ? formatMXN(i.discountCents) : '—') },
                { key: 'tax', label: 'IVA', align: 'r', render: (i) => <>{formatMXN(i.taxCents)} <span className="small muted">({formatNum(i.taxRate)} %)</span></> },
                { key: 't', label: 'Total', align: 'r', render: (i) => <b>{formatMXN(i.totalCents)}</b> },
                ...(costs ? [
                  { key: 'c', label: 'Costo', align: 'r' as const, render: (i: SaleItem) => <>{formatMXN(i.costCents)}{i.costEstimated && <> <Badge tone="warn">costo estimado</Badge></>}</> },
                  { key: 'u', label: 'Utilidad', align: 'r' as const, render: (i: SaleItem) => <span className={i.netCents - i.costCents < 0 ? 'neg' : ''}>{formatMXN(i.netCents - i.costCents)}</span> },
                  { key: 'm', label: 'Margen', align: 'r' as const, render: (i: SaleItem) => formatPct(marginPct(i.netCents, i.costCents)) },
                  { key: 'k', label: 'Markup', align: 'r' as const, render: (i: SaleItem) => formatPct(markupPct(i.netCents, i.costCents)) },
                ] : []),
              ]}
            />
            {costs && <div className="small muted">Margen = utilidad ÷ venta neta. Markup = utilidad ÷ costo. Utilidad por partida = venta neta (sin IVA) − costo directo.</div>}
          </section>

          <section className="stack" aria-label="Cobros">
            <div className="row between"><h2>Cobros</h2>{emitted && bal > 0 && data.can('cobros.registrar') && <button className="btn small" onClick={() => open({ k: 'payment', saleId: sale.id })}>Registrar cobro</button>}</div>
            {pays.length === 0 ? <div className="banner info">Esta venta no tiene cobros registrados{!cancelled && bal > 0 ? `: ${formatMXN(bal)} por cobrar` : ''}.</div> : (
              <div className="stack">{pays.map((l) => {
                const isRefund = l.kind === 'reembolso_cliente', isVoided = reversed.has(l.id)
                return (
                  <div key={l.id} className="card" style={isVoided ? { opacity: 0.7 } : undefined}>
                    <div className="row between wrap">
                      <div>
                        <b className={`num ${isRefund ? 'neg' : ''}`}>{isRefund ? '−' : ''}{formatMXN(l.amountCents)}</b>{' '}
                        <span className="muted">{LEDGER_LABEL[l.kind]} · {methodName(data, l.methodId)}</span>{' '}
                        {isVoided && <Badge tone="bad">Anulado</Badge>}{l.reversalOf && <Badge>Anulación</Badge>}{!l.saleId && l.workOrderId && <Badge tone="info">Anticipo de la orden</Badge>}
                        <div className="small muted">{fmtDateTime(l.at)} · fecha {fmtDate(l.date)} · {userName(l.userId)}{l.reference ? ` · ref. ${l.reference}` : ''}{l.note ? ` · ${l.note}` : ''}</div>
                      </div>
                      <div className="mny-actions">
                        <a className="btn small" href={`#/imprimir/comprobante/${l.id}`}>Comprobante</a>
                        {l.kind === 'cobro_cliente' && !isVoided && data.can('ventas.cancelar') && <button className="btn small danger" disabled={busy} onClick={() => doVoid(l)}>Anular cobro</button>}
                      </div>
                    </div>
                  </div>
                )
              })}</div>
            )}
            <div className="small muted">Anular un cobro no lo borra: se registra un movimiento inverso (reembolso) y el original se conserva. Anular un cobro en efectivo requiere caja abierta.</div>
          </section>

          {sale.returns.length > 0 && (
            <section className="stack" aria-label="Devoluciones">
              <h2>Devoluciones</h2>
              <div className="stack">{sale.returns.map((r) => {
                const it = sale.items.find((x) => x.id === r.itemId)
                return (
                  <div key={r.id} className="card">
                    <div className="row between wrap"><div><b>{it?.description ?? 'Partida'}</b> · {formatQty(r.qty)} {it?.unit ?? ''}<div className="small muted">{fmtDate(r.date)} · {userName(r.userId)} · Motivo: {r.reason}</div></div>
                      <div style={{ textAlign: 'right' }}><b className="num">{formatMXN(r.netCents + r.taxCents)}</b><div className="small muted">neto {formatMXN(r.netCents)} + IVA {formatMXN(r.taxCents)}</div>{r.movementId && <div className="small muted">Regresó al inventario{costs ? ` al costo ${formatMXN(r.costRecoveredCents)}` : ''}</div>}</div></div>
                  </div>
                )
              })}</div>
            </section>
          )}
        </div>

        <aside className="stack-lg">
          <section className="stack" aria-label="Totales">
            <h2>Totales</h2>
            <div className="mny-sum">
              <div className="mny-kv"><span>Venta neta (sin IVA)</span><span className="num">{formatMXN(sale.netCents)}</span></div>
              <div className="mny-kv"><span>IVA</span><span className="num">{formatMXN(sale.taxCents)}</span></div>
              <div className="mny-kv"><span>Total</span><b className="num">{formatMXN(sale.totalCents)}</b></div>
              <div className="mny-kv"><span>Devoluciones (con IVA)</span><span className="num">− {formatMXN(retTotal)}</span></div>
              <div className="mny-kv"><span>Cobrado (neto de reembolsos)</span><span className="num">− {formatMXN(paid)}</span></div>
              <div className="mny-kv total"><span>Saldo por cobrar</span><span className={`num ${bal > 0 ? 'neg' : ''}`}>{formatMXN(cancelled ? 0 : bal)}</span></div>
            </div>
            {!cancelled && bal < 0 && <div className="banner info">Saldo a favor del cliente: {formatMXN(-bal)} (se cobró más de lo que ahora se debe tras las devoluciones).</div>}
          </section>

          {costs ? (
            <section className="stack" aria-label="Resumen económico">
              <h2>Resumen económico</h2>
              <div className="stack">
                <Stat label="Utilidad bruta" value={formatMXN(profit)} tone={profit < 0 ? 'bad' : undefined} hint={`Margen ${formatPct(marginPct(netAfter, costAfter))} · markup ${formatPct(markupPct(netAfter, costAfter))}`} />
                <div className="mny-sum">
                  <div className="mny-kv"><span>Venta neta{retNet > 0 ? ' (menos devoluciones)' : ''}</span><span className="num">{formatMXN(netAfter)}</span></div>
                  <div className="mny-kv"><span>Costo directo{costRecovered > 0 ? ' (neto de lo recuperado)' : ''}</span><span className="num">− {formatMXN(costAfter)}</span></div>
                  <div className="mny-kv total"><span>Utilidad bruta</span><span className={`num ${profit < 0 ? 'neg' : ''}`}>{formatMXN(profit)}</span></div>
                </div>
                <div className="small muted">
                  Utilidad bruta = venta neta (antes de IVA) − costo directo: costo de salida de inventario de las refacciones, mano de obra imputada de los mecánicos y otros costos directos de la venta{sale.otherCostCents > 0 ? ` (incluye ${formatMXN(sale.otherCostCents)} de otros costos)` : ''}. No incluye gastos generales del taller. La utilidad se reconoce al vender; el dinero entra al cobrar, así que una venta a crédito ya tiene utilidad aunque no haya flujo de efectivo.
                </div>
                {estLines.length > 0 && <div className="banner">{estLines.length} partida(s) usan <b>costo estimado</b> ({formatMXN(estCents)}): no hay costo observado (por ejemplo, sin tiempos reales del mecánico). La utilidad es aproximada.</div>}
                {sale.laborHours > 0 && <div className="small muted">Horas de mano de obra: {formatNum(sale.laborHours)} h.</div>}
              </div>
            </section>
          ) : <div className="small muted">Los costos y márgenes solo los ven usuarios con permiso.</div>}
        </aside>
      </div>
    </div>
  )
}
