/** Reduce una foto (máx. 1280 px, JPEG 0.72) antes de guardarla en el dispositivo. Devuelve un data URL listo para `attachPhoto`. */
export async function compressImage(file: File, maxSide = 1280, quality = 0.72): Promise<{ name: string; mime: string; dataUrl: string }> {
  if (file.type === 'application/pdf') {
    const dataUrl = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('No se pudo leer el archivo.')); r.readAsDataURL(file) })
    return { name: file.name, mime: file.type, dataUrl }
  }
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error('No se pudo leer la imagen.')
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', dataUrl: c.toDataURL('image/jpeg', quality) }
}
/** Carga una imagen guardada (attachments) para mostrarla. */
import { useLiveQuery } from 'dexie-react-hooks'
import type { Ctx } from '../services/core'
export function useAttachments(ctx: Ctx, ids: string[]) {
  return useLiveQuery(async () => ((await ctx.db.attachments.bulkGet(ids)).filter(Boolean) as import('../domain/types').Attachment[]), [ctx.db, ids.join(',')]) ?? []
}
