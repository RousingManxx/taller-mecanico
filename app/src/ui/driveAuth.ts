import { UserError } from '../services/core'
import type { DriveEnv } from '../services/driveSync'

/**
 * Autorización de Google Drive en el navegador (Google Identity Services). Sin servidor propio no hay «refresh token»:
 * el acceso dura ~1 h. Renovarlo (`prompt: ''`) abre una ventana de Google que se cierra sola si ya hay permiso, pero los
 * navegadores la bloquean si no nace de un clic del usuario (`popup_failed_to_open`). Por eso, sin clic suele fallar y la
 * interfaz renueva con el siguiente toque del usuario en cualquier parte de la app (ver `DriveSyncProvider`).
 * Alcance `drive.file`: la app solo ve el archivo que ella misma creó.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const MARGIN = 5 * 60_000 // se renueva 5 min antes de que venza
const SILENT_TIMEOUT = 10_000

export const RECONNECT = 'Reconecta Google Drive para seguir respaldando.'
/** Sin `VITE_GOOGLE_CLIENT_ID` la función no se ofrece y la app funciona igual. */
export const driveAvailable = Boolean(CLIENT_ID)

interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string }
interface TokenClient { requestAccessToken: (o?: { prompt?: string }) => void }
interface Gis { accounts: { oauth2: { initTokenClient: (c: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type?: string }) => void }) => TokenClient; revoke: (t: string, done?: () => void) => void } } }
declare global { interface Window { google?: Gis } }

let gis: Promise<Gis> | null = null
function loadGis(): Promise<Gis> {
  gis ??= new Promise<Gis>((res, rej) => {
    if (window.google?.accounts) return res(window.google)
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true
    s.onload = () => (window.google ? res(window.google) : rej(new Error('gis')))
    s.onerror = () => { gis = null; rej(new Error('gis')) }
    document.head.append(s)
  })
  return gis
}

let cached: { value: string; exp: number } | null = null
const fresh = () => (cached && cached.exp - MARGIN > Date.now() ? cached.value : null)

function request(g: Gis, interactive: boolean): Promise<string> {
  return new Promise<string>((res, rej) => {
    const timer = interactive ? undefined : setTimeout(() => fail(), SILENT_TIMEOUT)
    const fail = () => { clearTimeout(timer); rej(new UserError(RECONNECT)) }
    g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID!, scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return fail()
        clearTimeout(timer)
        cached = { value: r.access_token, exp: Date.now() + Number(r.expires_in ?? 3600) * 1000 }
        res(r.access_token)
      },
      error_callback: fail, // p. ej. popup_failed_to_open (bloqueada sin clic) o popup_closed
    }).requestAccessToken({ prompt: '' })
  })
}

/**
 * Token vigente. `interactive` (desde un clic) puede abrir la ventana de Google; sin él solo se intenta en silencio
 * y, si no se logra, falla con `RECONNECT` para que la interfaz ofrezca reconectar.
 */
export async function accessToken(o: { interactive?: boolean } = {}): Promise<string> {
  if (!CLIENT_ID) throw new UserError('Google Drive no está configurado en esta instalación.')
  const ok = fresh()
  if (ok) return ok
  let g: Gis
  try { g = await loadGis() } catch { throw new UserError('No hay conexión con Google Drive.') }
  return request(g, !!o.interactive)
}

/** Revoca el acceso concedido y olvida el token. */
export async function revokeAccess(): Promise<void> {
  const t = cached?.value; cached = null
  if (t && window.google) window.google.accounts.oauth2.revoke(t)
}

/** Entorno de red para el servicio de sincronización. */
export const driveEnv: DriveEnv = { fetch: (input, init) => fetch(input, init), token: () => accessToken() }
