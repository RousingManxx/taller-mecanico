import { docPdf, logoToJpeg, type PdfDoc } from '../domain/pdf'
import type { Ctx } from '../services/core'
import { download, type Data } from './data'

/** Genera el PDF del documento incrustando el logotipo del taller (si lo hay). */
export async function makePdf(ctx: Ctx, data: Data, doc: PdfDoc): Promise<Uint8Array> {
  let logo = doc.logo
  if (!logo && data.settings.logoId) { const a = await ctx.db.attachments.get(data.settings.logoId); if (a) logo = await logoToJpeg(a.dataUrl) }
  return docPdf({ ...doc, logo })
}
export const pdfName = (doc: PdfDoc) => `${[doc.title, doc.folio].filter(Boolean).join('-').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()}.pdf`
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart], { type: 'application/pdf' })
export const downloadPdf = (name: string, bytes: Uint8Array) => download(name, blobOf(bytes))
/** Hoja de compartir del sistema (WhatsApp, correo, Archivos…) cuando el dispositivo admite compartir archivos. */
export const canShareFiles = (): boolean => { try { return !!navigator.canShare?.({ files: [new File([], 'x.pdf', { type: 'application/pdf' })] }) } catch { return false } }
export async function sharePdf(name: string, bytes: Uint8Array, title: string): Promise<boolean> {
  try { await navigator.share({ files: [new File([blobOf(bytes)], name, { type: 'application/pdf' })], title }); return true } catch (e) { if ((e as Error).name === 'AbortError') return true; return false }
}
