import { useState } from 'react'
import type { Customer } from '../../domain/types'
import { saveCustomer } from '../../services/customers'
import { useSubmit } from '../crm/hooks'
import { digits } from '../crm/lib'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Field, Sheet } from '../ui'

const PREF: [Customer['contactPref'], string][] = [['telefono', 'Llamada telefónica'], ['whatsapp', 'WhatsApp'], ['correo', 'Correo electrónico'], ['ninguna', 'No contactar']]
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

export function CustomerForm({ customer, onClose }: { data: Data; customer?: Customer; onClose: () => void }) {
  const ctx = useCtx()
  const { busy, error, submit } = useSubmit()
  const [f, setF] = useState({
    name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', address: customer?.address ?? '', contactPref: customer?.contactPref ?? 'telefono' as Customer['contactPref'],
    taxId: customer?.taxId ?? '', fiscalName: customer?.fiscalName ?? '', fiscalAddress: customer?.fiscalAddress ?? '', notes: customer?.notes ?? '', active: customer?.active ?? true,
  })
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const email = f.email.trim(), phone = f.phone.trim(), rfc = f.taxId.trim().toUpperCase()
  const errs = {
    name: !f.name.trim() ? 'El nombre del cliente es obligatorio.' : '',
    email: email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'El correo no es válido (ejemplo: nombre@dominio.com).' : '',
    phone: phone && digits(phone).length < 7 ? 'El teléfono parece incompleto: captura al menos 7 dígitos.' : '',
  }
  const hasErr = !!(errs.name || errs.email || errs.phone)
  const rfcHint = rfc && !RFC.test(rfc) ? 'El RFC no tiene el formato esperado (12 o 13 caracteres). Revísalo antes de facturar.' : undefined
  const save = async () => {
    setTouched(true)
    if (hasErr) return
    const r = await submit(() => saveCustomer(ctx, { id: customer?.id, ...f, active: f.active }), customer ? 'Cliente actualizado' : 'Cliente registrado')
    if (r) onClose()
  }
  return (
    <Sheet title={customer ? 'Editar cliente' : 'Nuevo cliente'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy} onClick={save}>{customer ? 'Guardar cambios' : 'Guardar cliente'}</button></>}>
      <div className="stack-lg">
        {error && <div className="banner bad" role="alert">{error}</div>}
        <section className="stack" aria-labelledby="cf-contacto">
          <h3 id="cf-contacto">Datos de contacto</h3>
          <Field label="Nombre o razón social *" error={touched ? errs.name : ''}><input value={f.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" aria-invalid={(touched && !!errs.name) || undefined} /></Field>
          <div className="grid2">
            <Field label="Teléfono" error={touched ? errs.phone : ''}><input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="off" aria-invalid={(touched && !!errs.phone) || undefined} /></Field>
            <Field label="Correo electrónico" error={touched ? errs.email : ''}><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="off" aria-invalid={(touched && !!errs.email) || undefined} /></Field>
          </div>
          <Field label="Dirección"><input value={f.address} onChange={(e) => set('address', e.target.value)} autoComplete="off" /></Field>
          <Field label="¿Cómo prefiere que lo contactemos?"><select value={f.contactPref} onChange={(e) => set('contactPref', e.target.value as Customer['contactPref'])}>{PREF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        </section>
        <section className="stack" aria-labelledby="cf-fiscal">
          <h3 id="cf-fiscal">Datos fiscales (opcionales)</h3>
          <div className="grid2">
            <Field label="RFC" hint={rfcHint}><input value={f.taxId} onChange={(e) => set('taxId', e.target.value.toUpperCase())} autoComplete="off" maxLength={13} /></Field>
            <Field label="Razón social fiscal"><input value={f.fiscalName} onChange={(e) => set('fiscalName', e.target.value)} autoComplete="off" /></Field>
          </div>
          <Field label="Domicilio fiscal"><input value={f.fiscalAddress} onChange={(e) => set('fiscalAddress', e.target.value)} autoComplete="off" /></Field>
        </section>
        <section className="stack" aria-labelledby="cf-notas">
          <h3 id="cf-notas">Observaciones internas</h3>
          <Field label="Notas" hint="Solo las ve el personal del taller. Nunca salen en cotizaciones, órdenes ni documentos para el cliente."><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          {customer && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Cliente activo (los inactivos no aparecen al elegir cliente en formularios nuevos)</label>}
        </section>
      </div>
    </Sheet>
  )
}
