import { useLiveQuery } from 'dexie-react-hooks'
import { formatMXN } from '../../domain/money'
import { STATUS_LABEL } from '../../domain/orders'
import type { AuditLog, OrderStatus, WorkOrder } from '../../domain/types'
import { fmtDateTime, type Data } from '../data'
import { useCtx } from '../session'
import { Badge } from '../ui'
import { VIA_LABEL } from './helpers'

const LABEL: Record<string, string> = {
  'orden.creada': 'Orden creada', 'orden.cambio_estado': 'Cambio de estado', 'orden.autorizacion': 'Autorización registrada', 'orden.partidas_rechazadas': 'Partidas rechazadas',
  'orden.partida_modificada': 'Partida modificada', 'orden.partida_eliminada': 'Partida quitada', 'orden.partida_ejecutada': 'Partida ejecutada', 'orden.devolucion_inventario': 'Devolución al inventario',
  'orden.tiempo_manual': 'Tiempo registrado manualmente', 'orden.entregada': 'Vehículo entregado', 'orden.cancelada': 'Orden cancelada', 'orden.garantia': 'Garantía abierta',
  'orden.mecanico_asignado': 'Mecánico asignado', 'orden.descuento': 'Descuento aplicado', 'venta.emitida': 'Venta emitida', 'pago.registrado': 'Cobro registrado',
}
type Rec = Record<string, unknown>
const st = (v: unknown) => (typeof v === 'string' && v in STATUS_LABEL ? STATUS_LABEL[v as OrderStatus] : String(v ?? '—'))
const money = (v: unknown) => (typeof v === 'number' ? formatMXN(v) : '—')

function detail(a: AuditLog, name: (id?: string) => string): string {
  const b = (a.before ?? {}) as Rec, f = (a.after ?? {}) as Rec
  switch (a.action) {
    case 'orden.cambio_estado': return `${st(b.status)} → ${st(f.status)}`
    case 'orden.autorizacion': return `Aprobó ${String(f.approvedBy ?? '—')} · ${money(f.amountCents)} · ${VIA_LABEL[f.via as keyof typeof VIA_LABEL] ?? String(f.via ?? '')} · ${String(f.partidas ?? '')} partida(s)`
    case 'orden.partida_modificada': return `${String(b.partida ?? '')}: cantidad ${String(b.qty ?? '')} → ${String(f.qty ?? '')}, precio ${money(b.unitPriceCents)} → ${money(f.unitPriceCents)}${b.status !== f.status ? `, estado ${String(b.status)} → ${String(f.status)}` : ''}`
    case 'orden.partida_eliminada': return `${String(b.partida ?? '')} (${String(b.status ?? '')}) por ${money(b.totalCents)}`
    case 'orden.partida_ejecutada': return `${String(f.partida ?? '')}${typeof f.costCents === 'number' && f.costCents > 0 ? ` · costo ${formatMXN(f.costCents)}` : ''}`
    case 'orden.devolucion_inventario': return `${String(f.partida ?? '')} · ${String(f.qty ?? '')} pza`
    case 'orden.tiempo_manual': return `${name(f.employeeId as string)} · ${String(f.minutes ?? '')} min`
    case 'orden.mecanico_asignado': return `${name(b.mechanicId as string)} → ${name(f.mechanicId as string)}`
    case 'orden.descuento': return `${String(f.partida ?? '')} · ${money(f.descuentoCents)}`
    case 'orden.entregada': return `Venta por ${money(f.totalCents)}`
    case 'orden.garantia': return `Garantía de ${String(f.original ?? '')} → ${String(f.folio ?? '')}`
    case 'venta.emitida': return `${String(f.folio ?? '')} · total ${money(f.totalCents)}`
    case 'pago.registrado': return money(f.amountCents)
    default: return ''
  }
}

export function HistorialTab({ data, order }: { data: Data; order: WorkOrder }) {
  const ctx = useCtx()
  const canAudit = data.can('auditoria.ver')
  const users = useLiveQuery(async () => new Map((await ctx.db.users.toArray()).map((u) => [u.id, u.name])), [ctx.db]) ?? new Map<string, string>()
  const ids = order.saleId ? [order.id, order.saleId] : [order.id]
  const events = useLiveQuery(async () => (canAudit ? (await ctx.db.audit.where('entityId').anyOf(ids).toArray()).sort((a, b) => b.at.localeCompare(a.at)) : []), [ctx.db, canAudit, ids.join(',')]) ?? []
  const who = (id: string) => users.get(id) ?? 'Usuario'
  const emp = (id?: string) => (id ? data.empMap.get(id)?.name ?? '—' : 'Sin asignar')
  const hist = [...order.statusHistory].reverse()

  return (
    <div className="cols2">
      <section className="card stack" aria-label="Cambios de estado">
        <h3>Cambios de estado</h3>
        <ol className="tl">
          {hist.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <div><b>{STATUS_LABEL[h.to]}</b>{h.from && <span className="muted"> · desde {STATUS_LABEL[h.from]}</span>}</div>
              <div className="small muted">{fmtDateTime(h.at)} · {who(h.userId)}</div>
              {h.note && <div className="small">{h.note}</div>}
            </li>
          ))}
        </ol>
      </section>
      <section className="card stack" aria-label="Eventos de auditoría">
        <div className="row between wrap"><h3>Bitácora de la orden</h3><Badge>{canAudit ? `${events.length} eventos` : 'Restringida'}</Badge></div>
        {!canAudit && <p className="small muted">Tu rol no tiene acceso a la bitácora de auditoría. Pide al propietario o gerente que la consulte si necesitas revisar quién hizo qué.</p>}
        {canAudit && !events.length && <p className="small muted">Aún no hay eventos registrados.</p>}
        <ol className="tl">
          {events.map((a) => {
            const d = detail(a, emp)
            return (
              <li key={a.id}>
                <div><b>{LABEL[a.action] ?? a.action}</b></div>
                <div className="small muted">{fmtDateTime(a.at)} · {a.userName}</div>
                {d && <div className="small">{d}</div>}
                {a.reason && <div className="small">Motivo: {a.reason}</div>}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}
