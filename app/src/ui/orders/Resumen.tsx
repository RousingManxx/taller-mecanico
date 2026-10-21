import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { WorkOrder } from '../../domain/types'
import { attachPhoto, removePhoto, updateOrder, type OrderPatch } from '../../services/workorders'
import type { Data } from '../data'
import { fmtDate, fmtDateTime } from '../data'
import { compressImage, useAttachments } from '../image'
import { useCtx } from '../session'
import { Field, NumInput, Sheet, useBusy, useUi } from '../ui'
import { FUEL_LEVELS, inputToIso, isClosed, mechanicsOf, PRIORITY_LABEL, promisedToInput } from './helpers'
import { Row, Section } from './parts'

interface D {
  complaint: string; symptoms: string; inspection: string; diagnosis: string; damages: string; accessories: string; km: number | undefined; fuel: string
  mechanicId: string; priority: WorkOrder['priority']; promised: string; notesInternal: string; notesCustomer: string
}
const toD = (o: WorkOrder): D => ({
  complaint: o.complaint, symptoms: o.symptoms, inspection: o.inspection, diagnosis: o.diagnosis, damages: o.damages, accessories: o.accessories, km: o.km, fuel: o.fuelLevel,
  mechanicId: o.mechanicId ?? '', priority: o.priority, promised: promisedToInput(o.promisedAt), notesInternal: o.notesInternal, notesCustomer: o.notesCustomer,
})
const same = (a: D, b: D) => (Object.keys(a) as (keyof D)[]).every((k) => a[k] === b[k])

export function ResumenTab({ data, order }: { data: Data; order: WorkOrder }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const base = useMemo(() => toD(order), [order])
  const [d, setD] = useState<D>(base)
  const last = useRef(base)
  // Si llegan cambios de la orden y el usuario no ha editado, se refresca; si ya editó, se conservan sus cambios.
  useEffect(() => { if (same(d, last.current)) setD(base); last.current = base }, [base]) // eslint-disable-line react-hooks/exhaustive-deps
  const [tried, setTried] = useState(false)
  const [view, setView] = useState<string>()
  const photos = useAttachments(ctx, order.photoIds)

  const canEdit = data.can('ordenes.editar') && !isClosed(order)
  const canAssign = canEdit && data.can('ordenes.crear')
  const dirty = !same(d, base)
  const set = <K extends keyof D>(k: K, v: D[K]) => setD((x) => ({ ...x, [k]: v }))
  const errComplaint = !d.complaint.trim() ? 'El motivo de ingreso es obligatorio.' : ''
  const errKm = d.km === undefined || d.km < 0 ? 'Captura el kilometraje.' : ''

  const save = () => guard(async () => {
    setTried(true)
    if (errComplaint || errKm) { ui.toast('Revisa los campos marcados.', true); return }
    const p: OrderPatch = {}
    if (d.complaint !== base.complaint) p.complaint = d.complaint
    if (d.symptoms !== base.symptoms) p.symptoms = d.symptoms
    if (d.inspection !== base.inspection) p.inspection = d.inspection
    if (d.diagnosis !== base.diagnosis) p.diagnosis = d.diagnosis
    if (d.damages !== base.damages) p.damages = d.damages
    if (d.accessories !== base.accessories) p.accessories = d.accessories
    if (d.km !== base.km) p.km = d.km
    if (d.fuel !== base.fuel) p.fuelLevel = d.fuel
    if (d.mechanicId !== base.mechanicId) p.mechanicId = d.mechanicId
    if (d.priority !== base.priority) p.priority = d.priority
    if (d.promised !== base.promised) p.promisedAt = inputToIso(d.promised)
    if (d.notesInternal !== base.notesInternal) p.notesInternal = d.notesInternal
    if (d.notesCustomer !== base.notesCustomer) p.notesCustomer = d.notesCustomer
    const r = await ui.run(() => updateOrder(ctx, order.id, p), 'Cambios guardados')
    if (r) setTried(false)
  })

  const onFiles = (files: FileList | null) => guard(async () => {
    if (!files?.length) return
    for (const f of [...files]) {
      await ui.run(async () => { const c = await compressImage(f); return attachPhoto(ctx, order.id, c) }, `«${f.name}» agregado`)
    }
  })
  const dropPhoto = async (id: string, name: string) => {
    if (!(await ui.confirm(`¿Quitar «${name}» de la orden? No se puede deshacer.`, 'Quitar', true))) return
    await ui.run(() => removePhoto(ctx, order.id, id), 'Archivo quitado')
  }

  const quote = order.quotationId ? data.quotations.find((x) => x.id === order.quotationId) : undefined
  const orig = order.warrantyOfOrderId ? data.orderMap.get(order.warrantyOfOrderId) : undefined
  const mechs = mechanicsOf(data)
  const dis = !canEdit
  const shown = photos.find((p) => p.id === view)

  return (
    <div className="stack-lg">
      <div className="card ord-meta">
        <Row l="Recibida">{fmtDateTime(order.receivedAt)}</Row>
        <Row l="Entregada">{order.deliveredAt ? fmtDateTime(order.deliveredAt) : '—'}</Row>
        <Row l="Km de entrada">{order.km.toLocaleString('es-MX')}</Row>
        <Row l="Km de salida">{order.kmOut !== undefined ? order.kmOut.toLocaleString('es-MX') : '—'}</Row>
        <Row l="Cotización de origen">{quote ? (data.can('cotizaciones.ver') ? <Link to={`/cotizaciones/${quote.id}`}>{quote.folio}</Link> : quote.folio) : '—'}</Row>
        {order.isWarranty && <Row l="Garantía de">{orig ? <Link to={`/ordenes/${orig.id}`}>{orig.folio}</Link> : '—'}</Row>}
      </div>

      {dis && <div className="banner info">{isClosed(order) ? 'La orden está cerrada: los datos ya no se pueden editar.' : 'Tu rol no puede editar esta orden.'}</div>}

      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (canEdit && dirty) save() }} aria-label="Datos de la orden">
        <Section title="Recepción">
          <div className="ord-form-grid">
            <Field label="Kilometraje" error={tried ? errKm : ''}><NumInput value={d.km} onChange={(v) => set('km', v)} disabled={dis} invalid={tried && !!errKm} /></Field>
            <Field label="Nivel de combustible"><select value={d.fuel} onChange={(e) => set('fuel', e.target.value)} disabled={dis}><option value="">No registrado</option>{FUEL_LEVELS.concat(d.fuel && !FUEL_LEVELS.includes(d.fuel) ? [d.fuel] : []).map((f) => <option key={f}>{f}</option>)}</select></Field>
            <div className="full"><Field label="Motivo de ingreso" error={tried ? errComplaint : ''}><textarea value={d.complaint} onChange={(e) => set('complaint', e.target.value)} disabled={dis} aria-invalid={tried && !!errComplaint} /></Field></div>
            <div className="full"><Field label="Síntomas"><textarea value={d.symptoms} onChange={(e) => set('symptoms', e.target.value)} disabled={dis} /></Field></div>
          </div>
        </Section>
        <Section title="Inspección y diagnóstico">
          <Field label="Inspección inicial"><textarea value={d.inspection} onChange={(e) => set('inspection', e.target.value)} disabled={dis} /></Field>
          <Field label="Diagnóstico"><textarea value={d.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} disabled={dis} placeholder="Qué se encontró y qué se recomienda hacer" /></Field>
          <Field label="Daños preexistentes"><textarea value={d.damages} onChange={(e) => set('damages', e.target.value)} disabled={dis} /></Field>
          <Field label="Accesorios y objetos al recibir"><textarea value={d.accessories} onChange={(e) => set('accessories', e.target.value)} disabled={dis} /></Field>
        </Section>
        <Section title="Asignación y fecha estimada">
          <div className="ord-form-grid">
            <Field label="Mecánico" hint={canEdit && !canAssign ? 'Solo quien crea órdenes puede reasignar.' : undefined}>
              <select value={d.mechanicId} onChange={(e) => set('mechanicId', e.target.value)} disabled={!canAssign}><option value="">Sin asignar</option>{mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}{d.mechanicId && !mechs.some((m) => m.id === d.mechanicId) && <option value={d.mechanicId}>{data.empMap.get(d.mechanicId)?.name ?? 'Mecánico'}</option>}</select>
            </Field>
            <Field label="Prioridad"><select value={d.priority} onChange={(e) => set('priority', e.target.value as D['priority'])} disabled={dis}>{(['baja', 'normal', 'alta', 'urgente'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
            <div className="full"><Field label="Fecha y hora estimada de entrega"><input type="datetime-local" value={d.promised} onChange={(e) => set('promised', e.target.value)} disabled={dis} /></Field></div>
          </div>
        </Section>
        <Section title="Notas">
          <Field label="Notas visibles al cliente" hint="Pueden aparecer en los documentos impresos."><textarea value={d.notesCustomer} onChange={(e) => set('notesCustomer', e.target.value)} disabled={dis} /></Field>
          <Field label="Notas internas" hint="Solo para el taller; nunca se imprimen."><textarea value={d.notesInternal} onChange={(e) => set('notesInternal', e.target.value)} disabled={dis} /></Field>
        </Section>
        {canEdit && (
          <div className="row end wrap">
            {dirty && <span className="small muted" role="status">Tienes cambios sin guardar.</span>}
            <button type="button" className="btn" disabled={!dirty || busy} onClick={() => { setD(base); setTried(false) }}>Descartar</button>
            <button type="submit" className="btn primary" disabled={!dirty || busy}>Guardar cambios</button>
          </div>
        )}
      </form>

      <section className="stack" aria-label="Fotos y documentos">
        <div className="row between wrap"><h3>Fotos y documentos ({photos.length})</h3>
          {canEdit && <label className="btn small ord-file" style={{ cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.5 : 1 }}>Agregar fotos<input type="file" accept="image/*,application/pdf" multiple disabled={busy} className="sr-only" onChange={(e) => { const f = e.target.files; onFiles(f).finally(() => { e.target.value = '' }) }} /></label>}
        </div>
        {!photos.length && <p className="small muted">Aún no hay fotos. Documenta el estado del vehículo al recibirlo (daños, tablero, kilometraje) para evitar controversias.</p>}
        <div className="ord-thumbs">
          {photos.map((p) => (
            <div key={p.id} className="ord-thumb">
              {p.mime.startsWith('image/')
                ? <button type="button" className="open" onClick={() => setView(p.id)} aria-label={`Ver foto ${p.name}`}><img src={p.dataUrl} alt={p.name} loading="lazy" /></button>
                : <a className="pdf" href={p.dataUrl} download={p.name}>PDF · {p.name}</a>}
              {canEdit && <button type="button" className="btn small danger rm" onClick={() => dropPhoto(p.id, p.name)} aria-label={`Quitar ${p.name}`}>Quitar</button>}
            </div>
          ))}
        </div>
      </section>
      {shown && <Sheet title={shown.name} onClose={() => setView(undefined)} wide><img className="ord-bigimg" src={shown.dataUrl} alt={shown.name} /><p className="small muted center">{fmtDate(shown.createdAt)}</p></Sheet>}
    </div>
  )
}
