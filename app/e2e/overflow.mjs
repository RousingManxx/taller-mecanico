// Detecta desbordamiento horizontal en móvil (390 px) en todas las rutas y señala los elementos culpables.
import { launch, startDemo, hash } from './helpers.mjs'
const base = process.argv[2] ?? 'http://localhost:5170'
const routes = ['/', '/agenda', '/ordenes', '/cotizaciones', '/clientes', '/vehiculos', '/ventas', '/inventario', '/compras', '/rentabilidad', '/caja', '/gastos', '/cobranza', '/personal', '/reportes', '/reportes/estado_resultados', '/ajustes', '/guia']
const { browser, page } = await launch({ mobile: true })
await startDemo(page, base)
let bad = 0
const check = async (label) => {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth, over = document.documentElement.scrollWidth - W
    const els = [...document.querySelectorAll('body *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > W + 1 && !e.closest('.tablewrap, .seg, .chips, .kanban, .steps, [style*="overflow"]') && getComputedStyle(e).position !== 'fixed' })
    return { over, W, els: els.slice(0, 4).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} (${Math.round(e.getBoundingClientRect().right)}px) «${(e.textContent || '').trim().slice(0, 30)}»`) }
  })
  if (r.over > 0) { bad++; console.log('DESBORDA', label, `+${r.over}px`, r.els.join(' | ')) }
}
for (const r of routes) { await hash(page, base, r); await page.waitForTimeout(500); await check(r) }
// detalle de una orden y de una venta
await hash(page, base, '/ordenes'); await page.waitForTimeout(500)
const first = page.locator('a[href*="#/ordenes/"], button.rcard').first()
if (await first.count()) { await first.click(); await page.waitForTimeout(700); await check('detalle de orden') }
console.log(bad ? `${bad} pantalla(s) con desbordamiento` : 'sin desbordamiento horizontal')
await browser.close()
process.exit(bad ? 1 : 0)
