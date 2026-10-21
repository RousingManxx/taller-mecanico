import { launch, startDemo } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:4173'
const { browser, page, errors } = await launch()
const t0 = Date.now()
await startDemo(page, base)
console.log('demo creada en', ((Date.now() - t0) / 1000).toFixed(1), 's')
await page.screenshot({ path: process.env.OUT ? process.env.OUT + '/demo-home.png' : 'e2e/demo-home.png' })
console.log(errors.length ? errors.join('\n') : 'sin errores de consola')
await browser.close()
