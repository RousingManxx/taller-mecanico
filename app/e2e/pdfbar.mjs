// La barra de acciones del documento debe caber en 390 px (nada cortado a la derecha).
import { launch, startDemo, hash } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:4173'
const { browser, page } = await launch({ mobile: true })
await startDemo(page, base)
await hash(page, base, '/cotizaciones'); await page.locator('button.rcard').first().click(); await page.waitForTimeout(600)
const h = await page.locator('a[href*="#/imprimir/cotizacion/"]').first().getAttribute('href'); await page.goto(base + '/' + h); await page.waitForTimeout(800)
const r = await page.evaluate(() => { const W = document.documentElement.clientWidth; return [...document.querySelectorAll('.pdfbar .btn')].map((b) => ({ t: b.textContent.trim(), right: Math.round(b.getBoundingClientRect().right), W })) })
console.log(JSON.stringify(r)); await browser.close()
process.exit(r.some((x) => x.right > x.W) ? 1 : 0)
