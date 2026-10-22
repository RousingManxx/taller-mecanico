import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { can } from '../domain/permissions'
import { createBackup } from '../services/backup'
import { UserError } from '../services/core'
import { driveFileName, getDriveState, pullRemote, setDriveEnabled, subscribeChanges, syncNow, trackChanges, uploadBackup, type DriveEnv, type RemoteInfo } from '../services/driveSync'
import { download, fmtDateTime, type Data } from './data'
import { RECONNECT, accessToken, driveAvailable, driveEnv, revokeAccess } from './driveAuth'
import { useSession } from './session'
import { Icon, useBusy, useUi } from './ui'

type Phase = 'idle' | 'syncing' | 'error' | 'reconnect'
export interface DrivePending { status: 'remote-newer' | 'conflict'; remote: RemoteInfo }
type Action = 'reemplazar' | 'combinar' | 'subir' | 'luego'
interface Drive {
  /** Hay Client ID y el usuario puede respaldar: solo entonces se muestra algo de Drive. */
  available: boolean
  enabled: boolean
  phase: Phase
  error: string
  pending: DrivePending | null
  dirty: boolean
  lastSyncAt?: string
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  reconnect: () => Promise<void>
  sync: () => Promise<void>
  resolve: (a: Action) => Promise<void>
}
const D = createContext<Drive>(null as never)
export const useDrive = () => useContext(D)

const DEBOUNCE = 60_000 // tras el último cambio, se espera un minuto para subir

/** Un clic del usuario puede abrir la ventana de Google; los ciclos automáticos solo intentan en silencio. */
const interactiveEnv: DriveEnv = { ...driveEnv, token: () => accessToken({ interactive: true }) }

export function DriveSyncProvider({ children }: { children: ReactNode }) {
  const { ctx, logout } = useSession(), ui = useUi()
  const orgId = ctx.orgId
  const [, setTick] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<DrivePending | null>(null)
  const busy = useRef(false)
  const renewing = useRef<Promise<boolean> | null>(null)
  const postponed = useRef('') // versión de Drive que el usuario pospuso en esta sesión: no se vuelve a ofrecer hasta la próxima
  const st = getDriveState(orgId)
  const available = driveAvailable && can(ctx.user, 'respaldo.exportar')
  const enabled = available && st.enabled
  const refresh = () => setTick((n) => n + 1)

  useEffect(() => { trackChanges(ctx); return () => { ctx.db.onChange = null } }, [ctx])

  const run = useCallback(async (env: DriveEnv = driveEnv) => {
    if (busy.current) return
    busy.current = true; setPhase('syncing'); setError('')
    try {
      const out = await syncNow(ctx, env)
      if (out.status === 'remote-newer' || out.status === 'conflict') { if (postponed.current !== out.remote.version) setPending(out) } else setPending(null)
      setPhase('idle')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'No se pudo sincronizar con Google Drive.'
      if (!(e instanceof UserError)) console.error(e)
      setError(msg); setPhase(msg === RECONNECT ? 'reconnect' : 'error')
    } finally { busy.current = false; setTick((n) => n + 1) }
  }, [ctx])

  // Al abrir, al volver a la app, al recuperar la conexión y un minuto después de cada cambio; al salir de la app, si quedó algo pendiente.
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const go = () => { if (navigator.onLine) void run() }
    const onVisible = () => { if (document.visibilityState === 'visible') go(); else if (getDriveState(orgId).dirty) go() }
    const unsub = subscribeChanges(orgId, () => { clearTimeout(timer); timer = setTimeout(go, DEBOUNCE) })
    addEventListener('online', go); document.addEventListener('visibilitychange', onVisible)
    go()
    return () => { unsub(); clearTimeout(timer); removeEventListener('online', go); document.removeEventListener('visibilitychange', onVisible) }
  }, [enabled, orgId, run])

  const connect = async () => {
    if (await ui.run(async () => { await accessToken({ interactive: true }); setDriveEnabled(orgId, true); return true })) refresh()
  }
  const disconnect = async () => {
    await revokeAccess(); setDriveEnabled(orgId, false); setPending(null); setPhase('idle'); setError(''); refresh()
  }
  /** Renueva el acceso desde un gesto del usuario. Un solo intento a la vez, aunque lo pidan el clic global y el botón. */
  const renew = useCallback((): Promise<boolean> => {
    renewing.current ??= accessToken({ interactive: true }).then(() => true, () => false).finally(() => { renewing.current = null })
    return renewing.current
  }, [])
  const reconnect = async () => {
    if (await renew()) await run()
    else ui.toast('No se pudo reconectar Google Drive. Inténtalo de nuevo.', true)
  }

  // Si el acceso venció, el siguiente toque en cualquier parte de la app lo renueva: viene de un gesto del usuario, así que el
  // navegador sí permite la ventana de Google (que se cierra sola si ya diste permiso). Un intento por cada ciclo fallido; el
  // siguiente intento de sincronización lo vuelve a armar.
  useEffect(() => {
    if (!enabled || phase !== 'reconnect') return
    const onClick = () => {
      document.removeEventListener('click', onClick, true)
      void renew().then((ok) => { if (ok) void run() })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [enabled, phase, renew, run])
  const sync = () => run(interactiveEnv)

  const resolve = async (a: Action) => {
    if (!pending) return
    if (a === 'luego') { postponed.current = pending.remote.version; setPending(null); return }
    if (a === 'subir') {
      if (await ui.run(() => uploadBackup(ctx, interactiveEnv, { force: true }), 'Copia subida a Google Drive')) setPending(null)
    } else if (a === 'combinar') {
      const r = await ui.run(() => pullRemote(ctx, interactiveEnv, 'combinar'))
      if (r) { ui.toast(`Copia de Drive combinada: ${r.added} registro(s) agregados; se conservó todo lo de este dispositivo.`); setPending(null); void run() }
    } else {
      const conflict = pending.status === 'conflict'
      if (!(await ui.confirm(conflict ? 'Se reemplazarán los datos de este dispositivo por los de Google Drive y se perderán los cambios que aún no están respaldados allí. Antes se descargará una copia de lo que hay aquí. Después tendrás que iniciar sesión de nuevo.' : 'Se reemplazarán los datos de este dispositivo por la copia más nueva de Google Drive. No tienes cambios sin respaldar. Después tendrás que iniciar sesión de nuevo.', 'Traer de Drive', conflict))) return
      if (conflict) {
        const b = await ui.run(() => createBackup(ctx))
        if (!b) return
        download(`torque-antes-de-traer-${b.createdAt.slice(0, 10)}.json`, JSON.stringify(b), 'application/json')
      }
      if (await ui.run(() => pullRemote(ctx, interactiveEnv, 'reemplazar'), 'Copia de Google Drive restaurada')) { setPending(null); logout() }
    }
    refresh()
  }

  const value: Drive = { available, enabled, phase, error, pending, dirty: st.dirty, lastSyncAt: st.lastSyncAt, connect, disconnect, reconnect, sync, resolve }
  return <D.Provider value={value}>{children}</D.Provider>
}

const who = (r: RemoteInfo, orgId: string) => (r.deviceId && r.deviceId === getDriveState(orgId).deviceId ? 'este dispositivo' : 'otro dispositivo')

/** Aviso global: copia más nueva en Drive, o reconexión necesaria. No ocupa espacio si todo está en orden. */
export function DriveBanner() {
  const d = useDrive(), { ctx } = useSession(), [busy, guard] = useBusy()
  if (!d.enabled) return null
  if (d.pending) {
    const { status, remote } = d.pending
    const when = remote.modifiedTime ? fmtDateTime(remote.modifiedTime) : 'fecha desconocida'
    return (
      <div className="banner info stack-sm" role="region" aria-label="Copia en Google Drive" style={{ marginBottom: 12 }}>
        <div className="row"><Icon n="down" size={20} /><div className="grow">{status === 'remote-newer'
          ? <><b>Hay una copia más nueva en Google Drive</b> (de {who(remote, ctx.orgId)}, {when}). Este dispositivo no tiene cambios sin respaldar.</>
          : <><b>Google Drive y este dispositivo tienen cambios distintos</b> (copia de {who(remote, ctx.orgId)}, {when}). Elige qué hacer; no se sobrescribe nada sin tu confirmación.</>}</div></div>
        <div className="row wrap">
          {status === 'remote-newer'
            ? <button className="btn small primary" disabled={busy} onClick={() => guard(() => d.resolve('reemplazar'))}>Traer la copia de Drive</button>
            : <><button className="btn small primary" disabled={busy} onClick={() => guard(() => d.resolve('combinar'))}>Combinar</button>
              <button className="btn small" disabled={busy} onClick={() => guard(() => d.resolve('subir'))}>Subir la mía</button>
              <button className="btn small" disabled={busy} onClick={() => guard(() => d.resolve('reemplazar'))}>Usar la de Drive</button></>}
          <button className="btn small ghost" disabled={busy} onClick={() => d.resolve('luego')}>Ahora no</button>
        </div>
      </div>
    )
  }
  if (d.phase === 'reconnect') return <button className="banner" style={{ marginBottom: 12 }} onClick={() => d.reconnect()}>Google Drive necesita renovar el acceso para respaldar tus cambios. Toca aquí o en cualquier parte de la app.</button>
  return null
}

/** Sección de Ajustes: conectar, estado y sincronización manual. */
export function DriveSettings({ data }: { data: Data }) {
  const d = useDrive(), { ctx } = useSession(), ui = useUi(), [busy, guard] = useBusy()
  if (!d.available) return null
  const name = driveFileName(data.settings.businessName, ctx.orgId)
  return (
    <section className="stack">
      <div><h2>Respaldo en Google Drive</h2><p className="small muted">Guarda una copia en tu Google Drive con un nombre fijo y avisa al abrir la app si hay una versión más nueva. No sincroniza en vivo: tú decides si traerla.</p></div>
      {!d.enabled ? (
        <>
          <p className="small muted">Se crea un archivo visible en «Mi unidad» (<span className="kbd">{name}</span>). La app solo puede ver ese archivo, no el resto de tu Drive. El archivo es JSON legible e incluye usuarios con el hash de su PIN: protege tu cuenta de Google.</p>
          <div className="row wrap"><button className="btn primary" disabled={busy} onClick={() => guard(d.connect)}><Icon n="up" size={18} />Conectar Google Drive</button></div>
        </>
      ) : (
        <>
          <p className="small muted">Archivo: <span className="kbd">{name}</span> · Última sincronización: <b>{d.lastSyncAt ? fmtDateTime(d.lastSyncAt) : 'nunca'}</b> · {d.phase === 'syncing' ? 'sincronizando…' : d.dirty ? 'hay cambios por subir' : 'todo respaldado'}</p>
          {d.phase === 'error' && <div className="banner bad">{d.error}</div>}
          {d.phase === 'reconnect' && <div className="banner">{d.error} <button className="btn small" onClick={() => d.reconnect()}>Reconectar</button></div>}
          <div className="row wrap">
            <button className="btn primary" disabled={busy || d.phase === 'syncing'} onClick={() => guard(d.sync)}><Icon n="up" size={18} />Sincronizar ahora</button>
            <button className="btn" disabled={busy} onClick={async () => { if (await ui.confirm('Se dejará de respaldar en Google Drive desde este dispositivo y se revocará el acceso. El archivo en tu Drive no se borra.', 'Desconectar')) await guard(d.disconnect) }}>Desconectar</button>
          </div>
        </>
      )}
    </section>
  )
}
