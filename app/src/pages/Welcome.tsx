import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { registry, type OrgRecord } from '../db/db'
import { createDemoOrganization } from '../db/demo'
import { ROLE_LABEL } from '../domain/permissions'
import { createOrganization, deleteDemoOrganizations, listLoginUsers, login, type LoginUser } from '../services/auth'
import type { Ctx } from '../services/core'
import { restoreAsNewOrganization } from '../services/backup'
import { Field, Icon, useUi } from '../ui/ui'

type Mode = 'home' | 'create' | 'login'

function Inner({ onStart }: { onStart: (c: Ctx) => void }) {
  const ui = useUi()
  const fileRef = useRef<HTMLInputElement>(null)
  const orgs = useLiveQuery(() => registry.orgs.toArray(), [])
  const [mode, setMode] = useState<Mode>('home')
  const [org, setOrg] = useState<OrgRecord | null>(null)
  const [users, setUsers] = useState<LoginUser[]>([])
  const [userId, setUserId] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ p: number; label: string } | null>(null)
  const [f, setF] = useState({ name: '', owner: '', pin: '', pin2: '' })

  if (!orgs) return <div className="main muted" role="status">Cargando…</div>
  const real = orgs.filter((o) => !o.demo), demos = orgs.filter((o) => o.demo)

  const choose = async (o: OrgRecord) => {
    const u = await listLoginUsers(o.id)
    setOrg(o); setUsers(u); setUserId(u[0]?.id ?? ''); setPin(''); setMode('login')
  }
  const doLogin = async () => {
    if (!org || busy) return
    setBusy(true)
    const c = await ui.run(() => login(org.id, userId, pin))
    setBusy(false)
    if (c) onStart(c)
    else setPin('')
  }
  const doCreate = async () => {
    if (busy) return
    if (f.pin !== f.pin2) { ui.toast('Los PIN no coinciden.', true); return }
    setBusy(true)
    const c = await ui.run(() => createOrganization({ name: f.name, ownerName: f.owner, pin: f.pin }))
    setBusy(false)
    if (c) onStart(c)
  }
  const doDemo = async () => {
    if (busy) return
    setBusy(true); setProgress({ p: 0, label: 'Preparando…' })
    const c = await ui.run(() => createDemoOrganization(40, (d, t, label) => setProgress({ p: t ? (d / t) * 100 : 0, label })))
    setBusy(false); setProgress(null)
    if (c) onStart(c)
  }
  const restore = async (f?: File) => {
    if (!f) return
    const r = await ui.run(async () => restoreAsNewOrganization(await f.text()), 'Taller restaurado: inicia sesión con tus usuarios y PIN de siempre')
    if (r) { const o = (await registry.orgs.get(r.orgId)); if (o) choose(o) }
  }
  const resetDemo = async () => {
    if (!(await ui.confirm('Se eliminarán SOLO los talleres de demostración (datos ficticios). Tus talleres reales no se tocan.', 'Eliminar demostración', true))) return
    const n = await ui.run(() => deleteDemoOrganizations())
    if (n !== undefined) ui.toast(`Demostración eliminada (${n})`)
  }

  return (
    <div className="main" style={{ maxWidth: 520, margin: '0 auto', paddingTop: 'calc(var(--sat) + 36px)' }}>
      <div className="stack-lg page">
        <div className="center stack-sm">
          <div className="row" style={{ justifyContent: 'center' }}><span className="iconbtn" style={{ background: 'var(--accent)', color: 'var(--on-accent)', width: 52, height: 52, borderRadius: 14 }}><Icon n="wrench" size={28} /></span></div>
          <h1>Torque</h1>
          <p className="muted">Gestión integral del taller mecánico: órdenes, inventario, costos y rentabilidad real.</p>
        </div>

        {mode === 'home' && (
          <div className="stack">
            {real.length > 0 && <h2>Tus talleres</h2>}
            {real.map((o) => <button key={o.id} className="item" onClick={() => choose(o)}><Icon n="wrench" /><div className="grow"><div className="ttl">{o.name}</div><div className="sub">Iniciar sesión</div></div><Icon n="chevron" size={16} /></button>)}
            {demos.map((o) => <button key={o.id} className="item" onClick={() => choose(o)}><Icon n="info" /><div className="grow"><div className="ttl">{o.name}</div><div className="sub">Demostración · datos ficticios · PIN de todos los usuarios: 1234</div></div><Icon n="chevron" size={16} /></button>)}
            <button className="btn primary block" onClick={() => setMode('create')}>{real.length ? 'Crear otro taller' : 'Crear mi taller'}</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => { restore(e.target.files?.[0]); e.target.value = '' }} />
            <button className="btn block" onClick={() => fileRef.current?.click()}>Restaurar taller desde una copia de seguridad</button>
            {!demos.length && !progress && <button className="btn block" onClick={doDemo} disabled={busy}>Explorar con datos de demostración</button>}
            {progress && <div className="card stack" role="status"><div className="small muted">{progress.label}</div><div className="bar"><span style={{ width: `${progress.p}%`, background: 'var(--accent)' }} /></div><div className="small muted">Generando un taller ficticio con órdenes, compras, pagos y gastos de varias semanas…</div></div>}
            {demos.length > 0 && <button className="btn danger block" onClick={resetDemo}>Reiniciar demostración (solo borra datos ficticios)</button>}
            <p className="small muted center">Tus datos se guardan en este dispositivo y funcionan sin conexión. Haz copias de seguridad desde Ajustes.</p>
          </div>
        )}

        {mode === 'create' && (
          <div className="card stack">
            <h2>Crea tu taller</h2>
            <Field label="Nombre del taller"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Taller Mecánico Los Pinos" autoFocus /></Field>
            <Field label="Tu nombre (propietario)"><input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} autoComplete="name" /></Field>
            <div className="grid2">
              <Field label="PIN (4 a 8 dígitos)"><input type="password" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" /></Field>
              <Field label="Repite el PIN"><input type="password" inputMode="numeric" value={f.pin2} onChange={(e) => setF({ ...f, pin2: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" /></Field>
            </div>
            <p className="small muted">El PIN protege el acceso en este dispositivo. Si lo olvidas, otro propietario puede restablecerlo; no hay recuperación por correo porque tus datos no salen de aquí.</p>
            <div className="row end"><button className="btn" onClick={() => setMode('home')}>Volver</button><button className="btn primary" disabled={busy || !f.name.trim() || !f.owner.trim() || f.pin.length < 4} onClick={doCreate}>Crear taller</button></div>
          </div>
        )}

        {mode === 'login' && org && (
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); doLogin() }}>
            <h2>{org.name}</h2>
            {org.demo && <div className="banner info">Taller de demostración · PIN de todos los usuarios: <b>1234</b></div>}
            <Field label="Usuario"><select value={userId} onChange={(e) => setUserId(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} — {ROLE_LABEL[u.role]}</option>)}</select></Field>
            <Field label="PIN"><input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus autoComplete="current-password" /></Field>
            <div className="row end"><button type="button" className="btn" onClick={() => setMode('home')}>Volver</button><button type="submit" className="btn primary" disabled={busy || pin.length < 4}>Entrar</button></div>
          </form>
        )}
      </div>
    </div>
  )
}

export const Welcome = Inner
