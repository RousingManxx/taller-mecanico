// Formulario de nueva orden en móvil: ningún campo (incluida la fecha de entrega) debe ser más ancho que la hoja.
import { launch, startDemo, hash } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:4173'
const { browser, page } = await launch({ mobile: true })
await startDemo(page, base)
await hash(page, base, '/ordenes')
await page.getByRole('button', { name: /Nueva orden/ }).first().click()
await page.waitForTimeout(600)
const r = await page.evaluate(() => {
  const sheet = document.querySelector('.sheet-body'), sw = sheet.clientWidth
  const fields = [...sheet.querySelectorAll('input, select, textarea')].map((e) => ({ t: e.type || e.tagName, w: Math.round(e.getBoundingClientRect().width), r: Math.round(e.getBoundingClientRect().right) }))
  return { sw, scrollW: sheet.scrollWidth, docOver: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: fields.filter((f) => f.w > sw + 1 || f.r > document.documentElement.clientWidth + 1), n: fields.length, dt: fields.filter((f) => f.t.startsWith('date')) }
})
console.log(JSON.stringify(r))
await page.screenshot({ path: process.env.OUT ? process.env.OUT + '/orderform-m.png' : 'e2e/orderform-m.png' })
await browser.close()
process.exit(r.wide.length || r.scrollW > r.sw + 1 ? 1 : 0)
