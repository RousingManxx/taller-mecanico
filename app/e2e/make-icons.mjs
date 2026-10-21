// Genera los iconos PNG de la PWA a partir de public/icon.svg usando Edge (Playwright).
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const svg = fs.readFileSync('public/icon.svg', 'utf8')
const b = await chromium.launch({ channel: 'msedge' })
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } })
  await p.setContent(`<body style="margin:0;background:#14202b"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`)
  await p.screenshot({ path: `public/${name}`, omitBackground: false })
  await p.close()
}
await b.close()
console.log('iconos generados')
