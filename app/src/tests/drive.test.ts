import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createBackup } from '../services/backup'
import { saveUser, login } from '../services/auth'
import { saveCustomer } from '../services/customers'
import { BLOCKED, DriveError, blockDrive, checkRemote, driveFileName, getDriveState, isBlockingGoogleError, markDirty, pullRemote, setDriveEnabled, syncNow, trackChanges, unblockDrive, uploadBackup, type DriveEnv } from '../services/driveSync'
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

describe('Errores con código y Client ID revocado, eliminado o mal configurado', () => {
  it('cada fallo lleva un código para que la interfaz sepa qué ofrecer', async () => {
    const { ctx } = await world()
    const code = async (env: DriveEnv) => ((await syncNow(ctx, env).then(() => null, (x: unknown) => x)) as DriveError).code
    expect(await code({ token: async () => 't', fetch: (async () => { throw new TypeError('Failed to fetch') }) as typeof fetch })).toBe('offline')
    expect(await code({ token: async () => 't', fetch: (async () => new Response('{}', { status: 401 })) as typeof fetch })).toBe('session')
    expect(await code({ token: async () => 't', fetch: (async () => new Response('{}', { status: 403 })) as typeof fetch })).toBe('http')
    expect(await code(fakeDrive().env(async () => { throw new DriveError('reconnect', 'Reconecta Google Drive.') }))).toBe('reconnect')
    // los errores de Drive siguen siendo errores de negocio mostrables (UserError)
    expect(new DriveError('http', 'x')).toBeInstanceOf(Error)
    await expect(syncNow(ctx, { token: async () => 't', fetch: (async () => new Response('{}', { status: 403 })) as typeof fetch })).rejects.toThrow(/límite de uso/)
  })

  it('clasifica los errores de Google: solo los que invalidan la aplicación bloquean', () => {
    for (const e of ['invalid_client', 'unauthorized_client', 'deleted_client', 'disabled_client', 'invalid_request', 'invalid_scope', 'redirect_uri_mismatch', 'origin_mismatch']) expect(isBlockingGoogleError(e), e).toBe(true)
    for (const e of ['access_denied', 'popup_closed', 'popup_failed_to_open', 'immediate_failed', undefined, '']) expect(isBlockingGoogleError(e), String(e)).toBe(false)
  })

  it('un token bloqueado detiene la sincronización sin tocar los datos locales ni perder cambios', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    await saveCustomer(ctx, { name: 'Cliente Local', phone: '5551112222' })
    const d = fakeDrive()
    const revocado = d.env(async () => { throw new DriveError('blocked', BLOCKED, 'invalid_client') })
    const e = (await syncNow(ctx, revocado).then(() => null, (x: unknown) => x)) as DriveError
    expect(e.code).toBe('blocked'); expect(e.detail).toBe('invalid_client'); expect(e.message).toBe(BLOCKED)
    blockDrive(ctx.orgId, e.detail!)       // lo que hace la interfaz al recibir el error
    expect(getDriveState(ctx.orgId).blocked).toBe('invalid_client')
    expect(d.files.size).toBe(0)

    // la app sigue funcionando: datos intactos, cambios pendientes y copia manual disponible
    expect(await ctx.db.customers.count()).toBe(1)
    expect(getDriveState(ctx.orgId).dirty).toBe(true)
    expect((await createBackup(ctx)).tables.customers).toHaveLength(1)
  })

  it('reintentar tras corregir la configuración vuelve a subir y limpia el bloqueo', async () => {
    const { ctx } = await world()
    trackChanges(ctx)
    const d = fakeDrive()
    blockDrive(ctx.orgId, 'invalid_client')
    unblockDrive(ctx.orgId)
    expect(getDriveState(ctx.orgId).blocked).toBeUndefined()
    expect((await syncNow(ctx, d.env())).status).toBe('uploaded')
    expect(d.files.size).toBe(1)
  })

  it('el bloqueo es por taller y desconectar o volver a conectar lo limpia', async () => {
    const a = await world({ name: 'Taller A' }), b = await world({ name: 'Taller B' })
    blockDrive(a.ctx.orgId, 'deleted_client')
    expect(getDriveState(a.ctx.orgId).blocked).toBe('deleted_client')
    expect(getDriveState(b.ctx.orgId).blocked).toBeUndefined()
    setDriveEnabled(a.ctx.orgId, false)
    expect(getDriveState(a.ctx.orgId).blocked).toBeUndefined()
    blockDrive(a.ctx.orgId, 'deleted_client'); setDriveEnabled(a.ctx.orgId, true)
    expect(getDriveState(a.ctx.orgId).blocked).toBeUndefined()
  })
})

async function createBackupText(ctx: Parameters<typeof createBackup>[0]): Promise<string> {
  return JSON.stringify(await createBackup(ctx, { touch: false }))
}
