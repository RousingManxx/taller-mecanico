import { audit, fail, getSettings, load, need, stamp, tx, uid, type Ctx } from './core'
import { derive, hashPin, validatePin } from './auth'

/** Logotipo del taller (imagen pequeña ya comprimida por la interfaz). */
export async function setLogo(ctx: Ctx, f: { name: string; mime: string; dataUrl: string } | null): Promise<void> {
  need(ctx, 'config.editar')
  if (f && !/^data:image\/(png|jpeg|webp);base64,/.test(f.dataUrl)) fail('Formato no permitido (usa JPG, PNG o WebP).')
  if (f && f.dataUrl.length > 600_000) fail('El logotipo es demasiado grande (máximo ≈ 400 KB).')
  await tx(ctx, async () => {
    const s = await getSettings(ctx)
    if (s.logoId) await ctx.db.attachments.delete(s.logoId)
    let logoId: string | undefined
    if (f) { logoId = uid(); await ctx.db.attachments.add({ id: logoId, orgId: ctx.orgId, ownerType: 'config', ownerId: 'logo', name: f.name, mime: f.mime, size: f.dataUrl.length, dataUrl: f.dataUrl, createdAt: stamp(ctx) }) }
    await ctx.db.settings.put({ ...s, logoId, updatedAt: stamp(ctx) })
    await audit(ctx, f ? 'configuracion.logo_cambiado' : 'configuracion.logo_quitado', 'configuracion', 'main')
  })
}

/** Cada usuario puede cambiar su propio PIN comprobando el actual. */
export async function changeOwnPin(ctx: Ctx, currentPin: string, newPin: string): Promise<void> {
  validatePin(newPin)
  const u = await ctx.db.users.get(ctx.user.id)
  if (!u || u.orgId !== ctx.orgId) return fail('Usuario no disponible.')
  if ((await derive(currentPin, u.pinSalt)) !== u.pinHash) fail('El PIN actual no es correcto.')
  const pin = await hashPin(newPin)
  await tx(ctx, async () => {
    const cur = await load(ctx, ctx.db.users, u.id, 'El usuario')
    await ctx.db.users.put({ ...cur, ...pin, updatedAt: stamp(ctx) })
    await audit(ctx, 'usuario.pin_cambiado', 'usuario', u.id)
  })
}
