import { createBackup, parseBackup, restoreBackup, type BackupFile } from './backup'
import { fail, need, stamp, uid, type Ctx } from './core'

/**
 * Respaldo en Google Drive: un solo archivo con nombre fijo por taller. No hay fusión automática:
 * si Drive tiene una versión que este dispositivo no conoce, se avisa y el usuario decide (traer, combinar o subir la suya).
 * Acceso por `drive.file`: la app solo ve el archivo que ella misma creó.
 */
const API = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const FIELDS = 'id,version,modifiedTime,trashed,appProperties'

/** Acceso a la red y al token, inyectables (pruebas y manejo de expiración en la interfaz). */
export interface DriveEnv { fetch: typeof fetch; token: () => Promise<string> }

export interface RemoteInfo { id: string; version: string; modifiedTime: string; backupCreatedAt: string; deviceId: string }
/** Estado propio de cada dispositivo (no viaja en la copia). `dirty`: hay cambios locales sin subir. */
export interface DriveState { deviceId: string; enabled: boolean; dirty: boolean; fileId?: string; version?: string; backupCreatedAt?: string; lastSyncAt?: string }
export type RemoteStatus =
  | { status: 'none' }
  | { status: 'in-sync'; remote: RemoteInfo }
  | { status: 'local-ahead'; remote: RemoteInfo }
  | { status: 'remote-newer'; remote: RemoteInfo }
  | { status: 'conflict'; remote: RemoteInfo }
export type UploadResult = { status: 'uploaded'; remote: RemoteInfo } | { status: 'conflict'; remote: RemoteInfo }
export type SyncOutcome = { status: 'idle' } | { status: 'uploaded'; remote: RemoteInfo } | { status: 'remote-newer' | 'conflict'; remote: RemoteInfo }

/* ───────── Estado local del dispositivo ───────── */
const mem = new Map<string, string>()
const seqs = new Map<string, number>()
const listeners = new Map<string, Set<() => void>>()
const stateKey = (orgId: string) => `torque.drive.${orgId}`

export function getDriveState(orgId: string): DriveState {
  let raw: string | null | undefined
  try { raw = localStorage.getItem(stateKey(orgId)) } catch { /* sin almacenamiento */ }
  raw ??= mem.get(stateKey(orgId))
  if (raw) { try { return JSON.parse(raw) as DriveState } catch { /* estado dañado: se recrea */ } }
  const fresh: DriveState = { deviceId: uid(), enabled: false, dirty: true }
  saveState(orgId, fresh)
  return fresh
}
function saveState(orgId: string, s: DriveState): void {
  const raw = JSON.stringify(s)
  mem.set(stateKey(orgId), raw)
  try { localStorage.setItem(stateKey(orgId), raw) } catch { /* sin almacenamiento */ }
}
const patchState = (orgId: string, p: Partial<DriveState>): DriveState => { const s = { ...getDriveState(orgId), ...p }; saveState(orgId, s); return s }

export function setDriveEnabled(orgId: string, enabled: boolean): void {
  if (enabled) patchState(orgId, { enabled })
  else patchState(orgId, { enabled, fileId: undefined, version: undefined, backupCreatedAt: undefined, dirty: true })
}

/** Marca cambios locales sin subir y avisa a quien escuche (para la subida automática). */
export function markDirty(orgId: string): void {
  seqs.set(orgId, (seqs.get(orgId) ?? 0) + 1)
  if (!getDriveState(orgId).dirty) patchState(orgId, { dirty: true })
  listeners.get(orgId)?.forEach((f) => f())
}
/** Conecta las escrituras de la base del taller con `markDirty`. */
export function trackChanges(ctx: Ctx): void { ctx.db.onChange = () => markDirty(ctx.orgId) }
export function subscribeChanges(orgId: string, f: () => void): () => void {
  const set = listeners.get(orgId) ?? new Set<() => void>()
  set.add(f); listeners.set(orgId, set)
  return () => { set.delete(f) }
}

/* ───────── Cliente de Drive ───────── */
interface DriveFile { id: string; version?: string; modifiedTime?: string; trashed?: boolean; appProperties?: Record<string, string> }
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'taller'
/** Nombre fijo: no cambia aunque cambien los datos (el id del taller evita choques entre talleres). */
export const driveFileName = (name: string, orgId: string): string => `torque-${slug(name)}-${orgId.slice(0, 8)}.json`

async function call(env: DriveEnv, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await env.token() // si falla, su mensaje (p. ej. «vuelve a conectar») llega tal cual al usuario
  let r: Response
  try { r = await env.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } }) }
  catch { return fail('No hay conexión con Google Drive.') }
  if (r.status === 401) return fail('Google Drive cerró la sesión: vuelve a conectar.')
  return r
}
const check = (r: Response, what: string) => { if (!r.ok) fail(`Google Drive no pudo ${what} (${r.status}).`) }
const info = (f: DriveFile): RemoteInfo => ({ id: f.id, version: String(f.version ?? ''), modifiedTime: f.modifiedTime ?? '', backupCreatedAt: f.appProperties?.backupCreatedAt ?? '', deviceId: f.appProperties?.deviceId ?? '' })

/** Localiza el archivo del taller: primero por el id guardado y, si no, buscándolo por sus propiedades. */
async function findRemote(ctx: Ctx, env: DriveEnv): Promise<RemoteInfo | null> {
  const st = getDriveState(ctx.orgId)
  if (st.fileId) {
    const r = await call(env, `${API}/${st.fileId}?fields=${FIELDS}`)
    if (r.ok) { const f = (await r.json()) as DriveFile; if (!f.trashed) return info(f) }
    else if (r.status !== 404) check(r, 'consultar la copia')
    patchState(ctx.orgId, { fileId: undefined })
  }
  const q = encodeURIComponent(`appProperties has { key='orgId' and value='${ctx.orgId}' } and trashed=false`)
  const r = await call(env, `${API}?q=${q}&orderBy=modifiedTime%20desc&pageSize=1&fields=files(${FIELDS})`)
  check(r, 'buscar la copia')
  const f = ((await r.json()) as { files?: DriveFile[] }).files?.[0]
  if (!f) return null
  patchState(ctx.orgId, { fileId: f.id })
  return info(f)
}

function multipart(meta: object, content: string, boundary: string): string {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`
}

async function upload(ctx: Ctx, env: DriveEnv, remote: RemoteInfo | null): Promise<RemoteInfo> {
  const seq = seqs.get(ctx.orgId) ?? 0
  const file: BackupFile = await createBackup(ctx, { touch: false })
  const st = getDriveState(ctx.orgId)
  const appProperties = { orgId: ctx.orgId, backupCreatedAt: file.createdAt, deviceId: st.deviceId, appVersion: file.appVersion, schemaVersion: String(file.schemaVersion) }
  const boundary = `torque-${uid()}`
  const meta = remote ? { appProperties } : { name: driveFileName(file.orgName, ctx.orgId), mimeType: 'application/json', appProperties }
  const url = remote ? `${UPLOAD}/${remote.id}?uploadType=multipart&fields=${FIELDS}` : `${UPLOAD}?uploadType=multipart&fields=${FIELDS}`
  const content = JSON.stringify(file)
  const r = await call(env, url, { method: remote ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart(meta, content, boundary) })
  check(r, 'subir la copia')
  const out = info((await r.json()) as DriveFile)
  // Si hubo cambios mientras se subía, siguen pendientes.
  patchState(ctx.orgId, { fileId: out.id, version: out.version, backupCreatedAt: file.createdAt, lastSyncAt: stamp(ctx), dirty: (seqs.get(ctx.orgId) ?? 0) !== seq })
  return out
}

/* ───────── Operaciones ───────── */
/** Compara Drive con lo que este dispositivo sabe: sin descargar el archivo (solo metadatos). */
export async function checkRemote(ctx: Ctx, env: DriveEnv): Promise<RemoteStatus> {
  need(ctx, 'respaldo.exportar')
  const remote = await findRemote(ctx, env)
  if (!remote) return { status: 'none' }
  const st = getDriveState(ctx.orgId)
  if (st.version === remote.version) return { status: st.dirty ? 'local-ahead' : 'in-sync', remote }
  return { status: st.dirty ? 'conflict' : 'remote-newer', remote }
}

/** Sube la copia. Sin `force` nunca pisa una versión de Drive que este dispositivo no conoce. */
export async function uploadBackup(ctx: Ctx, env: DriveEnv, o: { force?: boolean } = {}): Promise<UploadResult> {
  need(ctx, 'respaldo.exportar')
  const remote = await findRemote(ctx, env)
  if (remote && !o.force && remote.version !== getDriveState(ctx.orgId).version) return { status: 'conflict', remote }
  return { status: 'uploaded', remote: await upload(ctx, env, remote) }
}

/** Ciclo automático: sube si hay cambios locales y Drive no tiene nada nuevo; si no, avisa. */
export async function syncNow(ctx: Ctx, env: DriveEnv): Promise<SyncOutcome> {
  const c = await checkRemote(ctx, env)
  if (c.status === 'in-sync') return { status: 'idle' }
  if (c.status === 'remote-newer' || c.status === 'conflict') return c
  return { status: 'uploaded', remote: await upload(ctx, env, c.status === 'none' ? null : c.remote) }
}

/** Trae la copia de Drive y la aplica con las reglas de la restauración (`combinar` conserva lo local). */
export async function pullRemote(ctx: Ctx, env: DriveEnv, mode: 'combinar' | 'reemplazar'): Promise<{ added: number; skipped: number }> {
  need(ctx, 'respaldo.restaurar')
  const remote = (await findRemote(ctx, env)) ?? fail('No hay ninguna copia en Google Drive.')
  const r = await call(env, `${API}/${remote.id}?alt=media`)
  check(r, 'descargar la copia')
  const rep = parseBackup(await r.text(), ctx.orgId)
  if (!rep.ok || !rep.data) return fail(rep.errors[0] ?? 'La copia de Drive no es válida.')
  const hadLocal = getDriveState(ctx.orgId).dirty
  const out = await restoreBackup(ctx, rep.data, mode)
  // Combinar deja datos que Drive aún no tiene: quedan pendientes de subir. Reemplazar deja ambos iguales.
  patchState(ctx.orgId, { fileId: remote.id, version: remote.version, backupCreatedAt: remote.backupCreatedAt, lastSyncAt: stamp(ctx), dirty: mode === 'combinar' && (hadLocal || out.added > 0) })
  return out
}
