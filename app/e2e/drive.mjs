// E2E del respaldo en Google Drive con Google y Drive SIMULADOS (no toca ninguna cuenta real). Usa Edge (Playwright) y el taller de demostración.
// Requiere un build con un Client ID cualquiera:
//   $env:VITE_GOOGLE_CLIENT_ID='prueba.apps.googleusercontent.com'; npx vite build ; npx vite preview --port 4173 ; node e2e/drive.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, startDemo } from './helpers.mjs'

const BASE = process.argv[2] ?? 'http://localhost:4173'
const { browser, ctx: ctxA, page: A, errors } = await launch()
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++ }

/* Google simulado. Modos: ok | revoked (Client ID revocado) | needs-click (la ventana solo se permite con un clic reciente y el acceso siempre queda «viejo»). */
const GIS = (mode) => {
  window.__gis = { mode }
  window.google = { accounts: { oauth2: {
    initTokenClient: (c) => ({ requestAccessToken: () => setTimeout(() => {
      const m = window.__gis.mode
      if (m === 'revoked') return c.callback({ error: 'invalid_client' })
      if (m === 'needs-click' && !navigator.userActivation.isActive) return c.error_callback({ type: 'popup_failed_to_open' })
      c.callback({ access_token: 'tok', expires_in: m === 'needs-click' ? 200 : 3600 })
    }, 10) }),
    revoke() {},
  } } }
}

/* Drive simulado y compartido por los «dispositivos» de la misma cuenta. */
const drive = { files: new Map(), n: 0, calls: 0 }
const meta = (f) => ({ id: f.id, version: String(f.version), modifiedTime: new Date().toISOString(), appProperties: f.appProperties })
async function route(r) {
  const req = r.request(), url = new URL(req.url()), m = req.method()
  const cors = { 'access-control-allow-origin': '*' }
  const ok = (b) => r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(b) })
  if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
  drive.calls++
  if (url.pathname.startsWith('/upload/')) {
    const body = req.postData() ?? '', b = body.slice(2, body.indexOf('\r\n'))
    const [mt, ct] = body.split('--' + b).slice(1, 3).map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''))
    const id = m === 'POST' ? 'f' + ++drive.n : url.pathname.split('/').pop()
    const prev = drive.files.get(id)
    const f = { id, name: m === 'POST' ? JSON.parse(mt).name : prev.name, version: (prev?.version ?? 0) + 1, appProperties: JSON.parse(mt).appProperties, content: ct }
    drive.files.set(id, f)
    return ok(meta(f))
  }
  if (url.pathname === '/drive/v3/files') return ok({ files: [...drive.files.values()].map(meta) })
  const f = drive.files.get(url.pathname.split('/').pop())
  if (!f) return r.fulfill({ status: 404, headers: cors, body: '{}' })
  return url.searchParams.get('alt') === 'media' ? r.fulfill({ status: 200, headers: cors, body: f.content }) : ok(meta(f))
}
const only = () => [...drive.files.values()][0]

/** Un «dispositivo»: contexto de navegador propio (almacenamiento aparte) con Google simulado en el modo indicado. */
async function device(mode = 'ok') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'es-MX', timezoneId: 'America/Mexico_City' })
  await ctx.addInitScript(GIS, mode)
  await ctx.route('https://www.googleapis.com/**', route)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
  return { ctx, page }
}
await ctxA.addInitScript(GIS, 'ok'); await ctxA.route('https://www.googleapis.com/**', route)

const waitVersion = async (p, v) => { for (let i = 0; i < 40 && (only()?.version ?? 0) < v; i++) await p.waitForTimeout(250); return only()?.version }
const addCustomer = async (p, name) => {
  await p.goto(BASE + '/#/clientes')
  await p.getByRole('button', { name: 'Nuevo cliente' }).click()
  await p.getByLabel('Nombre o razón social *').fill(name)
  await p.getByRole('button', { name: 'Guardar cliente' }).click()
  await p.getByText(name).first().waitFor()
}
const hasCustomer = async (p, name) => { await p.goto(BASE + '/#/clientes'); return p.getByText(name).first().waitFor({ timeout: 8000 }).then(() => true, () => false) }
const hasText = (p, t, ms = 8000) => p.getByText(t).first().waitFor({ timeout: ms }).then(() => true, () => false)
const owner = async (p) => {
  const sel = p.getByLabel('Usuario')
  const v = await sel.evaluate((e) => [...e.options].find((o) => o.text.startsWith('Propietario Demo')).value)
  await sel.selectOption(v); await p.getByLabel('PIN').fill('1234'); await p.getByRole('button', { name: 'Entrar' }).click()
  await p.locator('.tabbar:visible, .sidebar:visible').first().waitFor()
}
const loginB = async (p) => { await p.goto(BASE); await p.getByRole('button', { name: /Taller Demo/ }).first().click(); await owner(p) }

/* ── Dispositivo A: conectar y primer respaldo ───────────────────────────── */
await startDemo(A, BASE)
await A.goto(BASE + '/#/ajustes')
check('A: la sección de Drive aparece con Client ID', await A.getByRole('button', { name: /Conectar Google Drive/ }).count() === 1)
await A.getByRole('button', { name: /Conectar Google Drive/ }).click()
await A.getByText(/todo respaldado/).waitFor({ timeout: 20000 })
check('A: primer respaldo subido', drive.files.size === 1 && only().version === 1)
const name1 = only().name
check('A: nombre fijo torque-<taller>-<id>.json', /^torque-taller-demo-datos-ficticios-[0-9a-f]{8}\.json$/.test(name1), name1)

await addCustomer(A, 'Cliente Prueba A1')
await A.goto(BASE + '/#/ajustes')
check('A: tras el cambio dice "hay cambios por subir"', await A.getByText(/hay cambios por subir/).count() === 1)
await A.getByRole('button', { name: /Sincronizar ahora/ }).click()
check('A: sincronizar actualiza el MISMO archivo (v2, un solo archivo)', await waitVersion(A, 2) === 2 && drive.files.size === 1 && only().name === name1)
check('A: el archivo contiene el cliente nuevo', only().content.includes('Cliente Prueba A1'))
await A.getByText(/todo respaldado/).waitFor()

/* ── Dispositivo B: otro navegador, restaura el JSON de Drive ────────────── */
const copia = path.join(os.tmpdir(), 'torque-copia-drive.json')
fs.writeFileSync(copia, only().content)
const { page: B } = await device()
await B.goto(BASE)
await B.locator('input[type=file]').setInputFiles(copia)
await B.getByText(/Taller restaurado/).waitFor({ timeout: 30000 })
await owner(B)
check('B: restauró el taller desde el JSON de Drive (tiene a A1)', await hasCustomer(B, 'Cliente Prueba A1'))
await B.goto(BASE + '/#/ajustes')
await B.getByRole('button', { name: /Conectar Google Drive/ }).click()
await B.getByText(/tienen cambios distintos/).waitFor({ timeout: 20000 })
check('B: dispositivo nuevo con datos y archivo existente -> aviso de conflicto, sin pisar Drive', only().version === 2)
await B.getByRole('button', { name: 'Usar la de Drive' }).click()
await B.getByRole('button', { name: 'Traer de Drive' }).click()
await B.getByRole('button', { name: /Restaurar taller desde una copia/ }).waitFor({ timeout: 20000 })
await loginB(B)
await B.goto(BASE + '/#/ajustes')
await B.getByText(/todo respaldado/).waitFor({ timeout: 20000 })
check('B: "Usar la de Drive" restauró y quedó en sincronía, sin avisos', await B.getByText(/Hay una copia más nueva|tienen cambios distintos/).count() === 0)

/* ── A cambia y sube; B se entera ────────────────────────────────────────── */
await addCustomer(A, 'Cliente Prueba A2')
await A.goto(BASE + '/#/ajustes')
await A.getByRole('button', { name: /Sincronizar ahora/ }).click()
check('A: segundo cambio sube a v3', await waitVersion(A, 3) === 3)
await B.reload()
check('B: al abrir avisa "copia más nueva en Google Drive"', await hasText(B, /Hay una copia más nueva en Google Drive/, 20000))
await B.getByRole('button', { name: 'Ahora no' }).click()
check('B: "Ahora no" oculta el aviso', await B.getByText(/Hay una copia más nueva/).count() === 0)
await B.reload()
await B.getByText(/Hay una copia más nueva en Google Drive/).waitFor({ timeout: 20000 })
await B.getByRole('button', { name: 'Traer la copia de Drive' }).click()
await B.getByRole('button', { name: 'Traer de Drive' }).click()
await B.getByRole('button', { name: /Restaurar taller desde una copia/ }).waitFor({ timeout: 20000 })
await loginB(B)
check('B: tras "Traer", ya tiene el cliente A2', await hasCustomer(B, 'Cliente Prueba A2'))
check('Drive: nada se pisó (v3, un solo archivo)', only().version === 3 && drive.files.size === 1)

/* ── Desconectar ─────────────────────────────────────────────────────────── */
await A.goto(BASE + '/#/ajustes')
await A.getByRole('button', { name: 'Desconectar' }).click()
await A.getByRole('button', { name: 'Desconectar' }).last().click()
await A.getByRole('button', { name: /Conectar Google Drive/ }).waitFor()
check('A: desconectar vuelve al estado inicial y el archivo de Drive no se borra', drive.files.size === 1)

/* ── Client ID revocado ──────────────────────────────────────────────────── */
drive.files.clear() // otra persona con su propia cuenta de Google y su propio Drive
const callsAntes = drive.calls
const { page: C } = await device('revoked')
await startDemo(C, BASE)
await C.goto(BASE + '/#/ajustes')
await C.getByRole('button', { name: /Conectar Google Drive/ }).click()
check('C (Client ID revocado): avisa que el respaldo está inhabilitado', await hasText(C, /Respaldo en Drive inhabilitado/, 10000))
check('C: no hubo ninguna petición a Drive', drive.calls === callsAntes)
await C.goto(BASE + '/#/clientes')
check('C: la app y sus datos siguen funcionando', await hasText(C, 'Clientes'))
await C.goto(BASE + '/#/ajustes')
check('C: sigue disponible la copia manual', await C.getByRole('button', { name: /Descargar copia/ }).count() === 1)
await C.evaluate(() => { window.__gis.mode = 'ok' }) // «se corrigió la configuración»
await C.getByRole('button', { name: /Reintentar/ }).click()
check('C: tras corregir, "Reintentar" conecta y respalda', await hasText(C, /todo respaldado/, 20000) && drive.files.size === 1)

/* ── Renovación del acceso con un clic ───────────────────────────────────── */
drive.files.clear()
const { page: E } = await device('needs-click')
await startDemo(E, BASE)
await E.goto(BASE + '/#/ajustes')
await E.getByRole('button', { name: /Conectar Google Drive/ }).click()
check('E: el primer respaldo se sube (la ventana se permite justo tras el clic)', await hasText(E, /todo respaldado/, 20000) && drive.files.size === 1 && only().version === 1)
await addCustomer(E, 'Cliente Prueba E')
// OJO: Playwright ejecuta sus consultas (count, waitFor…) como un gesto del usuario y mantendría viva la «activación», así que se
// espera pasivamente (sin sondear) a que venza el minuto de espera y falle la renovación automática.
await E.waitForTimeout(68000)
check('E: con la ventana bloqueada sin clic aparece el aviso de renovar', await hasText(E, /necesita renovar el acceso/, 5000))
check('E: mientras tanto el cambio sigue sin subirse', only().version === 1)
await E.mouse.click(600, 500) // un clic cualquiera, no en el aviso
await E.waitForFunction(() => !document.body.innerText.includes('necesita renovar el acceso'), null, { timeout: 15000 }).catch(() => {})
check('E: un clic cualquiera renueva el acceso y sube el cambio pendiente (v2)', await waitVersion(E, 2) === 2 && only().content.includes('Cliente Prueba E'))

// Los 404 son esperados: al vaciar el Drive simulado, un dispositivo pregunta por un archivo que ya no existe y la app lo tolera.
const real = errors.filter((e) => !/status of 404/.test(e))
check('sin errores de consola/página', real.length === 0, real.slice(0, 3).join(' | '))
await browser.close()
console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodas las comprobaciones pasaron')
process.exit(failed ? 1 : 0)
