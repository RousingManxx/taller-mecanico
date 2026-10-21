import { dropOrgDb, openOrgDb, registry, type OrgRecord } from '../db/db'
import { defaultSettings } from '../db/defaults'
import { localDate } from '../domain/dates'
import { PERMISSIONS } from '../domain/permissions'
import type { RoleId, User } from '../domain/types'
import { audit, fail, load, need, requireText, stamp, tx, uid, trim, type Ctx } from './core'

/* ───────── PIN ───────── */
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
export async function derive(pin: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256))
}
export async function hashPin(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  const pinSalt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer)
  return { pinSalt, pinHash: await derive(pin, pinSalt) }
}
export function validatePin(pin: string): void {
  if (!/^\d{4,8}$/.test(pin)) fail('El PIN debe tener de 4 a 8 dígitos.')
}

/* ───────── Talleres ───────── */
export async function listOrgs(): Promise<OrgRecord[]> {
  return (await registry.orgs.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export interface NewOrg { name: string; ownerName: string; pin: string; demo?: boolean; now?: () => Date }
export async function createOrganization(o: NewOrg): Promise<Ctx> {
  const name = requireText(o.name, 'El nombre del taller'), ownerName = requireText(o.ownerName, 'Tu nombre')
  validatePin(o.pin)
  const now = o.now ?? (() => new Date())
  const orgId = uid(), at = now().toISOString()
  const pin = await hashPin(o.pin)
  const db = openOrgDb(orgId)
  const owner: User = { id: uid(), orgId, createdAt: at, updatedAt: at, name: ownerName, role: 'propietario', active: true, ...pin }
  await db.transaction('rw', db.tables, async () => {
    await db.settings.put(defaultSettings(orgId, name, at))
    await db.warehouses.put({ id: uid(), orgId, name: 'Almacén principal', isDefault: true, createdAt: at, updatedAt: at })
    await db.users.put(owner)
  })
  await registry.orgs.put({ id: orgId, name, demo: !!o.demo, createdAt: at })
  const ctx: Ctx = { db, orgId, user: owner, tz: 'America/Mexico_City', now }
  await audit(ctx, 'organizacion.creada', 'organizacion', orgId, { after: { name, demo: !!o.demo } })
  return ctx
}

/** Elimina SOLO los talleres de demostración. Los talleres reales nunca se tocan. */
export async function deleteDemoOrganizations(): Promise<number> {
  const demos = (await registry.orgs.toArray()).filter((x) => x.demo)
  for (const d of demos) { await dropOrgDb(d.id); await registry.orgs.delete(d.id) }
  return demos.length
}
/** Eliminación de un taller real: exige escribir su nombre exacto. */
export async function deleteOrganization(orgId: string, confirmName: string): Promise<void> {
  const rec = await registry.orgs.get(orgId)
  if (!rec) return fail('El taller no existe.')
  if (trim(confirmName) !== rec.name) fail('El nombre escrito no coincide; no se eliminó nada.')
  await dropOrgDb(orgId); await registry.orgs.delete(orgId)
}

/* ───────── Inicio de sesión ───────── */
export interface LoginUser { id: string; name: string; role: RoleId }
export async function listLoginUsers(orgId: string): Promise<LoginUser[]> {
  const db = openOrgDb(orgId)
  return (await db.users.toArray()).filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role }))
}

const attempts = new Map<string, { n: number; until: number }>()
export async function login(orgId: string, userId: string, pin: string, now: () => Date = () => new Date()): Promise<Ctx> {
  const key = orgId + userId, a = attempts.get(key)
  if (a && a.until > Date.now()) return fail(`Demasiados intentos. Espera ${Math.ceil((a.until - Date.now()) / 1000)} s.`)
  const db = openOrgDb(orgId)
  const user = await db.users.get(userId)
  if (!user || !user.active || user.orgId !== orgId) return fail('Usuario no disponible.')
  if ((await derive(pin, user.pinSalt)) !== user.pinHash) {
    const n = (a?.n ?? 0) + 1
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 60_000 : 0 })
    return fail(n >= 5 ? 'PIN incorrecto. Acceso bloqueado 1 minuto.' : 'PIN incorrecto.')
  }
  attempts.delete(key)
  const s = await db.settings.get('main')
  const ctx: Ctx = { db, orgId, user, tz: s?.timezone ?? 'America/Mexico_City', now }
  await audit(ctx, 'sesion.inicio', 'usuario', user.id)
  return ctx
}
/** Reconstruye el contexto desde una sesión guardada (sin PIN). Revalida que el usuario siga activo. */
export async function resume(orgId: string, userId: string): Promise<Ctx | null> {
  const db = openOrgDb(orgId)
  const user = await db.users.get(userId)
  if (!user || !user.active) return null
  const s = await db.settings.get('main')
  return { db, orgId, user, tz: s?.timezone ?? 'America/Mexico_City', now: () => new Date() }
}

/* ───────── Administración de usuarios ───────── */
export async function listUsers(ctx: Ctx): Promise<Omit<User, 'pinHash' | 'pinSalt'>[]> {
  need(ctx, 'usuarios.admin')
  return (await ctx.db.users.toArray()).map(({ pinHash: _h, pinSalt: _s, ...u }) => u)
}
const ROLES: RoleId[] = ['propietario', 'gerente', 'recepcion', 'mecanico', 'almacen', 'finanzas']
async function activeOwners(ctx: Ctx, except?: string) {
  return (await ctx.db.users.toArray()).filter((u) => u.active && u.role === 'propietario' && u.id !== except)
}
export interface UserInput { id?: string; name: string; role: RoleId; pin?: string; employeeId?: string; grant?: string[]; revoke?: string[]; active?: boolean }
export async function saveUser(ctx: Ctx, i: UserInput): Promise<string> {
  need(ctx, 'usuarios.admin')
  const name = requireText(i.name, 'El nombre')
  if (!ROLES.includes(i.role)) fail('Rol no válido.')
  for (const p of [...(i.grant ?? []), ...(i.revoke ?? [])]) if (!(PERMISSIONS as readonly string[]).includes(p)) fail(`Permiso desconocido: ${p}`)
  if (!i.id) { validatePin(i.pin ?? '') } else if (i.pin) validatePin(i.pin)
  const pin = i.pin ? await hashPin(i.pin) : null
  return tx(ctx, async () => {
    const at = stamp(ctx)
    if (!i.id) {
      const u: User = { id: uid(), orgId: ctx.orgId, createdAt: at, updatedAt: at, name, role: i.role, active: true, employeeId: i.employeeId, grant: i.grant, revoke: i.revoke, ...pin! }
      await ctx.db.users.add(u)
      await audit(ctx, 'usuario.creado', 'usuario', u.id, { after: { name, role: u.role, grant: u.grant, revoke: u.revoke } })
      return u.id
    }
    const cur = await load(ctx, ctx.db.users, i.id, 'El usuario')
    const active = i.active ?? cur.active
    if (cur.role === 'propietario' && (i.role !== 'propietario' || !active) && (await activeOwners(ctx, cur.id)).length === 0) fail('Debe quedar al menos un propietario activo.')
    const next: User = { ...cur, name, role: i.role, employeeId: i.employeeId, grant: i.grant, revoke: i.revoke, active, updatedAt: at, ...(pin ?? {}) }
    await ctx.db.users.put(next)
    const permsChanged = cur.role !== next.role || JSON.stringify(cur.grant ?? []) !== JSON.stringify(next.grant ?? []) || JSON.stringify(cur.revoke ?? []) !== JSON.stringify(next.revoke ?? [])
    await audit(ctx, permsChanged ? 'permisos.cambiados' : pin ? 'usuario.pin_cambiado' : 'usuario.editado', 'usuario', cur.id, { before: { role: cur.role, grant: cur.grant, revoke: cur.revoke, active: cur.active }, after: { role: next.role, grant: next.grant, revoke: next.revoke, active: next.active } })
    return cur.id
  })
}
export const localToday = (tz: string, now = new Date()) => localDate(now, tz)
