import type { Table } from 'dexie'
import { SCHEMA_VERSION, dropOrgDb, openOrgDb, registry } from '../db/db'
import { audit, fail, load, need, stamp, tx, type Ctx } from './core'

export const FORMAT = 'torque-backup'
export const BACKUP_TABLES = [
  'settings', 'users', 'customers', 'vehicles', 'services', 'products', 'warehouses', 'balances', 'movements', 'suppliers', 'supplierProducts', 'purchaseOrders', 'receipts', 'workOrders',
  'quotations', 'sales', 'ledger', 'cashSessions', 'expenses', 'recurring', 'employees', 'appointments', 'priceHistory', 'priceProposals', 'audit', 'attachments',
] as const
type TName = (typeof BACKUP_TABLES)[number]
const APPEND_ONLY: TName[] = ['movements', 'ledger', 'audit', 'priceHistory']

export interface BackupFile { format: typeof FORMAT; schemaVersion: number; orgId: string; orgName: string; createdAt: string; appVersion: string; tables: Record<TName, Record<string, unknown>[]> }
export interface ValidationReport { ok: boolean; errors: string[]; warnings: string[]; counts: Partial<Record<TName, number>>; data?: BackupFile }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const idOf = (t: TName, r: Record<string, unknown>) => (t === 'settings' ? 'main' : (r.id as string | undefined))

declare const __APP_VERSION__: string
/** Copia completa del taller. Contiene los hashes de PIN de los usuarios: protege el archivo. */
export async function createBackup(ctx: Ctx): Promise<BackupFile> {
  need(ctx, 'respaldo.exportar')
  const tables = {} as BackupFile['tables']
  for (const t of BACKUP_TABLES) tables[t] = (await (ctx.db as unknown as Record<string, Table>)[t].toArray()) as Record<string, unknown>[]
  const s = await ctx.db.settings.get('main')
  await tx(ctx, async () => { if (s) await ctx.db.settings.put({ ...s, lastBackupAt: stamp(ctx) }) })
  return { format: FORMAT, schemaVersion: SCHEMA_VERSION, orgId: ctx.orgId, orgName: s?.businessName ?? '', createdAt: stamp(ctx), appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'test', tables }
}

/** Migraciones: clave = versión de origen. */
const MIGRATIONS: Record<number, (d: BackupFile) => BackupFile> = {}

export function parseBackup(text: string, orgId: string): ValidationReport {
  const rep: ValidationReport = { ok: false, errors: [], warnings: [], counts: {} }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { rep.errors.push('El archivo no es un JSON válido.'); return rep }
  if (!isObj(raw) || raw.format !== FORMAT) { rep.errors.push('No es una copia de seguridad de Torque.'); return rep }
  let v = raw.schemaVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) { rep.errors.push('Falta la versión del esquema.'); return rep }
  if (v > SCHEMA_VERSION) { rep.errors.push(`La copia es de una versión más nueva (v${v}). Actualiza la aplicación.`); return rep }
  if (raw.orgId !== orgId) { rep.errors.push(`Esta copia pertenece a otro taller («${String(raw.orgName ?? '')}»). No se puede restaurar aquí.`); return rep }
  let d = raw as unknown as BackupFile
  while ((v as number) < SCHEMA_VERSION) { const m = MIGRATIONS[v as number]; if (!m) { rep.errors.push(`No hay migración desde la versión ${v}.`); return rep } d = m(d); v = (v as number) + 1 }
  if (!isObj(d.tables)) { rep.errors.push('La copia no contiene tablas.'); return rep }
  const ids = {} as Record<TName, Set<string>>
  for (const t of BACKUP_TABLES) {
    const arr = d.tables[t]
    if (arr === undefined) { (d.tables as Record<string, unknown>)[t] = []; rep.warnings.push(`La copia no incluye «${t}».`); ids[t] = new Set(); continue }
    if (!Array.isArray(arr)) { rep.errors.push(`«${t}» debe ser una lista.`); continue }
    ids[t] = new Set()
    arr.forEach((r, i) => {
      const id = isObj(r) ? idOf(t, r) : undefined
      if (!isObj(r) || typeof id !== 'string' || !id) { rep.errors.push(`${t}[${i}]: registro sin id válido.`); return }
      if (r.orgId !== undefined && r.orgId !== orgId) rep.errors.push(`${t}[${i}]: pertenece a otro taller.`)
      if (ids[t].has(id)) rep.errors.push(`${t}: id duplicado «${id}».`)
      ids[t].add(id)
    })
    rep.counts[t] = arr.length
  }
  if (rep.errors.length) return rep
  const ref = (t: TName, field: string, to: TName, optional = true) => {
    for (const r of d.tables[t]) { const x = r[field]; if ((x || !optional) && typeof x === 'string' && !ids[to].has(x)) rep.errors.push(`${t}: ${field} apunta a un registro inexistente (${x}).`) }
  }
  ref('vehicles', 'customerId', 'customers'); ref('workOrders', 'customerId', 'customers'); ref('workOrders', 'vehicleId', 'vehicles'); ref('quotations', 'customerId', 'customers')
  ref('receipts', 'supplierId', 'suppliers'); ref('receipts', 'purchaseOrderId', 'purchaseOrders'); ref('purchaseOrders', 'supplierId', 'suppliers')
  ref('balances', 'productId', 'products'); ref('movements', 'productId', 'products'); ref('sales', 'customerId', 'customers')
  ref('ledger', 'saleId', 'sales'); ref('ledger', 'expenseId', 'expenses'); ref('ledger', 'sessionId', 'cashSessions')
  if (rep.errors.length) return rep
  rep.ok = true; rep.data = { ...d, schemaVersion: SCHEMA_VERSION }
  return rep
}

/**
 * Restauración atómica. «combinar» agrega lo que falta y conserva lo local; «reemplazar» sustituye todo.
 * Si algo falla, la transacción se revierte y los datos actuales quedan intactos.
 */
export async function restoreBackup(ctx: Ctx, file: BackupFile, mode: 'combinar' | 'reemplazar'): Promise<{ added: number; skipped: number }> {
  need(ctx, 'respaldo.restaurar')
  if (file.orgId !== ctx.orgId) fail('La copia pertenece a otro taller.')
  const replace = mode === 'reemplazar'
  if (replace) ctx.db.restoring = true
  try { return await restoreInTx(ctx, file, mode) } finally { ctx.db.restoring = false }
}

async function restoreInTx(ctx: Ctx, file: BackupFile, mode: 'combinar' | 'reemplazar'): Promise<{ added: number; skipped: number }> {
  return tx(ctx, async () => {
    let added = 0, skipped = 0
    for (const t of BACKUP_TABLES) {
      const table = (ctx.db as unknown as Record<string, Table>)[t]
      const rows = file.tables[t]
      if (mode === 'reemplazar') { await table.clear(); await table.bulkAdd(rows); added += rows.length; continue }
      if (t === 'settings') { if (!(await table.get('main')) && rows[0]) { await table.put(rows[0]); added++ } continue }
      for (const r of rows) {
        if (await table.get(r.id as string)) { skipped++; continue }
        await table.add(r); added++
      }
    }
    if (mode === 'combinar') {
      // Contadores de folios: nunca retroceden.
      const cur = await load(ctx, ctx.db.settings, 'main'), inc = file.tables.settings[0] as { counters?: Record<string, number> } | undefined
      if (inc?.counters) await ctx.db.settings.put({ ...cur, counters: Object.fromEntries(Object.entries(cur.counters).map(([k, n]) => [k, Math.max(n, inc.counters![k] ?? 0)])) as typeof cur.counters })
    }
    await audit(ctx, 'respaldo.restaurado', 'respaldo', file.createdAt, { after: { mode, added, skipped } }).catch(() => undefined)
    return { added, skipped }
  })
}
export { APPEND_ONLY }

/**
 * Restaura una copia completa como taller NUEVO en este dispositivo (cambio de teléfono/computadora).
 * Conserva el id del taller y sus usuarios/PIN. Se rechaza si ese taller ya existe aquí.
 */
export async function restoreAsNewOrganization(text: string): Promise<{ orgId: string; name: string }> {
  const peek = (() => { try { return JSON.parse(text) as { orgId?: string; orgName?: string } } catch { return null } })()
  if (!peek?.orgId) return fail('El archivo no es una copia de seguridad de Torque.')
  const rep = parseBackup(text, peek.orgId)
  if (!rep.ok || !rep.data) return fail(rep.errors[0] ?? 'La copia no es válida.')
  if (await registry.orgs.get(peek.orgId)) return fail('Ese taller ya existe en este dispositivo: inicia sesión o restaura desde Ajustes.')
  const db = openOrgDb(peek.orgId)
  db.restoring = true
  try {
    await db.transaction('rw', db.tables, async () => {
      for (const t of BACKUP_TABLES) await (db as unknown as Record<string, Table>)[t].bulkAdd(rep.data!.tables[t])
    })
    await registry.orgs.put({ id: peek.orgId, name: rep.data.orgName || 'Taller restaurado', demo: false, createdAt: rep.data.createdAt })
  } catch (e) { await dropOrgDb(peek.orgId); throw e } finally { db.restoring = false }
  return { orgId: peek.orgId, name: rep.data.orgName }
}
