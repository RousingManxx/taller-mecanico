import { useRef, useState } from 'react'
import type { Vehicle } from '../../domain/types'
import { attachVehiclePhoto, removeVehiclePhoto, saveVehicle } from '../../services/customers'
import { CustomerPicker } from '../crm/pickers'
import { useSubmit } from '../crm/hooks'
import type { Data } from '../data'
import { compressImage, useAttachments } from '../image'
import { useCtx } from '../session'
import { Field, NumInput, Sheet, useBusy, useUi } from '../ui'

const FUEL: [Vehicle['fuel'], string][] = [['', 'No especificado'], ['gasolina', 'Gasolina'], ['diesel', 'Diésel'], ['hibrido', 'Híbrido'], ['electrico', 'Eléctrico'], ['gas', 'Gas']]
const TRANS: [Vehicle['transmission'], string][] = [['', 'No especificada'], ['manual', 'Manual'], ['automatica', 'Automática']]
const VIN = /^[A-HJ-NPR-Z0-9]{11,17}$/

export function VehicleForm({ data, vehicle, customerId, onClose }: { data: Data; vehicle?: Vehicle; customerId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const { busy, error, submit } = useSubmit()
  const [f, setF] = useState({
    customerId: vehicle?.customerId ?? customerId ?? '', make: vehicle?.make ?? '', model: vehicle?.model ?? '', year: vehicle?.year as number | undefined, version: vehicle?.version ?? '',
    plate: vehicle?.plate ?? '', vin: vehicle?.vin ?? '', km: (vehicle ? vehicle.km : undefined) as number | undefined, fuel: vehicle?.fuel ?? '' as Vehicle['fuel'], transmission: vehicle?.transmission ?? '' as Vehicle['transmission'],
    color: vehicle?.color ?? '', engineNo: vehicle?.engineNo ?? '', notes: vehicle?.notes ?? '', active: vehicle?.active ?? true,
  })
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const live = vehicle ? data.vehMap.get(vehicle.id) ?? vehicle : undefined
  const photos = useAttachments(ctx, live?.photoIds ?? [])
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoBusy, photoGuard] = useBusy()

  const plate = f.plate.trim().toUpperCase().replace(/\s+/g, ' '), vin = f.vin.trim().toUpperCase()
  const others = data.vehicles.filter((v) => v.id !== vehicle?.id && v.active)
  const maxYear = Number(data.today.slice(0, 4)) + 1
  const errs = {
    customerId: !f.customerId ? 'Elige al propietario del vehículo.' : '',
    make: !f.make.trim() ? 'La marca es obligatoria.' : '', model: !f.model.trim() ? 'El modelo es obligatorio.' : '',
    id: !plate && !vin ? 'Indica las placas o el VIN del vehículo.' : '',
    plate: plate && others.some((v) => v.plate === plate) ? `Ya existe un vehículo activo con las placas ${plate}.` : '',
    vin: vin && !VIN.test(vin) ? 'El VIN debe tener de 11 a 17 caracteres (sin I, O ni Q).' : vin && others.some((v) => v.vin === vin) ? `Ya existe un vehículo activo con el VIN ${vin}.` : '',
    year: f.year !== undefined && !(Number.isInteger(f.year) && f.year >= 1950 && f.year <= maxYear) ? `El año debe estar entre 1950 y ${maxYear}.` : '',
    km: f.km !== undefined && f.km < 0 ? 'El kilometraje no puede ser negativo.' : '',
  }
  const hasErr = Object.values(errs).some(Boolean)
  const show = (k: keyof typeof errs) => (touched ? errs[k] : '')

  const save = async () => {
    setTouched(true)
    if (hasErr) return
    const r = await submit(() => saveVehicle(ctx, { id: vehicle?.id, customerId: f.customerId, make: f.make, model: f.model, year: f.year, version: f.version, plate: f.plate, vin: f.vin, km: f.km ?? 0, fuel: f.fuel, transmission: f.transmission, color: f.color, engineNo: f.engineNo, notes: f.notes, active: f.active }), vehicle ? 'Vehículo actualizado' : 'Vehículo registrado')
    if (r) onClose()
  }
  const addPhoto = (file?: File) => photoGuard(async () => {
    if (!file || !vehicle) return
    const img = await compressImage(file).catch((e: Error) => { ui.toast(e.message, true); return null })
    if (img) await ui.run(() => attachVehiclePhoto(ctx, vehicle.id, img), 'Foto agregada')
    if (fileRef.current) fileRef.current.value = ''
  })
  const removePhoto = async (id: string) => {
    if (!vehicle || !(await ui.confirm('¿Quitar esta foto del vehículo?', 'Quitar foto', true))) return
    await ui.run(() => removeVehiclePhoto(ctx, vehicle.id, id), 'Foto eliminada')
  }

  return (
    <Sheet title={vehicle ? 'Editar vehículo' : 'Nuevo vehículo'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{vehicle ? 'Guardar cambios' : 'Guardar vehículo'}</button></>}>
      <div className="stack-lg">
        {error && <div className="banner bad" role="alert">{error}</div>}
        <section className="stack" aria-labelledby="vf-prop">
          <h3 id="vf-prop">Propietario</h3>
          <CustomerPicker data={data} value={f.customerId} onChange={(id) => set('customerId', id)} error={show('customerId')} label="Propietario *" autoFocus={!f.customerId} />
        </section>
        <section className="stack" aria-labelledby="vf-datos">
          <h3 id="vf-datos">Datos del vehículo</h3>
          <div className="grid2">
            <Field label="Marca *" error={show('make')}><input value={f.make} onChange={(e) => set('make', e.target.value)} autoComplete="off" aria-invalid={!!show('make') || undefined} /></Field>
            <Field label="Modelo *" error={show('model')}><input value={f.model} onChange={(e) => set('model', e.target.value)} autoComplete="off" aria-invalid={!!show('model') || undefined} /></Field>
            <Field label="Año" error={show('year')}><NumInput value={f.year} onChange={(v) => set('year', v)} inputMode="numeric" invalid={!!show('year')} /></Field>
            <Field label="Versión"><input value={f.version} onChange={(e) => set('version', e.target.value)} autoComplete="off" /></Field>
            <Field label="Placas" error={show('plate') || show('id')}><input value={f.plate} onChange={(e) => set('plate', e.target.value.toUpperCase())} autoComplete="off" aria-invalid={!!(show('plate') || show('id')) || undefined} /></Field>
            <Field label="VIN (número de serie)" error={show('vin')}><input value={f.vin} onChange={(e) => set('vin', e.target.value.toUpperCase())} autoComplete="off" maxLength={17} aria-invalid={!!show('vin') || undefined} /></Field>
            <Field label="Kilometraje actual" error={show('km')}><NumInput value={f.km} onChange={(v) => set('km', v)} inputMode="numeric" invalid={!!show('km')} /></Field>
            <Field label="Color"><input value={f.color} onChange={(e) => set('color', e.target.value)} autoComplete="off" /></Field>
            <Field label="Combustible"><select value={f.fuel} onChange={(e) => set('fuel', e.target.value as Vehicle['fuel'])}>{FUEL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="Transmisión"><select value={f.transmission} onChange={(e) => set('transmission', e.target.value as Vehicle['transmission'])}>{TRANS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
          <Field label="Número de motor"><input value={f.engineNo} onChange={(e) => set('engineNo', e.target.value)} autoComplete="off" /></Field>
          <Field label="Observaciones"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          {vehicle && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Vehículo activo</label>}
        </section>
        <section className="stack" aria-labelledby="vf-fotos">
          <h3 id="vf-fotos">Fotografías</h3>
          {!vehicle && <p className="small muted">Podrás agregar fotos en cuanto guardes el vehículo (abre «Editar» desde su ficha).</p>}
          {vehicle && (
            <>
              <div className="crm-photos">
                {photos.map((p) => (
                  <figure key={p.id} className="crm-photo"><img src={p.dataUrl} alt={`Foto del vehículo: ${p.name}`} loading="lazy" /><button type="button" className="btn small" aria-label={`Quitar foto ${p.name}`} onClick={() => removePhoto(p.id)}>Quitar</button></figure>
                ))}
                {!photos.length && <span className="small muted">Sin fotos todavía.</span>}
              </div>
              <div>
                <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => addPhoto(e.target.files?.[0])} tabIndex={-1} />
                <button type="button" className="btn" disabled={photoBusy} onClick={() => fileRef.current?.click()}>{photoBusy ? 'Guardando foto…' : 'Agregar foto'}</button>
              </div>
              <p className="small muted">Las fotos se reducen automáticamente y se guardan solo en este dispositivo.</p>
            </>
          )}
        </section>
      </div>
    </Sheet>
  )
}
