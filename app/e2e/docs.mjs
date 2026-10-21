// Genera de verdad los PDF de los documentos (motor de impresión de Edge) para revisarlos: node e2e/docs.mjs <base> <outDir>
import { launch, startDemo, hash } from './helpers.mjs'
import fs from 'node:fs'
const [base = 'http://localhost:4173', out = 'e2e/out'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const { browser, page, errors } = await launch()
await startDemo(page, base)
const hrefs = {}
await hash(page, base, '/ordenes')
await page.locator('table tbody tr.click').first().click(); await page.waitForTimeout(800)
for (const t of ['orden', 'recepcion', 'entrega', 'garantia']) { const h = await page.locator(`a[href*="#/imprimir/${t}/"]`).first().getAttribute('href').catch(() => null); if (h) hrefs[t] = h }
await hash(page, base, '/cotizaciones'); await page.locator('table tbody tr.click').first().click().catch(() => {}); await page.waitForTimeout(600)
const q = await page.locator('a[href*="#/imprimir/cotizacion/"]').first().getAttribute('href').catch(() => null); if (q) hrefs.cotizacion = q
await hash(page, base, '/ventas'); await page.locator('table tbody tr.click').first().click(); await page.waitForTimeout(600)
const v = await page.locator('a[href*="#/imprimir/venta/"]').first().getAttribute('href').catch(() => null); if (v) hrefs.venta = v
for (const [t, h] of Object.entries(hrefs)) {
  await page.goto(base + '/' + h); await page.waitForTimeout(800)
  await page.pdf({ path: `${out}/${t}.pdf`, format: 'Letter', printBackground: true })
  await page.emulateMedia({ media: 'print' }); await page.screenshot({ path: `${out}/${t}.png`, fullPage: true }); await page.emulateMedia({ media: 'screen' })
  console.log('PDF generado:', t, fs.statSync(`${out}/${t}.pdf`).size, 'bytes')
}
console.log(errors.length ? errors.join('\n') : 'sin errores de consola')
await browser.close()
