import { useState } from 'react'
import { logManualTime } from '../../services/workorders'
import { fmtHours, toLocalInput, type Data } from '../data'
import { isClosed, mechanicsOf, useNow } from '../orders/helpers'
import { useCtx } from '../session'
import { Empty, Field, Sheet, useBusy, useUi } from '../ui'

export function ManualTimeSheet({ data, orderId, onClose }: { data: Data; orderId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const order = data.orderMap.get(orderId)
  const ownOnly = !data.can('ordenes.ver_todas')
  const mechs = mechanicsOf(data).filter((m) => !ownOnly || m.id === ctx.user.employeeId)
  const [emp, setEmp] = useState(() => (ownOnly ? ctx.user.employeeId ?? '' : order?.mechanicId ?? mechs[0]?.id ?? ''))
  const [start, setStart] = useState(() => { const d = new Date(Date.now() - 3600_000); return toLocalInput(d.toISOString()) })
  const [end, setEnd] = useState(() => toLocalInput())
  const [item, setItem] = useState('')
  const [tried, setTried] = useState(false)
  const nowMs = useNow(30000)

  if (!order) return <Sheet title="Registrar tiempo" onClose={onClose}><Empty title="La orden no existe" /></Sheet>
  if (isClosed(order)) return <Sheet title="Registrar tiempo" onClose={onClose}><Empty title="La orden ya no se puede modificar" /></Sheet>

  const a = start ? new Date(start).getTime() : NaN, b = end ? new Date(end).getTime() : NaN
  const minutes = Math.round((b - a) / 60000)
  const errors = {
    emp: !emp ? 'Elige al mecánico.' : '',
    start: !start ? 'Indica la hora de inicio.' : '',
    end: !end ? 'Indica la hora de fin.' : !(a < b) ? 'La hora de fin debe ser posterior a la de inicio.' : b > nowMs + 60000 ? 'No se puede registrar tiempo en el futuro.' : '',
  }
  const invalid = Object.values(errors).some(Boolean)
  const services = order.items.filter((i) => i.type === 'servicio' && i.status !== 'rechazado')

  const save = () => guard(async () => {
    setTried(true)
    if (invalid) return
    const ok = await ui.run(async () => { await logManualTime(ctx, orderId, emp, new Date(start).toISOString(), new Date(end).toISOString(), item || undefined); return true }, 'Tiempo registrado')
    if (ok) onClose()
  })

  return (
    <Sheet title="Registrar tiempo manual" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Registrar tiempo</button></>}>
      <div className="stack">
        <div className="small muted">Orden {order.folio}. Úsalo para tiempo ya trabajado que no se cronometró. No puede traslaparse con otro registro del mismo mecánico.</div>
        <Field label="Mecánico" error={tried ? errors.emp : ''}>
          <select value={emp} onChange={(e) => setEmp(e.target.value)} disabled={ownOnly && mechs.length <= 1}><option value="">Elige…</option>{mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </Field>
        <div className="ord-form-grid">
          <Field label="Inicio" error={tried ? errors.start : ''}><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Fin" error={tried ? errors.end : ''}><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Partida de servicio (opcional)" hint="Liga el tiempo a un trabajo para repartir bien el costo de mano de obra.">
          <select value={item} onChange={(e) => setItem(e.target.value)}><option value="">Trabajo general de la orden</option>{services.map((i) => <option key={i.id} value={i.id}>{i.description}</option>)}</select>
        </Field>
        {minutes > 0 && !errors.end && <div className="card flat" aria-live="polite">Duración a registrar: <b>{fmtHours(minutes)}</b> ({(minutes / 60).toFixed(2)} h de mano de obra)</div>}
      </div>
    </Sheet>
  )
}
