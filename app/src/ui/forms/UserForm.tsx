import { useState } from 'react'
import { PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS } from '../../domain/permissions'
import type { RoleId, User } from '../../domain/types'
import { saveUser } from '../../services/auth'
import { useCtx } from '../session'
import type { Data } from '../data'
import { Field, Sheet, useBusy, useUi } from '../ui'

const PERM_LABEL: Record<string, string> = {
  'clientes.ver': 'Ver clientes', 'clientes.editar': 'Editar clientes', 'vehiculos.ver': 'Ver vehículos', 'vehiculos.editar': 'Editar vehículos', 'agenda.ver': 'Ver agenda', 'agenda.editar': 'Editar agenda',
  'ordenes.ver': 'Ver órdenes', 'ordenes.ver_todas': 'Ver todas las órdenes (no solo asignadas)', 'ordenes.crear': 'Crear órdenes', 'ordenes.editar': 'Editar órdenes', 'ordenes.autorizar': 'Autorizar trabajos', 'ordenes.cancelar': 'Cancelar órdenes',
  'ordenes.tiempos': 'Registrar tiempos', 'ordenes.consumir': 'Consumir refacciones en órdenes', 'ordenes.entregar': 'Entregar vehículos', 'cotizaciones.ver': 'Ver cotizaciones', 'cotizaciones.editar': 'Editar cotizaciones',
  'ventas.ver': 'Ver ventas', 'ventas.crear': 'Crear ventas', 'ventas.cancelar': 'Cancelar ventas y devoluciones', 'cobros.registrar': 'Registrar cobros', 'inventario.ver': 'Ver inventario', 'inventario.editar': 'Editar inventario', 'inventario.ajustar': 'Ajustar inventario',
  'costos.ver': 'Ver costos y márgenes', 'precios.editar': 'Cambiar precios', 'precios.aprobar': 'Aprobar propuestas de precio', 'compras.ver': 'Ver compras', 'compras.editar': 'Editar compras', 'compras.recibir': 'Recibir compras', 'pagos_proveedor.registrar': 'Pagar a proveedores',
  'gastos.ver': 'Ver gastos', 'gastos.editar': 'Editar gastos', 'caja.ver': 'Ver caja', 'caja.operar': 'Operar caja', 'caja.cerrar': 'Cerrar caja', 'finanzas.ver': 'Ver finanzas y rentabilidad', 'personal.ver': 'Ver personal', 'personal.editar': 'Editar personal', 'personal.salarios': 'Ver y capturar salarios',
  'usuarios.admin': 'Administrar usuarios', 'config.editar': 'Editar configuración', 'auditoria.ver': 'Ver auditoría', 'respaldo.exportar': 'Exportar respaldos y datos', 'respaldo.restaurar': 'Restaurar respaldos',
}

export function UserForm({ data, user, onClose }: { data: Data; user?: Omit<User, 'pinHash' | 'pinSalt'>; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const [f, setF] = useState({ name: user?.name ?? '', role: (user?.role ?? 'recepcion') as RoleId, pin: '', employeeId: user?.employeeId ?? '', active: user?.active ?? true })
  const [grant, setGrant] = useState<string[]>(user?.grant ?? []), [revoke, setRevoke] = useState<string[]>(user?.revoke ?? [])
  const [adv, setAdv] = useState(false)
  const base = new Set<string>(ROLE_PERMISSIONS[f.role])
  const eff = (p: string) => (grant.includes(p) ? true : revoke.includes(p) ? false : base.has(p))
  const toggle = (p: string) => {
    const on = eff(p)
    if (on) { setGrant(grant.filter((x) => x !== p)); if (base.has(p)) setRevoke([...revoke, p]) } else { setRevoke(revoke.filter((x) => x !== p)); if (!base.has(p)) setGrant([...grant, p]) }
  }
  const save = () => guard(async () => {
    const r = await ui.run(() => saveUser(ctx, { id: user?.id, name: f.name, role: f.role, pin: f.pin || undefined, employeeId: f.employeeId || undefined, grant: grant.filter((p) => !base.has(p)), revoke: revoke.filter((p) => base.has(p)), active: f.active }), 'Usuario guardado')
    if (r) onClose()
  })
  return (
    <Sheet title={user ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !f.name.trim() || (!user && f.pin.length < 4)} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <div className="grid2"><Field label="Nombre"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Rol"><select value={f.role} onChange={(e) => { setF({ ...f, role: e.target.value as RoleId }); setGrant([]); setRevoke([]) }}>{(Object.keys(ROLE_LABEL) as RoleId[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field></div>
        <div className="grid2"><Field label={user ? 'Nuevo PIN (déjalo vacío para conservar el actual)' : 'PIN (4 a 8 dígitos)'}><input type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" /></Field>
          <Field label="Empleado vinculado" hint="Necesario para que un mecánico vea y registre sus propias órdenes y tiempos"><select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Ninguno</option>{data.employees.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Field></div>
        {user && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Usuario activo (si lo desactivas ya no podrá entrar)</label>}
        <button className="btn small" onClick={() => setAdv(!adv)}>{adv ? 'Ocultar' : 'Personalizar'} permisos ({grant.length + revoke.length} ajuste(s) sobre el rol)</button>
        {adv && <div className="card stack-sm">
          <p className="small muted">Parte del rol «{ROLE_LABEL[f.role]}». Marca o desmarca para conceder o retirar permisos individuales. Concede solo lo necesario.</p>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>{PERMISSIONS.map((p) => <label key={p} className="chk"><input type="checkbox" checked={eff(p)} onChange={() => toggle(p)} />{PERM_LABEL[p] ?? p}{(grant.includes(p) || revoke.includes(p)) && <span className="badge info">ajustado</span>}</label>)}</div>
        </div>}
        <div className="banner info">Los permisos se verifican en la capa de servicios de la aplicación, no solo en la pantalla. En esta versión local no hay un servidor, así que no sustituyen la seguridad de un backend: protege el dispositivo.</div>
      </div>
    </Sheet>
  )
}
