import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup } from '../services/backup'
import { saveUser, login } from '../services/auth'
import { saveCustomer } from '../services/customers'
import { checkRemote, driveFileName, getDriveState, markDirty, pullRemote, setDriveEnabled, syncNow, trackChanges, uploadBackup, type DriveEnv } from '../services/driveSync'
import { world } from './helpers'

interface FakeFile { id: string; name: string; content: string; appProperties: Record<string, string>; version: number; modifiedTime: string; trashed: boolean }

/** Drive simulado en memoria: solo lo que usa el servicio (buscar, metadatos, descargar, subir multipart). */
function fakeDrive() {
  const files = new Map<string, FakeFile>()
  let n = 0, tick = 0
  const calls: string[] = []
  const meta = (f: FakeFile) => ({ id: f.id, version: String(f.version), modifiedTime: f.modifiedTime, trashed: f.trashed, appProperties: f.appProperties })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
  const parts = (body: string) => {
    const boundary = body.slice(2, body.indexOf('\r\n'))
    const [m, c] = body.split(`--${boundary}`).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
    return { meta: JSON.parse(m), content: c }
  }
  const env = (token: () => Promise<string> = async () => 'tok'): DriveEnv => ({
    token,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)), method = init?.method ?? 'GET'
      calls.push(`${method} ${url.pathname}`)
      const id = url.pathname.split('/').pop()!
      if (url.pathname.startsWith('/upload/')) {
        const p = parts(String(init!.body))
        if (method === 'POST') {
          const f: FakeFile = { id: `f${++n}`, name: p.meta.name, content: p.content, appProperties: p.meta.appProperties, version: 1, modifiedTime: `t${++tick}`, trashed: false }
          files.set(f.id, f); return json(meta(f))
        }
        const f = files.get(id); if (!f) return json({}, 404)
        f.content = p.content; f.appProperties = p.meta.appProperties; f.version++; f.modifiedTime = `t${++tick}`
        return json(meta(f))
      }
      if (id === 'files') {
        const org = /value='([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1]
        return json({ files: [...files.values()].filter((f) => !f.trashed && f.appProperties.orgId === org).slice(0, 1).map(meta) })
      }
      const f = files.get(id); if (!f) return json({}, 404)
      return url.searchParams.get('alt') === 'media' ? new Response(f.content) : json(meta(f))
    }) as typeof fetch,
  })
  /** Otro dispositivo modifica el archivo directamente en Drive. */
  const editRemote = (id: string, content: string, deviceId = 'otro') => { const f = files.get(id)!; f.content = content; f.version++; f.modifiedTime = `t${++tick}`; f.appProperties = { ...f.appProperties, deviceId } }
  return { files, env, calls, editRemote }
}

describe('Respaldo en Google Drive', () => {
  it('sube con nombre fijo, actualiza el mismo archivo y no vuelve a subir sin cambios', async () => {
    const { ctx } = await world({ name: 'Taller Ñandú' })
    trackChanges(ctx)
    const d = fakeDrive(), env = d.env()
    expect((await checkRemote(ctx, env)).status).toBe('none')

    const first = await syncNow(ctx, env)
    expect(first.status).toBe('uploaded')
    expect(d.files.size).toBe(1)
    const f = [...d.files.values()][0]
    expect(f.name).toBe(driveFileName('Taller Ñandú', ctx.orgId)); expect(f.name).toMatch(/^torque-taller-nandu-[0-9a-f]{8}\.json$/)
    expect(f.appProperties.orgId).toBe(ctx.orgId)
    expect(getDriveState(ctx.orgId).dirty).toBe(false)

    // sin cambios: nada que hacer y sin subir
    d.calls.length = 0
    expect((await syncNow(ctx, env)).status).toBe('idle')
    expect(d.calls.some((c) => c.startsWith('PATCH') || c.startsWith('POST'))).toBe(false)

    // un cambio local marca pendiente y la siguiente sincronización actualiza el MISMO archivo
    await saveCustomer(ctx, { name: 'Cliente Nuevo', phone: '5550001111' })
    expect(getDriveState(ctx.orgId).dirty).toBe(true)
    expect((await syncNow(ctx, env)).status).toBe('uploaded')
    expect(d.files.size).toBe(1)
    const g = [...d.files.values()][0]
    expect(g.id).toBe(f.id); expect(g.name).toBe(f.name); expect(g.version).toBe(2)
    expect(JSON.parse(g.content).tables.customers.map((c: { name: string }) => c.name)).toContain('Cliente Nuevo')
    expect(getDriveState(ctx.orgId).dirty).toBe(false)
  })

  it('las subidas automáticas no cuentan como copia manual (lastBackupAt)', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive()
    await syncNow(ctx, d.env())
    expect((await ctx.db.settings.get('main'))!.lastBackupAt).toBeUndefined()
    await createBackup(ctx)
    expect((await ctx.db.settings.get('main'))!.lastBackupAt).toBeDefined()
  })

  it('no pisa una versión de Drive desconocida: conflicto, y solo "forzar" sobrescribe', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive(), env = d.env()
    await syncNow(ctx, env)
    const id = [...d.files.keys()][0]
    d.editRemote(id, (await createBackupText(ctx)))   // otro dispositivo subió algo
    await saveCustomer(ctx, { name: 'Local', phone: '5552223333' })

    const c = await checkRemote(ctx, env)
    expect(c.status).toBe('conflict')
    const before = d.files.get(id)!.version
    const u = await uploadBackup(ctx, env)
    expect(u.status).toBe('conflict'); expect(d.files.get(id)!.version).toBe(before)
    expect((await syncNow(ctx, env)).status).toBe('conflict')

    expect((await uploadBackup(ctx, env, { force: true })).status).toBe('uploaded')
    expect(d.files.get(id)!.version).toBe(before + 1)
    expect((await checkRemote(ctx, env)).status).toBe('in-sync')
  })

  it('avisa de versión más nueva (sin cambios locales) y "traer" la combina conservando lo local', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive(), env = d.env()
    await syncNow(ctx, env)
    const id = [...d.files.keys()][0]
    // otro dispositivo agrega un cliente y sube
    const remoteFile = JSON.parse(await createBackupText(ctx))
    remoteFile.tables.customers.push({ id: 'remoto-1', orgId: ctx.orgId, name: 'Cliente Remoto', phone: '5554445555', active: true, createdAt: remoteFile.createdAt, updatedAt: remoteFile.createdAt })
    d.editRemote(id, JSON.stringify(remoteFile))

    const c = await checkRemote(ctx, env)
    expect(c.status).toBe('remote-newer')
    expect(await syncNow(ctx, env)).toMatchObject({ status: 'remote-newer' }) // no sube ni pisa
    expect(d.files.get(id)!.version).toBe(2)

    const r = await pullRemote(ctx, env, 'combinar')
    expect(r.added).toBe(1)
    expect(await ctx.db.customers.get('remoto-1')).toBeDefined()
    // el aviso desaparece y lo combinado queda pendiente de subir (Drive aún no lo tiene idéntico)
    expect(getDriveState(ctx.orgId).version).toBe('2')
    expect((await checkRemote(ctx, env)).status).toBe('local-ahead')
    expect((await syncNow(ctx, env)).status).toBe('uploaded')
    expect((await checkRemote(ctx, env)).status).toBe('in-sync')
  })

  it('un dispositivo nuevo que ya tiene datos ve conflicto, no sobrescribe a ciegas', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive(), env = d.env()
    await syncNow(ctx, env)
    setDriveEnabled(ctx.orgId, false) // equivale a otro dispositivo: no conoce el id ni la versión de Drive
    expect((await checkRemote(ctx, env)).status).toBe('conflict')
    expect((await uploadBackup(ctx, env)).status).toBe('conflict')
    expect(d.files.size).toBe(1)
  })

  it('recrea el archivo si se borró de Drive y tolera que el id guardado ya no exista', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive(), env = d.env()
    await syncNow(ctx, env)
    d.files.clear()
    markDirty(ctx.orgId)
    expect((await syncNow(ctx, env)).status).toBe('uploaded')
    expect(d.files.size).toBe(1)
  })

  it('errores comprensibles: sin conexión, sesión vencida y token', async () => {
    const { ctx } = await world()
    const down: DriveEnv = { token: async () => 't', fetch: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch }
    await expect(syncNow(ctx, down)).rejects.toThrow(/No hay conexión/)
    const expired: DriveEnv = { token: async () => 't', fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch }
    await expect(syncNow(ctx, expired)).rejects.toThrow(/vuelve a conectar/)
    const d = fakeDrive()
    await expect(syncNow(ctx, d.env(async () => { throw new Error('Reconecta Google Drive.') }))).rejects.toThrow(/Reconecta Google Drive/)
    const denied: DriveEnv = { token: async () => 't', fetch: (async () => new Response('{}', { status: 403 })) as typeof fetch }
    await expect(syncNow(ctx, denied)).rejects.toThrow(/403/)
  })

  it('un usuario sin permiso no puede consultar, subir ni traer', async () => {
    const { ctx, clk } = await world()
    const uid = await saveUser(ctx, { name: 'Rita', role: 'recepcion', pin: '4321' })
    const rec = await login(ctx.orgId, uid, '4321', () => clk.t)
    const env = fakeDrive().env()
    await expect(checkRemote(rec, env)).rejects.toThrow(/No tienes permiso/)
    await expect(uploadBackup(rec, env)).rejects.toThrow(/No tienes permiso/)
    await expect(pullRemote(rec, env, 'combinar')).rejects.toThrow(/No tienes permiso/)
  })

  it('traer sin copia en Drive o con archivo ajeno/dañado falla con mensaje claro', async () => {
    const { ctx } = await world()
    const d = fakeDrive(), env = d.env()
    await expect(pullRemote(ctx, env, 'combinar')).rejects.toThrow(/No hay ninguna copia/)
    await syncNow(ctx, env)
    d.editRemote([...d.files.keys()][0], '{no es json')
    await expect(pullRemote(ctx, env, 'combinar')).rejects.toThrow(/JSON/)
  })
})

async function createBackupText(ctx: Parameters<typeof createBackup>[0]): Promise<string> {
  return JSON.stringify(await createBackup(ctx, { touch: false }))
}
