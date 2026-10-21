import { useMemo, useState } from 'react'
import { saveCustomer, saveVehicle } from '../../services/customers'
import type { Customer, Vehicle } from '../../domain/types'
import type { Data } from '../data'
import { plateOf } from '../data'
import { useCtx } from '../session'
import { Field, NumInput, useBusy, useUi } from '../ui'
import { digits, norm } from './lib'
import '../css/crm.css'

/** Selector buscable de cliente, con alta rápida (nombre y teléfono) sin salir del formulario. */
export function CustomerPicker({ data, value, onChange, error, label = 'Cliente', autoFocus }: { data: Data; value: string; onChange: (id: string) => void; error?: string; label?: string; autoFocus?: boolean }) {
  const ctx = useCtx(), ui = useUi()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [nf, setNf] = useState({ name: '', phone: '', email: '' })
  const [fresh, setFresh] = useState<Customer | null>(null)
  const [busy, guard] = useBusy()
  const sel = value ? data.custMap.get(value) ?? (fresh?.id === value ? fresh : undefined) : undefined
  const matches = useMemo(() => {
    const t = norm(q.trim()), dq = digits(q)
    const list = data.customers.filter((c) => c.active && (!t || norm(c.name).includes(t) || norm(c.email).includes(t) || norm(c.taxId).includes(t) || (dq.length >= 3 && digits(c.phone).includes(dq))))
    return list.sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 8)
  }, [data.customers, q])
  const canAdd = data.can('clientes.editar')

  if (sel) {
    return (
      <div className="stack-sm">
        <span className="crm-lbl">{label}</span>
        <div className="crm-picked"><div className="grow"><b>{sel.name}</b><div className="small muted">{sel.phone || sel.email || 'Sin datos de contacto'}</div></div><button type="button" className="btn small" onClick={() => { onChange(''); setQ('') }}>Cambiar</button></div>
        {error && <span className="err" role="alert">{error}</span>}
      </div>
    )
  }
  const create = () => guard(async () => {
    const c = await ui.run(() => saveCustomer(ctx, { name: nf.name, phone: nf.phone, email: nf.email, contactPref: 'telefono' }), 'Cliente registrado')
    if (c) { setFresh(c); onChange(c.id); setAdding(false) }
  })
  return (
    <div className="stack-sm">
      <Field label={label} error={error}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono, correo o RFC" autoFocus={autoFocus} autoComplete="off" aria-invalid={!!error || undefined} /></Field>
      {!adding && (
        <div className="crm-results" role="group" aria-label="Clientes encontrados">
          {matches.map((c) => <button key={c.id} type="button" className="item" onClick={() => onChange(c.id)}><div className="grow"><div className="ttl">{c.name}</div><div className="sub">{[c.phone, c.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div></div></button>)}
          {!matches.length && <div className="small muted">{data.customers.length ? 'Ningún cliente coincide.' : 'Aún no hay clientes registrados.'}</div>}
        </div>
      )}
      {canAdd && !adding && <button type="button" className="btn small" onClick={() => { setAdding(true); setNf({ name: q.trim(), phone: '', email: '' }) }}>+ Cliente nuevo</button>}
      {adding && (
        <div className="crm-quick" role="group" aria-label="Alta rápida de cliente">
          <b>Alta rápida de cliente</b>
          <Field label="Nombre o razón social"><input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} autoComplete="off" /></Field>
          <div className="grid2">
            <Field label="Teléfono"><input type="tel" inputMode="tel" value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} autoComplete="off" /></Field>
            <Field label="Correo (opcional)"><input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} autoComplete="off" /></Field>
          </div>
          <div className="row end"><button type="button" className="btn small" onClick={() => setAdding(false)}>Cancelar</button><button type="button" className="btn small primary" disabled={busy || !nf.name.trim()} onClick={create}>Guardar cliente</button></div>
        </div>
      )}
    </div>
  )
}

/** Vehículo del cliente elegido (lista) con alta rápida de uno nuevo. */
export function VehiclePicker({ data, customerId, value, onChange, error, optional, label = 'Vehículo' }: { data: Data; customerId: string; value: string; onChange: (id: string) => void; error?: string; optional?: boolean; label?: string }) {
  const ctx = useCtx(), ui = useUi()
  const [adding, setAdding] = useState(false)
  const [nf, setNf] = useState({ make: '', model: '', year: undefined as number | undefined, plate: '', km: undefined as number | undefined })
  const [fresh, setFresh] = useState<Vehicle | null>(null)
  const [busy, guard] = useBusy()
  const list = useMemo(() => {
    const l = data.vehicles.filter((v) => v.customerId === customerId && (v.active || v.id === value))
    if (fresh && fresh.customerId === customerId && !l.some((v) => v.id === fresh.id)) l.push(fresh)
    return l
  }, [data.vehicles, customerId, value, fresh])
  const canAdd = data.can('vehiculos.editar')
  const create = () => guard(async () => {
    const v = await ui.run(() => saveVehicle(ctx, { customerId, make: nf.make, model: nf.model, year: nf.year, plate: nf.plate, km: nf.km ?? 0 }), 'Vehículo registrado')
    if (v) { setFresh(v); onChange(v.id); setAdding(false); setNf({ make: '', model: '', year: undefined, plate: '', km: undefined }) }
  })
  return (
    <div className="stack-sm">
      <Field label={label} error={error} hint={!customerId ? 'Primero elige al cliente.' : !list.length ? 'Este cliente aún no tiene vehículos registrados.' : undefined}>
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={!customerId} aria-invalid={!!error || undefined}>
          <option value="">{optional ? 'Sin vehículo especificado' : '— Selecciona un vehículo —'}</option>
          {list.map((v) => <option key={v.id} value={v.id}>{plateOf(v)}{v.active ? '' : ' (inactivo)'}</option>)}
        </select>
      </Field>
      {canAdd && customerId && !adding && <button type="button" className="btn small" onClick={() => setAdding(true)}>+ Vehículo nuevo para este cliente</button>}
      {adding && (
        <div className="crm-quick" role="group" aria-label="Alta rápida de vehículo">
          <b>Alta rápida de vehículo</b>
          <div className="grid2">
            <Field label="Marca"><input value={nf.make} onChange={(e) => setNf({ ...nf, make: e.target.value })} autoComplete="off" /></Field>
            <Field label="Modelo"><input value={nf.model} onChange={(e) => setNf({ ...nf, model: e.target.value })} autoComplete="off" /></Field>
            <Field label="Año"><NumInput value={nf.year} onChange={(v) => setNf({ ...nf, year: v })} inputMode="numeric" /></Field>
            <Field label="Placas"><input value={nf.plate} onChange={(e) => setNf({ ...nf, plate: e.target.value.toUpperCase() })} autoComplete="off" /></Field>
          </div>
          <Field label="Kilometraje actual"><NumInput value={nf.km} onChange={(v) => setNf({ ...nf, km: v })} inputMode="numeric" /></Field>
          <div className="row end"><button type="button" className="btn small" onClick={() => setAdding(false)}>Cancelar</button><button type="button" className="btn small primary" disabled={busy || !nf.make.trim() || !nf.model.trim()} onClick={create}>Guardar vehículo</button></div>
        </div>
      )}
    </div>
  )
}
