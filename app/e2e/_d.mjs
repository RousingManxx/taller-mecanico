import { launch } from './helpers.mjs'
const { browser, page, errors } = await launch({ mobile: true })
await page.goto('http://localhost:5170'); await page.getByRole('button', { name: /Explorar con datos/ }).click(); await page.waitForTimeout(9000)
console.log(await page.evaluate(() => ({ tab: !!document.querySelector('.tabbar'), vis: document.querySelector('.tabbar')?.getBoundingClientRect().toJSON(), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })), errors.slice(0,3))
await page.screenshot({ path: 'e2e/_d.png' }); await browser.close()
