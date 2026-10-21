import { useState } from 'react'
import type { Supplier } from '../../domain/types'
import { saveSupplier } from '../../services/purchasing'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Field, NumInput, Sheet, useBusy, useUi } from '../ui'

export function SupplierForm({ data: d, supplier, onClose }: { data: Data; supplier?: Supplier; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [f, setF] = useState({
    name: supplier?.name ?? '', contact: supplier?.contact ?? '', phone: supplier?.phone ?? '', email: supplier?.email ?? '', address: supplier?.address ?? '', taxId: supplier?.taxId ?? '',
    paymentTermsDays: (supplier?.paymentTermsDays ?? 0) as number | undefined, leadDays: (supplier?.leadDays ?? 0) as number | undefined, notes: supplier?.notes ?? '', active: supplier?.active ?? true,
  })
  const [tried, setTried] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const name = f.name.trim()
  const err = {
    name: !name ? 'El nombre del proveedor es obligatorio.' : d.suppliers.some((x) => x.id !== supplier?.id && x.name.toLowerCase() === name.toLowerCase()) ? 'Ya tienes un proveedor con ese nombre.' : undefined,
    email: f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) ? 'El correo no es válido (ejemplo: ventas@proveedor.com).' : undefined,
    terms: (f.paymentTermsDays ?? 0) < 0 ? 'No puede ser negativo.' : undefined,
    lead: (f.leadDays ?? 0) < 0 ? 'No puede ser negativo.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried ? err[k] : undefined)
  const save = () => guard(async () => {
    setTried(true)
    if (hasErr) { ui.toast('Revisa los campos marcados en rojo.', true); return }
    const r = await ui.run(() => saveSupplier(ctx, { id: supplier?.id, name, contact: f.contact, phone: f.phone, email: f.email, address: f.address, taxId: f.taxId, paymentTermsDays: f.paymentTermsDays ?? 0, leadDays: f.leadDays ?? 0, notes: f.notes, active: f.active }), supplier ? 'Proveedor actualizado' : 'Proveedor creado')
    if (r) onClose()
  })
  return (
    <Sheet title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={save}>{supplier ? 'Guardar cambios' : 'Crear proveedor'}</button>
    </>}>
      <div className="stack">
        <Field label="Nombre o razón social *" error={show('name')}><input value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!show('name') || undefined} autoComplete="off" /></Field>
        <div className="grid">
          <Field label="Contacto"><input value={f.contact} onChange={(e) => set('contact', e.target.value)} autoComplete="off" /></Field>
          <Field label="Teléfono"><input value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" autoComplete="off" /></Field>
          <Field label="Correo electrónico" error={show('email')}><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!show('email') || undefined} autoComplete="off" /></Field>
          <Field label="RFC"><input value={f.taxId} onChange={(e) => set('taxId', e.target.value)} autoCapitalize="characters" autoComplete="off" /></Field>
        </div>
        <Field label="Dirección"><textarea value={f.address} onChange={(e) => set('address', e.target.value)} rows={2} /></Field>
        <div className="grid">
          <Field label="Días de crédito" error={show('terms')} hint="0 = pago de contado"><NumInput value={f.paymentTermsDays} onChange={(v) => set('paymentTermsDays', v)} invalid={!!show('terms')} /></Field>
          <Field label="Días de entrega" error={show('lead')} hint="Se usa en la propuesta de compra"><NumInput value={f.leadDays} onChange={(v) => set('leadDays', v)} invalid={!!show('lead')} /></Field>
        </div>
        <Field label="Notas"><textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} /></Field>
        {supplier && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Proveedor activo</label>}
      </div>
    </Sheet>
  )
}
