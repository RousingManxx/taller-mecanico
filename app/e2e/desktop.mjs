// Navegación de ESCRITORIO: barra superior alineada con el contenido, menús y búsqueda anclados a su botón (no modales ni pegados a la
// esquina), paneles con su ancho máximo; y que el MÓVIL siga igual (paneles y menús de esquina).
// Regresión: las acciones se amontonaban a la izquierda, los menús salían en el borde derecho de la ventana lejos de su botón y la
// búsqueda y las notificaciones abrían un panel a todo el ancho de la pantalla (una regla de CSS pisaba el límite de 680 px de `.sheet`).
// Uso: npx vite build ; npx vite preview --port 4173 ; node e2e/desktop.mjs
import { launch, startDemo, hash } from './helpers.mjs'

const base = process.argv[2] ?? 'http://localhost:4173'
const SHOTS = process.env.OUT
let failed = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); if (!ok) failed++ }
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol

const box = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } }, sel)
const shot = (page, name) => SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined

/* ───────────────────────── Escritorio ───────────────────────── */
{
  const { browser, page, errors } = await launch({ mobile: false })
  await startDemo(page, base)
  await hash(page, base, '/')
  await page.waitForTimeout(800)
  const pageBox = await box(page, '.main > .page')
  const search = await box(page, '.desk-top .search')
  const user = await box(page, '.desk-top .iconbtn[aria-label="Perfil de usuario"]')
  const bell = await box(page, '.desk-top .iconbtn[aria-label^=Notificaciones]')
  const nuevo = await box(page, '.desk-top .btn.primary')

  check('barra: el buscador empieza donde empieza el contenido', near(search.left, pageBox.left), `${search.left} vs ${pageBox.left}`)
  check('barra: las acciones terminan donde termina el contenido (a la derecha)', near(user.right, pageBox.right), `${user.right} vs ${pageBox.right}`)
  check('barra: orden Nuevo · campana · usuario, todos a la derecha del buscador', nuevo.left > search.right && bell.left > nuevo.right && user.left > bell.right)
  await shot(page, 'desk-0-barra')

  // Menú de usuario
  await page.locator('.desk-top .iconbtn[aria-label="Perfil de usuario"]').click()
  await page.waitForTimeout(350)
  const pm = await box(page, '.pop[role=menu]')
  check('usuario: el menú se abre', !!pm)
  if (pm) {
    check('usuario: el menú queda alineado al borde derecho de su botón', near(pm.right, user.right), `${pm.right} vs ${user.right}`)
    check('usuario: el menú queda justo debajo de su botón', near(pm.top, user.bottom + 8), `${pm.top} vs ${user.bottom + 8}`)
  }
  check('usuario: no es un modal (sin panel ni fondo que oscurezca)', (await page.locator('.sheet, .scrim').count()) === 0)
  await shot(page, 'desk-1-usuario')
  await page.locator('.desk-top .iconbtn[aria-label="Perfil de usuario"]').click()
  await page.waitForTimeout(200)
  check('usuario: tocar otra vez el botón cierra el menú', (await page.locator('.pop').count()) === 0)
  await page.locator('.desk-top .iconbtn[aria-label="Perfil de usuario"]').click()
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)
  check('usuario: Escape cierra el menú', (await page.locator('.pop').count()) === 0)
  await page.locator('.desk-top .iconbtn[aria-label="Perfil de usuario"]').click()
  await page.mouse.click(Math.round((search.right + nuevo.left) / 2), 35); await page.waitForTimeout(200) // hueco vacío de la barra
  check('usuario: un clic fuera cierra el menú', (await page.locator('.pop').count()) === 0)

  // Menú «Nuevo»
  await page.locator('.desk-top .btn.primary').click()
  await page.waitForTimeout(350)
  const nm = await box(page, '.pop[role=menu]')
  check('nuevo: el menú queda alineado al borde izquierdo de su botón y debajo', !!nm && near(nm.left, nuevo.left) && near(nm.top, nuevo.bottom + 8), nm ? `${nm.left}/${nm.top} vs ${nuevo.left}/${nuevo.bottom + 8}` : '')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  // Notificaciones
  await page.locator('.desk-top .iconbtn[aria-label^=Notificaciones]').click()
  await page.waitForTimeout(350)
  const am = await box(page, '.pop.listpop')
  check('notificaciones: se abren como desplegable anclado a la campana (no modal)', !!am && near(am.right, bell.right) && near(am.top, bell.bottom + 8) && (await page.locator('.sheet').count()) === 0, am ? `${am.right}/${am.top} vs ${bell.right}/${bell.bottom + 8}` : '')
  check('notificaciones: no ocupan todo el ancho de la pantalla', !!am && am.w <= 420, am ? `${am.w}px` : '')
  await shot(page, 'desk-2-notificaciones')
  await page.keyboard.press('Escape'); await page.waitForTimeout(200)

  // Búsqueda
  const input = page.locator('.desk-top .search input')
  await input.click()
  await page.waitForTimeout(250)
  check('búsqueda: al enfocar el campo no se abre ningún modal', (await page.locator('.sheet').count()) === 0)
  let term = ''
  for (const t of ['an', 'ma', 'or', 'de', 'ca']) {
    await input.fill(t); await page.waitForTimeout(350)
    if ((await page.locator('.pop.searchpop .item').count()) > 0) { term = t; break }
  }
  const sp = await box(page, '.pop.searchpop')
  check('búsqueda: al escribir salen resultados en un desplegable debajo del campo', !!term && !!sp, term ? `«${term}»` : 'sin resultados con ningún término')
  if (sp) {
    check('búsqueda: el desplegable empieza donde el campo y tiene su ancho', near(sp.left, search.left) && near(sp.w, search.w), `${sp.left}/${sp.w} vs ${search.left}/${search.w}`)
    check('búsqueda: el desplegable queda justo debajo del campo', near(sp.top, search.bottom + 8), `${sp.top} vs ${search.bottom + 8}`)
  }
  check('búsqueda: el campo conserva lo escrito mientras se ve el desplegable', (await input.inputValue()) === term)
  await shot(page, 'desk-3-busqueda')
  const before = await page.evaluate(() => location.hash)
  await input.press('Enter'); await page.waitForTimeout(500)
  check('búsqueda: Enter abre el primer resultado y cierra el desplegable', (await page.evaluate(() => location.hash)) !== before && (await page.locator('.pop').count()) === 0)
  check('búsqueda: tras elegir, el campo queda vacío', (await input.inputValue()) === '')
  await input.click(); await input.fill(term); await page.waitForTimeout(300)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  check('búsqueda: Escape cierra el desplegable y limpia el campo', (await page.locator('.pop').count()) === 0 && (await input.inputValue()) === '')

  // Paneles (Sheet): con su ancho máximo, no a todo el ancho
  await hash(page, base, '/inventario'); await page.waitForTimeout(1000)
  await page.locator('table.table tbody tr.click').first().click(); await page.waitForTimeout(600)
  const sh = await box(page, '.sheet')
  const vw = await page.evaluate(() => document.documentElement.clientWidth)
  check('paneles: un registro de inventario abre un panel con ancho acotado (no toda la ventana)', !!sh && sh.w <= 860 && sh.w < vw - 100, sh ? `${sh.w}px de ${vw}` : '')
  check('paneles: queda centrado', !!sh && near((sh.left + sh.right) / 2, vw / 2, 3))
  // Un panel que NO es «ancho» debe respetar su límite de 680 px (la regla anti-desbordamiento lo pisaba y salía a todo el ancho).
  const plain = await page.evaluate(() => {
    const wrap = document.createElement('div'); wrap.className = 'sheet-wrap'; wrap.style.visibility = 'hidden'
    wrap.innerHTML = '<div class="sheet"><div class="sheet-body">x</div></div>'; document.body.append(wrap)
    const w = Math.round(wrap.querySelector('.sheet').getBoundingClientRect().width); wrap.remove(); return w
  })
  check('paneles: uno que no es «ancho» respeta su límite de 680 px', plain <= 680 && plain > 300, `${plain}px`)
  check('escritorio: sin errores de consola/página', errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
}

/* ───────────────────────── Móvil: sigue igual ───────────────────────── */
{
  const { browser, page, errors } = await launch({ mobile: true })
  await startDemo(page, base)
  await hash(page, base, '/'); await page.waitForTimeout(600)
  await page.locator('.topbar .iconbtn[aria-label^=Notificaciones]').click(); await page.waitForTimeout(450)
  check('móvil: las notificaciones siguen abriendo un panel (Sheet)', (await page.locator('.sheet').count()) === 1 && (await page.locator('.pop').count()) === 0)
  await page.getByRole('button', { name: 'Cerrar' }).first().click(); await page.waitForTimeout(250)
  await page.locator('.topbar .iconbtn[aria-label="Buscar"]').click(); await page.waitForTimeout(450)
  check('móvil: la búsqueda sigue abriendo un panel con su campo', (await page.locator('.sheet').count()) === 1 && (await page.locator('.sheet input[type=search]').count()) === 1)
  await page.getByRole('button', { name: 'Cerrar' }).first().click(); await page.waitForTimeout(250)
  await page.locator('.topbar .iconbtn[aria-label="Acciones rápidas"]').click(); await page.waitForTimeout(350)
  check('móvil: el menú de acciones rápidas sigue saliendo de la esquina con fondo que cierra', (await page.locator('.menu.topleft').count()) === 1 && (await page.locator('.scrim').count()) === 1 && (await page.locator('.pop').count()) === 0)
  await page.keyboard.press('Escape'); await page.waitForTimeout(250)
  await hash(page, base, '/inventario'); await page.waitForTimeout(1000)
  await page.locator('.rcard').first().click(); await page.waitForTimeout(600)
  const ms = await box(page, '.sheet')
  const mw = await page.evaluate(() => document.documentElement.clientWidth)
  check('móvil: los paneles caben en la pantalla', !!ms && ms.left >= 0 && ms.right <= mw + 1, ms ? `${ms.left}–${ms.right} de ${mw}` : '')
  check('móvil: sin errores de consola/página', errors.length === 0, errors.slice(0, 2).join(' | '))
  await browser.close()
}

console.log(failed ? `\n${failed} comprobación(es) FALLARON` : '\nTodas las comprobaciones pasaron')
process.exit(failed ? 1 : 0)
