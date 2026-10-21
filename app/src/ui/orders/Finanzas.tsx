import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { payStatus, PAY_LABEL, saleBalance, salePaid, saleReturnsTotal } from '../../domain/finance'
import { formatMXN, formatPct } from '../../domain/money'
import { billableItems, estimatedLabor, ITEM_TYPE_LABEL, orderEconomics, orderTotals, timeSummary } from '../../domain/orders'
import { marginPct } from '../../domain/pricing'
import type { WorkOrder } from '../../domain/types'
import { useOpen } from '../create'
import { fmtDate, type Data } from '../data'
import { Badge, Empty } from '../ui'
import { advancesOf, fmtDecHours, openWorkEntries, paymentsOf, saleOfOrder, useNow } from './helpers'

const Line = ({ l, why, a, cls, sum }: { l: string; why?: string; a: ReactNode; cls?: string; sum?: boolean }) => (
  <div className={`r ${sum ? 'sum' : ''}`}><span>{l}{why && <span className="why">{why}</span>}</span><span className={`a ${cls ?? ''}`}>{a}</span></div>
)

export function FinanzasTab({ data, order }: { data: Data; order: WorkOrder }) {
  const open = useOpen()
  const s = data.settings
  const money = data.can('ventas.ver'), costs = data.can('costos.ver')
  const now = useNow(15000, openWorkEntries(order).length > 0)
  const ts = timeSummary(order, new Date(now).toISOString())
  const t = orderTotals(order, s)
  const sale = saleOfOrder(data, order)
  const eco = orderEconomics(order, s, ts.laborCostCents, estimatedLabor(order, data.employees, s))
  const cancelled = order.status === 'cancelada'
  const discounts = billableItems(order).reduce((a, i) => a + i.discountCents, 0)
  const pays = paymentsOf(data, order)
  const method = (id: string) => s.paymentMethods.find((m) => m.id === id)?.name ?? 'Método eliminado'
  const adv = advancesOf(data.ledger, order.id)
  const laborEstimated = eco.missing.some((m) => m.startsWith('Sin tiempos'))
  const reasons = [...eco.missing, ...(order.status !== 'entregada' ? ['La orden aún no está entregada: las cifras pueden cambiar.'] : [])]
  const live = sale && sale.status === 'emitida' ? sale : undefined

  if (!money && !costs) return <Empty title="Sin acceso a finanzas" text="Tu rol no puede ver importes ni costos de la orden." />
  if (cancelled) {
    return (
      <div className="stack-lg">
        <div className="banner bad">La orden está cancelada: no genera venta ni utilidad. Las refacciones consumidas regresaron al inventario con su costo original.</div>
        {money && pays.length > 0 && <PaymentsCard pays={pays} method={method} />}
      </div>
    )
  }

  return (
    <div className="stack-lg">
      {order.isWarranty && <div className="banner info">Orden de garantía: el cliente no paga. Todo lo que se consuma aquí es costo del taller (utilidad negativa) y se mide como costo de garantía.</div>}
      <div className="cols2">
        {money && (
          <section className="card stack" aria-label="Venta y cobros">
            <h3>Venta y cobros</h3>
            <div className="ord-fin">
              {(['servicio', 'refaccion', 'consumible', 'externo', 'otro'] as const).filter((k) => t.byType[k] !== 0).map((k) => <Line key={k} l={ITEM_TYPE_LABEL[k]} a={formatMXN(t.byType[k])} />)}
              {t.netCents === 0 && <Line l="Sin partidas autorizadas" why="Lo sugerido o cotizado no cuenta como venta hasta que el cliente lo autoriza." a="—" />}
              {discounts > 0 && <Line l="Descuentos ya aplicados" why="Informativo: ya están restados de los importes de arriba." a={formatMXN(discounts)} />}
              <Line sum l="Venta neta" why="Partidas autorizadas y ejecutadas, después de descuentos y antes de IVA." a={formatMXN(t.netCents)} />
              <Line l="IVA" why="Impuesto trasladado de cada partida." a={formatMXN(t.taxCents)} />
              <Line sum l="Total a cobrar" why="Venta neta + IVA." a={formatMXN(t.totalCents)} />
              {t.pendingApprovalCents > 0 && <Line l="Pendiente de aprobación" why="Sugerido o cotizado: no se cobra hasta autorizarse." a={formatMXN(t.pendingApprovalCents)} />}
            </div>
            {live ? (
              <div className="ord-fin">
                <Line l={`Venta ${live.folio}`} why={`Emitida el ${fmtDate(live.date)}. Vender no es cobrar.`} a={<Link to={`/ventas/${live.id}`}>Ver venta</Link>} />
                <Line l="Total de la venta" a={formatMXN(live.totalCents)} />
                {live.returns.length > 0 && <Line l="Devoluciones" why="Notas de crédito sobre la venta." a={`− ${formatMXN(saleReturnsTotal(live))}`} />}
                <Line l="Cobrado" why="Cobros menos reembolsos, incluidos los anticipos de la orden." a={formatMXN(salePaid(live, data.ledger))} cls="pos" />
                <Line sum l="Saldo por cobrar" why={PAY_LABEL[payStatus(live, data.ledger)]} a={formatMXN(saleBalance(live, data.ledger))} cls={saleBalance(live, data.ledger) > 0 ? 'neg' : 'pos'} />
              </div>
            ) : sale ? (
              <div className="banner bad">La venta {sale.folio} está cancelada.</div>
            ) : (
              <div className="ord-fin">
                <Line l="Anticipos recibidos" why="Cobros anotados a la orden antes de emitir la venta." a={formatMXN(adv)} cls="pos" />
                <Line sum l="Saldo estimado" why="Total a cobrar − anticipos. La venta se emite al entregar el vehículo." a={formatMXN(t.totalCents - adv)} />
              </div>
            )}
            {data.can('cobros.registrar') && (!sale || live) && !(live && saleBalance(live, data.ledger) <= 0) && (
              <div><button className="btn primary" onClick={() => open(live ? { k: 'payment', saleId: live.id } : { k: 'payment', workOrderId: order.id })}>{live ? 'Registrar cobro' : 'Registrar anticipo'}</button></div>
            )}
          </section>
        )}

        {costs && (
          <section className="card stack" aria-label="Costos y utilidad">
            <div className="row between wrap"><h3>Costos y utilidad</h3><Badge tone={eco.provisional ? 'warn' : 'ok'}>{eco.provisional ? 'Provisional' : 'Definitivo'}</Badge></div>
            <div className="ord-fin">
              <Line l="Venta neta" why="Antes de IVA. Es la base del margen." a={formatMXN(eco.netCents)} />
              <Line l="Refacciones consumidas" why="Costo de salida del inventario (promedio ponderado) de lo consumido en la orden." a={formatMXN(eco.partsCostCents)} />
              <Line l="Mano de obra" why={laborEstimated ? 'Estimada con el tiempo estándar: aún no hay tiempos reales.' : `${fmtDecHours(ts.workMinutes)} efectivas × costo por hora de cada mecánico (sueldo + carga ÷ horas productivas).`} a={formatMXN(eco.laborCostCents)} />
              <Line l="Consumibles y otros cargos" why="Costo de consumibles consumidos del inventario y otros cargos con costo capturado." a={formatMXN(eco.consumableCostCents)} />
              <Line l="Servicios externos" why="Costo real capturado al ejecutar cada servicio externo." a={formatMXN(eco.externalCostCents)} />
              <Line sum l="Costo directo total" a={formatMXN(eco.directCostCents)} />
              <Line sum l="Utilidad bruta" why="Venta neta − costo directo." a={formatMXN(eco.profitCents)} cls={eco.profitCents < 0 ? 'neg' : 'pos'} />
              <Line sum l="Margen" why="Utilidad ÷ venta neta (no es markup). n/c si no hay venta." a={formatPct(eco.marginPct)} cls={eco.profitCents < 0 ? 'neg' : ''} />
            </div>
            {reasons.length > 0 && <div className="banner" role="status"><b>Resultado provisional.</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{reasons.map((m) => <li key={m}>{m}</li>)}</ul></div>}
            {live && <p className="small muted">Costo congelado en la venta {live.folio}: <b>{formatMXN(live.costCents)}</b> · Margen de la venta: <b>{formatPct(marginPct(live.netCents, live.costCents))}</b>. Es el costo al momento de entregar; no cambia después.</p>}
            <p className="small muted">Los gastos generales del taller (renta, luz, sueldos administrativos) no están aquí: esto es utilidad bruta de la reparación. El resultado del negocio se ve en Rentabilidad.</p>
          </section>
        )}
      </div>

      {money && <PaymentsCard pays={pays} method={method} />}
    </div>
  )
}

function PaymentsCard({ pays, method }: { pays: ReturnType<typeof paymentsOf>; method: (id: string) => string }) {
  return (
    <section className="card stack-sm" aria-label="Cobros registrados">
      <h3>Cobros y anticipos registrados</h3>
      {!pays.length && <p className="small muted">Todavía no hay cobros ni anticipos para esta orden.</p>}
      {pays.map((l) => (
        <div key={l.id} className="row between wrap" style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
          <div><div><b>{l.kind === 'cobro_cliente' ? (l.saleId ? 'Cobro' : 'Anticipo') : 'Reembolso'}</b> · {method(l.methodId)}{l.reference && ` · ${l.reference}`}</div><div className="small muted">{fmtDate(l.date)}{l.note && ` · ${l.note}`}</div></div>
          <div className="row" style={{ gap: 10 }}><b className={`num ${l.direction === 'in' ? 'pos' : 'neg'}`}>{l.direction === 'in' ? '+' : '−'} {formatMXN(l.amountCents)}</b><a className="btn small" href={`#/imprimir/comprobante/${l.id}`} target="_blank" rel="noopener">Comprobante</a></div>
        </div>
      ))}
    </section>
  )
}
