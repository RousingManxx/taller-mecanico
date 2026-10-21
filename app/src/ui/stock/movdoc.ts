import type { InventoryMovement, PurchaseReceipt, Sale } from '../../domain/types'
import type { Data } from '../data'

interface Idx { rec: Map<string, PurchaseReceipt>; sale: Map<string, Sale> }
const cache = new WeakMap<Data, Idx>()
const idx = (d: Data): Idx => {
  let i = cache.get(d)
  if (!i) { i = { rec: new Map(d.receipts.map((r) => [r.id, r])), sale: new Map(d.sales.map((s) => [s.id, s])) }; cache.set(d, i) }
  return i
}

/** Documento de origen de un movimiento de inventario, con enlace cuando existe la pantalla. */
export function movementDoc(d: Data, m: InventoryMovement): { label: string; to?: string } {
  switch (m.refType) {
    case 'recepcion': { const r = idx(d).rec.get(m.refId); return r ? { label: `Recepción ${r.folio}`, to: `/compras?t=recepciones&id=${r.id}` } : { label: 'Recepción de compra' } }
    case 'orden': { const o = d.orderMap.get(m.refId); return o ? { label: `Orden ${o.folio}`, to: `/ordenes/${o.id}` } : { label: 'Orden de trabajo' } }
    case 'venta': case 'devolucion': case 'cancelacion_venta': {
      const s = idx(d).sale.get(m.refId)
      const pre = m.refType === 'venta' ? 'Venta' : m.refType === 'devolucion' ? 'Devolución de venta' : 'Cancelación de venta'
      return s ? { label: `${pre} ${s.folio}`, to: `/ventas/${s.id}` } : { label: pre }
    }
    case 'ajuste': return { label: 'Ajuste manual' }
    case 'conteo': return { label: 'Inventario físico' }
    default: return { label: m.refType || '—' }
  }
}
