// Genera docs/GUIA-DE-USO.md desde src/ui/helpContent.ts (misma fuente que la pantalla Ayuda de la app).
import { HELP } from '../src/ui/helpContent.ts'
import fs from 'node:fs'
let md = '# Torque — guía de uso\n\n> Generado desde `src/ui/helpContent.ts` (la misma guía está dentro de la app, en el menú del perfil → Guía de uso).\n\n'
for (const s of HELP) {
  md += `## ${s.title}\n\n`
  for (const b of s.blocks) { if (b.h) md += `**${b.h}**\n\n`; if (b.p) md += `${b.p}\n\n`; if (b.list) md += b.list.map((x) => `- ${x}`).join('\n') + '\n\n' }
}
fs.writeFileSync(new URL('./GUIA-DE-USO.md', import.meta.url), md)
console.log('GUIA-DE-USO.md generada')
