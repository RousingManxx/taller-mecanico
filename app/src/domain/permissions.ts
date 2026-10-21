import type { RoleId, User } from './types'

export const PERMISSIONS = [
  'clientes.ver', 'clientes.editar', 'vehiculos.ver', 'vehiculos.editar', 'agenda.ver', 'agenda.editar',
  'ordenes.ver', 'ordenes.ver_todas', 'ordenes.crear', 'ordenes.editar', 'ordenes.autorizar', 'ordenes.cancelar',
  'ordenes.tiempos', 'ordenes.consumir', 'ordenes.entregar',
  'cotizaciones.ver', 'cotizaciones.editar',
  'ventas.ver', 'ventas.crear', 'ventas.cancelar', 'cobros.registrar',
  'inventario.ver', 'inventario.editar', 'inventario.ajustar', 'costos.ver', 'precios.editar', 'precios.aprobar',
  'compras.ver', 'compras.editar', 'compras.recibir', 'pagos_proveedor.registrar',
  'gastos.ver', 'gastos.editar', 'caja.ver', 'caja.operar', 'caja.cerrar',
  'finanzas.ver', 'personal.ver', 'personal.editar', 'personal.salarios',
  'usuarios.admin', 'config.editar', 'auditoria.ver', 'respaldo.exportar', 'respaldo.restaurar',
] as const
export type Permission = (typeof PERMISSIONS)[number]

const ALL = [...PERMISSIONS] as Permission[]
const without = (a: Permission[], ...x: Permission[]) => a.filter((p) => !x.includes(p))

export const ROLE_LABEL: Record<RoleId, string> = {
  propietario: 'Propietario / administrador', gerente: 'Gerente', recepcion: 'Recepcionista', mecanico: 'Mecánico', almacen: 'Almacén', finanzas: 'Administración / finanzas',
}

export const ROLE_PERMISSIONS: Record<RoleId, Permission[]> = {
  propietario: ALL,
  gerente: without(ALL, 'usuarios.admin', 'personal.salarios', 'respaldo.restaurar'),
  recepcion: ['clientes.ver', 'clientes.editar', 'vehiculos.ver', 'vehiculos.editar', 'agenda.ver', 'agenda.editar', 'ordenes.ver', 'ordenes.ver_todas', 'ordenes.crear', 'ordenes.editar', 'ordenes.autorizar', 'ordenes.entregar', 'cotizaciones.ver', 'cotizaciones.editar', 'inventario.ver', 'ventas.ver', 'ventas.crear', 'cobros.registrar', 'caja.ver', 'caja.operar'],
  mecanico: ['clientes.ver', 'vehiculos.ver', 'agenda.ver', 'ordenes.ver', 'ordenes.editar', 'ordenes.tiempos', 'ordenes.consumir', 'inventario.ver'],
  almacen: ['inventario.ver', 'inventario.editar', 'inventario.ajustar', 'costos.ver', 'compras.ver', 'compras.editar', 'compras.recibir', 'ordenes.ver', 'ordenes.ver_todas', 'ordenes.consumir'],
  finanzas: ['clientes.ver', 'ordenes.ver', 'ordenes.ver_todas', 'cotizaciones.ver', 'ventas.ver', 'ventas.crear', 'ventas.cancelar', 'cobros.registrar', 'costos.ver', 'compras.ver', 'pagos_proveedor.registrar', 'gastos.ver', 'gastos.editar', 'caja.ver', 'caja.operar', 'caja.cerrar', 'finanzas.ver', 'inventario.ver', 'respaldo.exportar'],
}

export function userPermissions(u: Pick<User, 'role' | 'grant' | 'revoke'>): Set<string> {
  const s = new Set<string>(ROLE_PERMISSIONS[u.role] ?? [])
  for (const g of u.grant ?? []) s.add(g)
  for (const r of u.revoke ?? []) s.delete(r)
  return s
}
export const can = (u: Pick<User, 'role' | 'grant' | 'revoke'> | null | undefined, p: Permission): boolean => !!u && userPermissions(u).has(p)
