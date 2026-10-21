// Utilidades E2E compartidas (Playwright + Edge). Uso: import { launch, startDemo, login } from './helpers.mjs'
import { chromium } from 'playwright-core'

export async function launch({ mobile = false, scheme = 'light' } = {}) {
  const browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 800 } : { width: 1280, height: 800 },
    deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, locale: 'es-MX', timezoneId: 'America/Mexico_City',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
  return { browser, ctx, page, errors }
}

/** Crea el taller de demostración (datos ficticios) desde la pantalla de bienvenida y entra como propietario. */
export async function startDemo(page, base) {
  await page.goto(base)
  await page.getByRole('button', { name: /Explorar con datos de demostración/ }).click()
  await page.getByRole('button', { name: /Taller Demo/ }).waitFor({ timeout: 180000 }).catch(() => {})
  await page.waitForSelector('text=Tus datos se guardan', { timeout: 5000 }).catch(() => {})
  // Tras generar, la app inicia sesión sola como propietario demo.
  await page.locator('.tabbar:visible, .sidebar:visible').first().waitFor({ timeout: 180000 })
}

/** Inicia sesión en un taller existente: elige el taller, el usuario (por texto) y el PIN. */
export async function login(page, base, { org, user, pin }) {
  await page.goto(base)
  await page.getByRole('button', { name: new RegExp(org) }).first().click()
  await page.getByLabel('Usuario').selectOption({ label: user })
  await page.getByLabel('PIN').fill(pin)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.locator('.tabbar:visible, .sidebar:visible').first().waitFor()
}
export const hash = async (page, base, route) => { await page.goto(`${base}/#${route}`); await page.waitForTimeout(400) }
