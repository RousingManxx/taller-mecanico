// Descarga los PDF reales desde la app (botón «Descargar PDF») y los renderiza con pdf.js para revisarlos.
// node e2e/docs.mjs <baseApp> <outDir> <baseDev>   (baseDev = servidor vite que sirve node_modules para pdf.js)
import { launch, startDemo, hash } from './helpers.mjs'
import fs from 'node:fs'
const [base = 'http://localhost:4173', out = 'e2e/out', dev = 'http://localhost:5170'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const { browser, ctx, page, errors } = await launch({ mobile: process.env.MOBILE === '1' })
await startDemo(page, base)
const hrefs = {}
await hash(page, base, '/ordenes')
await page.locator('table tbody tr.click, button.rcard').first().click(); await page.waitForTimeout(800)
for (const t of ['orden', 'recepcion', 'entrega', 'garantia']) { const h = await page.locator(`a[href*="#/imprimir/${t}/"]`).first().getAttribute('href').catch(() => null); if (h) hrefs[t] = h }
await hash(page, base, '/cotizaciones'); await page.locator('table tbody tr.click, button.rcard').first().click().catch(() => {}); await page.waitForTimeout(600)
const q = await page.locator('a[href*="#/imprimir/cotizacion/"]').first().getAttribute('href').catch(() => null); if (q) hrefs.cotizacion = q
await hash(page, base, '/ventas'); await page.locator('table tbody tr.click, button.rcard').first().click(); await page.waitForTimeout(600)
const v = await page.locator('a[href*="#/imprimir/venta/"]').first().getAttribute('href').catch(() => null); if (v) hrefs.venta = v
const files = {}
for (const [t, h] of Object.entries(hrefs)) {
  await page.goto(base + '/' + h); await page.waitForTimeout(900)
  if (t === 'cotizacion') await page.screenshot({ path: `${out}/${t}-pantalla.png` })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Descargar PDF/ }).click()])
  const f = `${out}/${t}.pdf`; await dl.saveAs(f); files[t] = f
  console.log('PDF descargado:', t, dl.suggestedFilename(), fs.statSync(f).size, 'bytes')
}
// Reportes: PDF de un reporte
await hash(page, base, '/reportes/estado_resultados'); await page.waitForTimeout(700)
const [rd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'PDF', exact: true }).click()])
await rd.saveAs(`${out}/reporte.pdf`); files.reporte = `${out}/reporte.pdf`; console.log('PDF descargado: reporte', rd.suggestedFilename())
// Render con pdf.js
const r = await ctx.newPage(); await r.goto(dev + '/manifest-x.html').catch(() => {}); await r.setContent('<!doctype html><html><body></body></html>')
for (const [t, f] of Object.entries(files)) {
  const b64 = fs.readFileSync(f).toString('base64')
  const png = await r.evaluate(async ([b64, dev]) => {
    const pdfjs = await import(dev + '/node_modules/pdfjs-dist/build/pdf.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = dev + '/node_modules/pdfjs-dist/build/pdf.worker.mjs'
    const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise
    const pg = await doc.getPage(1), vp = pg.getViewport({ scale: 1.4 }), c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
    return { url: c.toDataURL('image/png'), pages: doc.numPages }
  }, [b64, dev])
  fs.writeFileSync(`${out}/${t}-pdf.png`, Buffer.from(png.url.split(',')[1], 'base64')); console.log('renderizado', t, png.pages, 'página(s)')
}
console.log(errors.length ? errors.join('\n') : 'sin errores de consola')
await browser.close()
