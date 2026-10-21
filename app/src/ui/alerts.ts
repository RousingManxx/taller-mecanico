import { costIncreased, productAlertFor } from '../domain/alerts'
import { addDays, diffDays } from '../domain/dates'
import { lossSales, payables, receivables } from '../domain/finance'
import { formatMXN } from '../domain/money'
import type { Data } from './data'

export interface AlertItem { id: string; tone: 'bad' | 'warn' | 'info'; kind: string; title: string; detail: string; to: string }

/** Costo unitario vigente de un producto (centavos, decimal). */
export function unitCostOf(d: Data, productId: string): number {
  const st = d.stock.get(productId)
  if (st && st.qty > 0) return st.valueCents / st.qty
  return d.prodMap.get(productId)?.lastPurchaseCost ?? 0
}

/** Alertas operativas y de rentabilidad. Alimentan la campana, las insignias de navegación y el panel de inicio. */
export function buildAlerts(d: Data): AlertItem[] {
  const out: AlertItem[] = []
  const nowMs = Date.now()
  const canFin = d.can('finanzas.ver'), canCost = d.can('costos.ver')
  if (d.can('inventario.ver')) {
    for (const p of d.products) {
      if (!p.active) continue
      const q = d.stock.get(p.id)?.qty ?? 0
      if (q <= 0) out.push({ id: 'ag' + p.id, tone: 'bad', kind: 'agotado', title: `Agotado: ${p.name}`, detail: `Mínimo ${p.minStock}`, to: '/inventario?f=alertas' })
      else if (q <= p.minStock) out.push({ id: 'sb' + p.id, tone: 'warn', kind: 'stock_bajo', title: `Stock bajo: ${p.name}`, detail: `${q} ${p.unit} (mínimo ${p.minStock})`, to: '/inventario?f=alertas' })
    }
  }
  if (canCost) {
    const bajo: string[] = [], margen: string[] = [], costo: string[] = []
    for (const p of d.products) {
      if (!p.active) continue
      const cost = unitCostOf(d, p.id), a = productAlertFor(p, cost, d.settings)
      if (a.kind === 'bajo_costo') bajo.push(p.name); else if (a.kind === 'margen_bajo') margen.push(p.name)
      if (costIncreased(p.prevPurchaseCost, p.lastPurchaseCost ?? 0) && (a.marginPct ?? 100) < d.settings.targetMarginPct) costo.push(p.name)
    }
    if (bajo.length) out.push({ id: 'pbc', tone: 'bad', kind: 'precio_bajo_costo', title: `${bajo.length} producto(s) con precio por debajo del costo`, detail: bajo.slice(0, 3).join(', '), to: '/inventario?f=margen' })
    if (margen.length) out.push({ id: 'mb', tone: 'warn', kind: 'margen_bajo', title: `${margen.length} producto(s) con margen menor al mínimo`, detail: margen.slice(0, 3).join(', '), to: '/inventario?f=margen' })
    if (costo.length) out.push({ id: 'ca', tone: 'warn', kind: 'costo_aumento', title: `El costo subió y el precio no se actualizó (${costo.length})`, detail: costo.slice(0, 3).join(', '), to: '/inventario?f=margen' })
  }
  if (d.can('ordenes.ver')) {
    for (const o of d.orders) {
      const ref = `${o.folio} · ${d.custMap.get(o.customerId)?.name ?? ''}`
      const last = o.statusHistory[o.statusHistory.length - 1]?.at ?? o.updatedAt
      const hours = (nowMs - new Date(last).getTime()) / 3600000
      if (o.status === 'esperando_refacciones') out.push({ id: 'ep' + o.id, tone: 'warn', kind: 'detenida', title: `Detenida por falta de piezas: ${o.folio}`, detail: ref, to: `/ordenes/${o.id}` })
      if (o.status === 'pendiente_autorizacion' && hours > 24) out.push({ id: 'pa' + o.id, tone: 'warn', kind: 'sin_autorizar', title: `Más de 24 h sin autorización: ${o.folio}`, detail: ref, to: `/ordenes/${o.id}` })
      if (o.status === 'lista_entrega' && hours > 24) out.push({ id: 'le' + o.id, tone: 'info', kind: 'lista', title: `Lista para entrega desde hace ${Math.floor(hours / 24)} día(s): ${o.folio}`, detail: ref, to: `/ordenes/${o.id}` })
    }
  }
  if (d.can('cotizaciones.ver')) {
    const pend = d.quotations.filter((q) => q.status === 'enviada' || q.status === 'vista')
    if (pend.length) out.push({ id: 'qp', tone: 'info', kind: 'cotizaciones', title: `${pend.length} cotización(es) pendiente(s) de aprobación`, detail: pend.slice(0, 3).map((q) => q.folio).join(', '), to: '/cotizaciones' })
  }
  if (canFin || d.can('ventas.ver')) {
    const cxc = receivables(d.sales, d.ledger, d.today).filter((r) => r.daysLate > 0)
    if (cxc.length) out.push({ id: 'cxc', tone: 'bad', kind: 'cxc_vencida', title: `${cxc.length} cuenta(s) por cobrar vencida(s)`, detail: formatMXN(cxc.reduce((a, r) => a + r.balanceCents, 0)), to: '/cobranza' })
  }
  if (d.can('pagos_proveedor.registrar') || canFin || d.can('gastos.ver')) {
    const soon = addDays(d.today, 7)
    const cxp = payables(d.receipts, d.expenses, d.ledger, (id) => d.supMap.get(id ?? '')?.name ?? '—', d.today).filter((r) => r.dueDate <= soon)
    if (cxp.length) out.push({ id: 'cxp', tone: cxp.some((r) => r.daysLate > 0) ? 'bad' : 'warn', kind: 'cxp', title: `${cxp.length} pago(s) a proveedores por vencer o vencidos`, detail: formatMXN(cxp.reduce((a, r) => a + r.balanceCents, 0)), to: '/cobranza?t=pagar' })
  }
  if (d.can('compras.ver')) {
    const late = d.purchaseOrders.filter((p) => (p.status === 'enviada' || p.status === 'parcial') && p.expectedDate && p.expectedDate < d.today)
    if (late.length) out.push({ id: 'cpr', tone: 'warn', kind: 'compra_pendiente', title: `${late.length} compra(s) pendiente(s) de recepción`, detail: late.slice(0, 3).map((p) => p.folio).join(', '), to: '/compras' })
  }
  if (canCost) {
    const loss = lossSales(d.sales, { from: addDays(d.today, -30), to: d.today })
    if (loss.length) out.push({ id: 'loss', tone: 'bad', kind: 'perdida', title: `${loss.length} venta(s) con pérdida en 30 días`, detail: loss.slice(0, 3).map((s) => s.folio).join(', '), to: '/rentabilidad' })
  }
  if (d.can('caja.ver')) {
    const open = d.cashSessions.find((c) => c.status === 'abierta')
    if (open && diffDays(open.openedAt.slice(0, 10), d.today) >= 1) out.push({ id: 'caja', tone: 'warn', kind: 'caja_abierta', title: 'La caja de un día anterior sigue abierta', detail: 'Ciérrala para cuadrar el efectivo', to: '/caja' })
  }
  if (d.can('agenda.ver')) {
    const hoy = d.appointments.filter((a) => a.start.slice(0, 10) === d.today && ['solicitada', 'confirmada'].includes(a.status))
    if (hoy.length) out.push({ id: 'cit', tone: 'info', kind: 'citas', title: `${hoy.length} cita(s) hoy`, detail: 'Revisa la agenda', to: '/agenda' })
  }
  const order = { bad: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}
