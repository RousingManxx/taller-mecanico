// Genera 002_permissions.sql desde src/domain/permissions.ts para que la base y la app compartan los mismos permisos.
import { ROLE_PERMISSIONS } from '../src/domain/permissions.ts'
import fs from 'node:fs'
const rows = Object.entries(ROLE_PERMISSIONS).flatMap(([role, perms]) => perms.map((p) => `('${role}','${p}')`))
fs.writeFileSync(new URL('./002_permissions.sql', import.meta.url), `-- GENERADO por server/gen-permissions.mjs desde src/domain/permissions.ts. No editar a mano.\ninsert into role_permissions (role, permission) values\n${rows.join(',\n')}\non conflict do nothing;\n`)
console.log(rows.length, 'permisos generados')
