// Captura pantallas de una o varias rutas con la demostración: node e2e/shot.mjs <base> <outDir> /ruta1 /ruta2 ...
import { launch, startDemo, hash } from './helpers.mjs'
import fs from 'node:fs'
const [base, out, ...routes] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
for (const mobile of [false, true]) {
  const { browser, page, errors } = await launch({ mobile })
  await startDemo(page, base)
  for (const r of routes) {
    await hash(page, base, r); await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/${(mobile ? 'm' : 'd')}${r.replace(/[^\w]+/g, '_')}.png`, fullPage: true })
  }
  console.log(mobile ? 'móvil' : 'escritorio', errors.length ? errors.join('\n') : 'sin errores de consola')
  await browser.close()
}
