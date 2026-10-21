import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer, Vehicle, WorkOrder } from '../../domain/types'
import { createOrder } from '../../services/workorders'
import { useOpen } from '../create'
import { fmtDateTime, plateOf, type Data } from '../data'
import { FUEL_LEVELS, inputToIso, mechanicsOf, PRIORITY_LABEL } from '../orders/helpers'
import { Picker, Section } from '../orders/parts'
import { useCtx } from '../session'
import { Field, NumInput, Sheet, useBusy, useUi } from '../ui'

interface Draft {
  customerId: string; vehicleId: string; km: number | undefined; fuel: string; complaint: string; symptoms: string; inspection: string; damages: string; accessories: string
  mechanicId: string; priority: WorkOrder['priority']; promised: string; notesInternal: string; notesCustomer: string
}
const EMPTY: Draft = { customerId: '', vehicleId: '', km: undefined, fuel: '', complaint: '', symptoms: '', inspection: '', damages: '', accessories: '', mechanicId: '', priority: 'normal', promised: '', notesInternal: '', notesCustomer: '' }

/**
 * Al registrar un cliente o vehículo nuevo la hoja de captura se reemplaza (solo hay una hoja abierta a la vez):
 * se guarda aquí la captura y, al volver a abrir «Nueva orden», se restaura y se elige el registro recién creado.
 */
let stash: { draft: Draft; at: number; atIso: string; wants: 'customer' | 'vehicle' } | null = null
const STASH_TTL = 20 * 60 * 1000

export function OrderForm({ data, customerId, vehicleId, appointmentId, onClose }: { data: Data; customerId?: string; vehicleId?: string; appointmentId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate(), open = useOpen()
  const [busy, guard] = useBusy()
  const [restored] = useState<string | null>(() => (stash && Date.now() - stash.at < STASH_TTL && !customerId && !vehicleId && !appointmentId ? (stash.wants === 'customer' ? 'cliente' : 'vehículo') : null))
  const appt = appointmentId ? data.appointments.find((a) => a.id === appointmentId) : undefined

  const [d, setD] = useState<Draft>(() => {
    const st = stash && Date.now() - stash.at < STASH_TTL && !customerId && !vehicleId && !appointmentId ? stash : null
    if (st) {
      const next = { ...st.draft }
      if (st.wants === 'customer') {
        const c = [...data.customers].filter((x) => x.createdAt >= st.atIso).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (c) { next.customerId = c.id; next.vehicleId = '' }
      } else {
        const v = [...data.vehicles].filter((x) => x.createdAt >= st.atIso && (!next.customerId || x.customerId === next.customerId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        if (v) { next.vehicleId = v.id; next.customerId = v.customerId; next.km = v.km }
      }
      return next
    }
    const veh = vehicleId ? data.vehMap.get(vehicleId) : appt?.vehicleId ? data.vehMap.get(appt.vehicleId) : undefined
    const cust = customerId ?? veh?.customerId ?? appt?.customerId ?? ''
    return { ...EMPTY, customerId: cust, vehicleId: veh && (!cust || veh.customerId === cust) ? veh.id : '', km: veh?.km, complaint: appt?.reason ?? '', mechanicId: appt?.mechanicId ?? '' }
  })
  useEffect(() => {
    stash = null
  }, [])
  const [tried, setTried] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  const customer = d.customerId ? data.custMap.get(d.customerId) : undefined
  const vehicle = d.vehicleId ? data.vehMap.get(d.vehicleId) : undefined
  const vehicles = data.vehicles.filter((v) => v.active && (!d.customerId || v.customerId === d.customerId))
  const mechs = mechanicsOf(data)
  const err = {
    customer: !customer ? 'Elige al cliente.' : '',
    vehicle: !vehicle ? 'Elige el vehículo.' : '',
    complaint: !d.complaint.trim() ? 'Describe el motivo de ingreso.' : '',
    km: d.km === undefined || d.km < 0 ? 'Captura el kilometraje de entrada.' : '',
  }
  const invalid = Object.values(err).some(Boolean)

  const pickCustomer = (c: Customer | undefined) => setD((x) => ({ ...x, customerId: c?.id ?? '', vehicleId: c && x.vehicleId && data.vehMap.get(x.vehicleId)?.customerId === c.id ? x.vehicleId : '' }))
  const pickVehicle = (v: Vehicle | undefined) => setD((x) => ({ ...x, vehicleId: v?.id ?? '', customerId: v ? v.customerId : x.customerId, km: v ? (x.km === undefined || x.km === data.vehMap.get(x.vehicleId)?.km ? v.km : x.km) : x.km }))
  const registerNew = (what: 'customer' | 'vehicle') => {
    stash = { draft: d, at: Date.now(), atIso: new Date().toISOString(), wants: what }
    ui.toast(`Registra el ${what === 'customer' ? 'cliente' : 'vehículo'} y vuelve a «Nueva orden»: se conservará lo que capturaste.`)
    open(what === 'customer' ? { k: 'customer' } : { k: 'vehicle', customerId: d.customerId || undefined })
  }

  const save = () => guard(async () => {
    setTried(true)
    if (invalid) { ui.toast('Revisa los campos marcados.', true); return }
    const o = await ui.run(() => createOrder(ctx, {
      customerId: d.customerId, vehicleId: d.vehicleId, km: d.km!, fuelLevel: d.fuel, complaint: d.complaint, symptoms: d.symptoms, inspection: d.inspection,
      damages: d.damages, accessories: d.accessories, mechanicId: d.mechanicId || undefined, priority: d.priority, promisedAt: inputToIso(d.promised),
      notesInternal: d.notesInternal, notesCustomer: d.notesCustomer, appointmentId: appt?.id,
    }), 'Orden creada')
    if (o) { onClose(); nav(`/ordenes/${o.id}`) }
  })

  return (
    <Sheet title="Nueva orden de trabajo" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>Crear orden</button></>}>
      <div className="stack">
        {restored && <div className="banner info" role="status">Restauramos lo que habías capturado{restored === 'cliente' ? ' y elegimos el cliente que acabas de registrar.' : ' y elegimos el vehículo que acabas de registrar.'} Revísalo antes de crear la orden.</div>}
        {appt && <div className={`banner ${appt.workOrderId ? '' : 'info'}`}>{appt.workOrderId ? 'Esta cita ya se convirtió en otra orden. Si continúas se creará una orden adicional.' : `Orden a partir de la cita del ${fmtDateTime(appt.start)}: se precargó el motivo.`}</div>}

        <Section title="Cliente y vehículo">
          <Picker<Customer> label="Cliente" items={data.customers.filter((c) => c.active)} value={customer} onChange={pickCustomer} error={tried ? err.customer : ''}
            title={(c) => c.name} sub={(c) => c.phone || c.email || 'Sin teléfono'} haystack={(c) => `${c.name} ${c.phone} ${c.email}`} placeholder="Nombre o teléfono del cliente"
            emptyText="No hay clientes con ese dato."
            extra={data.can('clientes.editar') ? <button type="button" className="btn small" onClick={() => registerNew('customer')}>Registrar cliente nuevo</button> : undefined} />
          <Picker<Vehicle> label="Vehículo" items={vehicles} value={vehicle} onChange={pickVehicle} error={tried ? err.vehicle : ''}
            title={(v) => plateOf(v)} sub={(v) => (d.customerId ? v.color || v.version : data.custMap.get(v.customerId)?.name)} haystack={(v) => `${v.plate} ${v.vin} ${v.make} ${v.model} ${data.custMap.get(v.customerId)?.name ?? ''}`}
            placeholder={d.customerId ? 'Placas, marca o modelo' : 'Busca por placas o elige primero al cliente'} minChars={d.customerId ? 0 : 1}
            emptyText={d.customerId ? 'Este cliente no tiene vehículos registrados.' : 'No hay vehículos con ese dato.'}
            extra={data.can('vehiculos.editar') ? <button type="button" className="btn small" onClick={() => registerNew('vehicle')}>Registrar vehículo nuevo{customer ? ` de ${customer.name}` : ''}</button> : undefined} />
        </Section>

        <Section title="Recepción">
          <div className="ord-form-grid">
            <Field label="Kilometraje de entrada" error={tried ? err.km : ''} hint={vehicle ? `Último registrado: ${vehicle.km.toLocaleString('es-MX')} km` : undefined}>
              <NumInput value={d.km} onChange={(v) => set('km', v)} invalid={tried && !!err.km} placeholder="0" />
            </Field>
            <Field label="Nivel de combustible">
              <select value={d.fuel} onChange={(e) => set('fuel', e.target.value)}><option value="">No registrado</option>{FUEL_LEVELS.map((f) => <option key={f}>{f}</option>)}</select>
            </Field>
            <div className="full"><Field label="Motivo de ingreso (lo que pide el cliente)" error={tried ? err.complaint : ''}><textarea value={d.complaint} onChange={(e) => set('complaint', e.target.value)} aria-invalid={tried && !!err.complaint} placeholder="Ej. Ruido al frenar, servicio de 40,000 km…" /></Field></div>
            <div className="full"><Field label="Síntomas (opcional)"><textarea value={d.symptoms} onChange={(e) => set('symptoms', e.target.value)} /></Field></div>
          </div>
        </Section>

        <Section title="Inspección inicial, daños y accesorios" optional>
          <Field label="Inspección inicial"><textarea value={d.inspection} onChange={(e) => set('inspection', e.target.value)} placeholder="Niveles, luces, llantas, fugas visibles…" /></Field>
          <Field label="Daños preexistentes"><textarea value={d.damages} onChange={(e) => set('damages', e.target.value)} placeholder="Rayones, golpes, cristales… (protege al taller y al cliente)" /></Field>
          <Field label="Accesorios y objetos al recibir"><textarea value={d.accessories} onChange={(e) => set('accessories', e.target.value)} placeholder="Llanta de refacción, gato, tapetes, radio…" /></Field>
        </Section>

        <Section title="Asignación y fecha promesa" optional>
          <div className="ord-form-grid">
            <Field label="Mecánico"><select value={d.mechanicId} onChange={(e) => set('mechanicId', e.target.value)}><option value="">Sin asignar</option>{mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            <Field label="Prioridad"><select value={d.priority} onChange={(e) => set('priority', e.target.value as Draft['priority'])}>{(['baja', 'normal', 'alta', 'urgente'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
            <div className="full"><Field label="Fecha y hora promesa de entrega" hint="Opcional. Las órdenes abiertas se marcan como vencidas después de esta fecha."><input type="datetime-local" value={d.promised} onChange={(e) => set('promised', e.target.value)} /></Field></div>
          </div>
        </Section>

        <Section title="Notas" optional>
          <Field label="Notas visibles al cliente" hint="Pueden aparecer en los documentos impresos."><textarea value={d.notesCustomer} onChange={(e) => set('notesCustomer', e.target.value)} /></Field>
          <Field label="Notas internas" hint="Solo para el taller; nunca se imprimen."><textarea value={d.notesInternal} onChange={(e) => set('notesInternal', e.target.value)} /></Field>
        </Section>
      </div>
    </Sheet>
  )
}
