// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { docPdf, widthOf, type PdfDoc } from '../domain/pdf'

async function read(bytes: Uint8Array) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' '))
  return { n: doc.numPages, pages, text: pages.join('\n') }
}
const base: PdfDoc = { title: 'Cotización', folio: 'COT-0001 · v1', date: 'Emitida 20 oct 2026', business: { name: 'Taller Ñandú', legal: 'Ñandú SA de CV', line1: 'RFC XAXX010101000 · Av. Juárez 123', line2: '55 1234 5678' }, footer: 'Taller Ñandú · documento de control interno', signatures: ['Cliente', 'Taller'], blocks: [] }

describe('Generador de PDF', () => {
  it('produce un PDF válido y legible con acentos, tablas y totales', async () => {
    const doc: PdfDoc = { ...base, blocks: [
      { t: 'boxes', boxes: [{ title: 'Cliente', lines: ['José Pérez Muñoz', '5512345678'] }, { title: 'Vehículo', lines: ['Nissan Versa 2018', 'Placas ABC-123'] }] },
      { t: 'heading', text: 'Partidas' },
      { t: 'table', table: { cols: [{ label: 'Concepto', w: 5 }, { label: 'Importe', w: 2, align: 'r' }], rows: [['Cambio de aceite y filtro · Mano de obra', '$450.00'], ['Filtro de aceite', '$200.00']], foot: ['Total', '$650.00'] } },
      { t: 'totals', rows: [['Subtotal', '$650.00'], ['IVA / impuestos', '$104.00'], ['Total', '$754.00', true]] },
      { t: 'stamp', text: 'VENTA CANCELADA' },
    ] }
    const bytes = docPdf(doc)
    expect(new TextDecoder('latin1').decode(bytes.slice(0, 8))).toMatch(/^%PDF-1\.4/)
    const r = await read(bytes)
    expect(r.n).toBe(1)
    for (const s of ['COTIZACIÓN', 'COT-0001', 'José Pérez Muñoz', 'Cambio de aceite y filtro', '$754.00', 'VENTA CANCELADA', 'Página 1 de 1', 'Taller Ñandú']) expect(r.text, s).toContain(s)
  })
  it('pagina tablas largas repitiendo el encabezado y numera las páginas', async () => {
    const rows = Array.from({ length: 90 }, (_, i) => [`Partida número ${i + 1} con una descripción un poco larga para ocupar espacio`, `$${i + 1}.00`])
    const r = await read(docPdf({ ...base, blocks: [{ t: 'table', table: { cols: [{ label: 'Concepto', w: 5 }, { label: 'Importe', w: 2, align: 'r' }], rows } }] }))
    expect(r.n).toBeGreaterThan(1)
    expect(r.pages.every((p, i) => p.includes(`Página ${i + 1} de ${r.n}`))).toBe(true)
    expect(r.pages.slice(1).every((p) => p.includes('CONCEPTO'))).toBe(true) // encabezado repetido
    expect(r.text).toContain('Partida número 90')
  })
  it('ajusta textos largos y palabras sin espacios sin cortar el documento; orientación apaisada', async () => {
    const long = 'x'.repeat(200) + ' ' + 'palabra '.repeat(80)
    const r = await read(docPdf({ ...base, landscape: true, blocks: [{ t: 'text', text: long }, { t: 'kv', rows: [['Campo', long]] }] }))
    expect(r.n).toBeGreaterThanOrEqual(1); expect(r.text).toContain('palabra')
  })
  it('incrusta un logotipo JPEG', async () => {
    // JPEG mínimo válido de 1×1 px
    const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='), (c) => c.charCodeAt(0))
    const bytes = docPdf({ ...base, logo: { jpeg, w: 1, h: 1 }, blocks: [] })
    expect(new TextDecoder('latin1').decode(bytes)).toContain('/DCTDecode')
    expect((await read(bytes)).n).toBe(1)
  })
  it('mide el ancho del texto con acentos como la letra base', () => { expect(widthOf('ñ', 10, false)).toBeCloseTo(widthOf('n', 10, false), 5) })
})
