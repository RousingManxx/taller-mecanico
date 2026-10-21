// PWA: service worker activo, manifest válido y arranque sin conexión sobre el build de producción.
import { launch } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:4173'
const { browser, ctx, page, errors } = await launch()
await page.goto(base); await page.waitForTimeout(2500); await page.reload(); await page.waitForTimeout(1500)
const sw = await page.evaluate(() => !!navigator.serviceWorker.controller)
const man = await page.evaluate(async () => { const r = await fetch(document.querySelector('link[rel=manifest]').href); return r.json() })
console.log('service worker controla la página:', sw, '| manifest:', man.name, man.display, man.icons.length, 'iconos')
await ctx.setOffline(true)
await page.reload(); await page.waitForTimeout(1500)
const txt = await page.locator('body').innerText()
console.log('sin conexión carga la app:', /Torque/.test(txt))
console.log(errors.length ? errors.join('\n') : 'sin errores de consola')
await browser.close()
process.exit(sw && /Torque/.test(txt) ? 0 : 1)
