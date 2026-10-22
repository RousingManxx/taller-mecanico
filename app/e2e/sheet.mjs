// Los paneles (Sheet) deben quedar SOBRE la pantalla aunque la página esté desplazada, en teléfono y en escritorio.
// Regresión: la animación de entrada de `.page` (fill-mode `both`) volvía a la página el «marco» del `position: fixed`, y el panel de
// un registro de Inventario aparecía al fondo del contenido (había que bajar para verlo) y la página saltaba al enfocarlo.
// Uso: npx vite build ; npx vite preview --port 4173 ; node e2e/sheet.mjs
import { launch, startDemo, hash } from './helpers.mjs'

const base = process.argv[2] ?? 'http://localhost:4173'
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++ }

const geometry = (page) => page.evaluate(() => {
  const vh = window.innerHeight, wrap = document.querySelector('.sheet-wrap'), sheet = document.querySelector('.sheet')
  if (!wrap || !sheet) return null
  const w = wrap.getBoundingClientRect(), s = sheet.getBoundingClientRect(), scrim = document.querySelector('.sheet-wrap .scrim').getBoundingClientRect()
  return { vh, vw: window.innerWidth, scrollY: Math.round(window.scrollY), wrapTop: Math.round(w.top), wrapH: Math.round(w.height), sheetTop: Math.round(s.top), sheetBottom: Math.round(s.bottom), scrimH: Math.round(scrim.height), inBody: wrap.parentElement === document.body }
})

for (const mode of [{ name: 'teléfono', mobile: true }, { name: 'escritorio', mobile: false }]) {
  const { browser, page, errors } = await launch({ mobile: mode.mobile })
  await startDemo(page, base)
  await hash(page, base, '/inventario')
  await page.waitForTimeout(1200)
  const cards = mode.mobile ? page.locator('.rcard') : page.locator('table.table tbody tr.click')
  const n = await cards.count()
  const row = cards.nth(Math.min(6, n - 1))
  await row.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const before = await page.evaluate(() => Math.round(window.scrollY))
  await row.click()
  await page.waitForTimeout(700)
  const g = await geometry(page)
  check(`${mode.name}: al tocar un registro se abre el panel`, !!g)
  if (g) {
    check(`${mode.name}: el contenedor del panel cubre exactamente la pantalla (arriba=0, alto=alto de la pantalla)`, g.wrapTop === 0 && Math.abs(g.wrapH - g.vh) <= 1, `top ${g.wrapTop}, alto ${g.wrapH} de ${g.vh}`)
    check(`${mode.name}: el panel se ve completo sin desplazarse`, g.sheetTop >= 0 && g.sheetBottom <= g.vh + 1, `${g.sheetTop}–${g.sheetBottom} de ${g.vh}`)
    check(`${mode.name}: el fondo oscuro cubre toda la pantalla`, Math.abs(g.scrimH - g.vh) <= 1, `${g.scrimH} de ${g.vh}`)
    check(`${mode.name}: abrir el panel no desplaza la página de atrás`, g.scrollY === before, `${before} -> ${g.scrollY}`)
    check(`${mode.name}: el panel cuelga de body (no depende de ningún contenedor de la página)`, g.inBody)
    if (mode.mobile) check('teléfono: el panel queda pegado al borde inferior', Math.abs(g.sheetBottom - g.vh) <= 1, `${g.sheetBottom} de ${g.vh}`)
  }
  await page.getByRole('button', { name: 'Cerrar' }).first().click()
  await page.waitForTimeout(300)
  check(`${mode.name}: al cerrar desaparece el panel`, (await page.locator('.sheet').count()) === 0)
  check(`${mode.name}: sin errores de consola/página`, errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
}
console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodas las comprobaciones pasaron')
process.exit(failed ? 1 : 0)
