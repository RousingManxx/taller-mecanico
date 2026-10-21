// Taller nuevo y vacío: crea el taller por la interfaz y recorre todas las rutas buscando errores.
import { launch, hash } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:5170'
let fail = 0
for (const mobile of [false, true]) {
  const { browser, page, errors } = await launch({ mobile })
  await page.goto(base)
  await page.getByRole('button', { name: 'Crear mi taller' }).click()
  await page.getByLabel('Nombre del taller').fill('Taller Vacío Prueba')
  await page.getByLabel('Tu nombre (propietario)').fill('Dueña Prueba')
  await page.getByLabel('PIN (4 a 8 dígitos)').fill('2468'); await page.getByLabel('Repite el PIN').fill('2468')
  await page.getByRole('button', { name: 'Crear taller' }).click()
  await page.locator('.tabbar:visible, .sidebar:visible').first().waitFor()
  for (const r of ['/', '/guia', '/agenda', '/ordenes', '/cotizaciones', '/clientes', '/vehiculos', '/ventas', '/inventario', '/compras', '/rentabilidad', '/caja', '/gastos', '/cobranza', '/personal', '/reportes', '/reportes/estado_resultados', '/reportes/cxc', '/ajustes']) {
    await hash(page, base, r)
    const txt = await page.locator('main').innerText()
    if (/Something went wrong|undefined|NaN|\[object/.test(txt)) { console.log('CONTENIDO SOSPECHOSO en', r, txt.match(/.{20}(undefined|NaN|\[object).{20}/)?.[0]); fail++ }
  }
  console.log(mobile ? 'móvil' : 'escritorio', errors.length ? 'ERRORES:\n' + errors.join('\n') : 'sin errores de consola'); fail += errors.length
  await browser.close()
}
process.exit(fail ? 1 : 0)
