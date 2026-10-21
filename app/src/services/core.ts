import type { Table } from 'dexie'
import type { OrgDB } from '../db/db'
import { localDate } from '../domain/dates'
import { can, type Permission } from '../domain/permissions'
import type { DocKind, ISODate, Settings, User } from '../domain/types'

/** Error de negocio mostrable al usuario (mensaje en español). */
export class UserError extends Error {
  constructor(message: string) { super(message); this.name = 'UserError' }
}
export function fail(msg: string): never { throw new UserError(msg) }

/** Contexto de operación: taller (base de datos), usuario autenticado y reloj inyectable (para pruebas y datos de demostración). */
export interface Ctx { db: OrgDB; orgId: string; user: User; tz: string; now: () => Date }

export const uid = (): string => crypto.randomUUID()
export const stamp = (ctx: Ctx): string => ctx.now().toISOString()
export const today = (ctx: Ctx): ISODate => localDate(ctx.now(), ctx.tz)

/** Los permisos se verifican aquí, en la capa de servicios, y no solo en la interfaz. */
export function need(ctx: Ctx, p: Permission): void {
  if (!can(ctx.user, p)) fail('No tienes permiso para realizar esta acción.')
}
export const allowed = (ctx: Ctx, p: Permission): boolean => can(ctx.user, p)

/** Ejecuta una operación en una sola transacción de lectura/escritura sobre todo el taller (todo o nada). */
export function tx<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  return ctx.db.transaction('rw', ctx.db.tables, fn)
}

export async function load<T extends { orgId: string }>(ctx: Ctx, table: Table<T, string>, id: string, what = 'El registro'): Promise<T> {
  const r = await table.get(id)
  if (!r || r.orgId !== ctx.orgId) return fail(`${what} no existe.`)
  return r
}

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const s = await ctx.db.settings.get('main')
  if (!s || s.orgId !== ctx.orgId) return fail('El taller no está configurado.')
  return s
}

/** Folio consecutivo y único, asignado dentro de la misma transacción que guarda el documento. */
export async function nextFolio(ctx: Ctx, kind: DocKind): Promise<string> {
  const s = await getSettings(ctx)
  const n = s.counters[kind]
  await ctx.db.settings.put({ ...s, counters: { ...s.counters, [kind]: n + 1 }, updatedAt: stamp(ctx) })
  return `${s.prefixes[kind]}-${String(n).padStart(4, '0')}`
}

const SECRET_KEYS = new Set(['pinHash', 'pinSalt'])
const clean = (v: unknown): unknown => v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => (SECRET_KEYS.has(k) ? undefined : x)))

/** Bitácora de acciones críticas (solo anexar). Nunca guarda PIN, hashes ni secretos. */
export async function audit(ctx: Ctx, action: string, entity: string, entityId: string, o: { before?: unknown; after?: unknown; reason?: string } = {}): Promise<void> {
  await ctx.db.audit.add({ id: uid(), orgId: ctx.orgId, at: stamp(ctx), userId: ctx.user.id, userName: ctx.user.name, action, entity, entityId, before: clean(o.before), after: clean(o.after), reason: o.reason })
}

/**
 * Idempotencia: si ya se procesó una operación con la misma llave, devuelve el resultado anterior sin repetir
 * efectos (pagos, recepciones, ventas, salidas de inventario). Debe invocarse dentro de `tx`.
 */
export async function once<T extends { id: string }>(ctx: Ctx, key: string | undefined, kind: string, run: () => Promise<T>, reload: (id: string) => Promise<T>): Promise<{ value: T; replay: boolean }> {
  if (key) {
    const ex = await ctx.db.ops.get(key)
    if (ex && ex.orgId === ctx.orgId) return { value: await reload(ex.resultId), replay: true }
  }
  const value = await run()
  if (key) await ctx.db.ops.put({ key, orgId: ctx.orgId, kind, resultId: value.id, at: stamp(ctx) })
  return { value, replay: false }
}

export const trim = (s: string | undefined): string => (s ?? '').trim()
export function requireText(s: string | undefined, label: string): string {
  const t = trim(s)
  return t ? t : fail(`${label} es obligatorio.`)
}
export function requirePositive(n: number, label: string): number {
  if (!(typeof n === 'number' && isFinite(n) && n > 0)) fail(`${label} debe ser mayor que cero.`)
  return n
}
export function requireNonNegative(n: number, label: string): number {
  if (!(typeof n === 'number' && isFinite(n) && n >= 0)) fail(`${label} no puede ser negativo.`)
  return n
}
