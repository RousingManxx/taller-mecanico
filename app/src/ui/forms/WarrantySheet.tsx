import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { diffDays } from '../../domain/dates'
import { createWarrantyOrder } from '../../services/workorders'
import { fmtDate, plateOf, type Data } from '../data'
import { useCtx } from '../session'
import { Empty, Field, Sheet, useBusy, useUi } from '../ui'

export function WarrantySheet({ data, orderId, onClose }: { data: Data; orderId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate()
  const [busy, guard] = useBusy()
  const [why, setWhy] = useState('')
  const [tried, setTried] = useState(false)
  const order = data.orderMap.get(orderId)
  if (!order) return <Sheet title="Abrir garantía" onClose={onClose}><Empty title="La orden no existe" /></Sheet>

  const s = data.settings
  const deliveredDay = order.deliveredAt ? order.deliveredAt.slice(0, 10) : undefined
  const days = deliveredDay ? diffDays(deliveredDay, data.today) : undefined
  const expired = days !== undefined && days > s.warrantyDays
  const notDelivered = order.status !== 'entregada'
  const err = !why.trim() ? 'Describe qué falla el cliente.' : ''

  const save = () => guard(async () => {
    setTried(true)
    if (err) return
    const w = await ui.run(() => createWarrantyOrder(ctx, orderId, why), 'Orden de garantía creada')
    if (w) { onClose(); nav(`/ordenes/${w.id}`) }
  })

  return (
    <Sheet title="Abrir garantía" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || notDelivered} onClick={save}>Crear orden de garantía</button></>}>
      <div className="stack">
        <div className="small muted">Orden original {order.folio} · {data.custMap.get(order.customerId)?.name} · {plateOf(data.vehMap.get(order.vehicleId))}</div>
        {notDelivered && <div className="banner bad" role="alert">Solo se puede abrir garantía sobre una orden entregada.</div>}
        {!notDelivered && days !== undefined && (
          <div className={`banner ${expired ? '' : 'ok'}`}>{expired ? `La garantía de ${s.warrantyDays} días venció hace ${days - s.warrantyDays} día(s) (entrega: ${fmtDate(order.deliveredAt)}). Puedes abrirla de todos modos si decides honrarla.` : `Dentro de garantía: ${days} de ${s.warrantyDays} días desde la entrega (${fmtDate(order.deliveredAt)}).`}</div>
        )}
        <Field label="Motivo de la garantía" error={tried ? err : ''}><textarea value={why} onChange={(e) => setWhy(e.target.value)} aria-invalid={tried && !!err} placeholder="Ej. Vuelve el ruido al frenar después de 3 días." /></Field>
        <p className="small muted">Se creará una orden nueva vinculada a {order.folio}, ya autorizada y <b>sin cobro al cliente</b> (precios en $0). Las refacciones y el tiempo que se usen se registran como costo del taller, para saber cuánto cuesta la garantía.</p>
      </div>
    </Sheet>
  )
}
