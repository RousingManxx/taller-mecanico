/**
 * Generador de PDF sin dependencias (mismo enfoque que el recetario): texto Helvetica (WinAnsi), rectángulos, tablas con
 * saltos de página y logotipo JPEG. Se genera en el dispositivo y se descarga/comparte como archivo: no depende del
 * diálogo «Imprimir», poco fiable en las PWA de iOS. El mismo modelo (`PdfDoc`) alimenta la vista previa en pantalla.
 */
type RGB = [number, number, number]
export const COL = {
  dark: [0.078, 0.125, 0.169] as RGB, ac: [0.043, 0.431, 0.541] as RGB, soft: [0.902, 0.949, 0.965] as RGB, zebra: [0.969, 0.98, 0.984] as RGB,
  text: [0.106, 0.153, 0.2] as RGB, muted: [0.42, 0.48, 0.53] as RGB, line: [0.86, 0.9, 0.93] as RGB, white: [1, 1, 1] as RGB, bad: [0.7, 0.23, 0.18] as RGB,
}

// Anchos Helvetica (AFM) para ASCII 32..126; negrita ≈ +6 %.
const W = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]
const BASE: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ü: 'U', Ñ: 'N' }
const SUBS: Record<string, string> = { '−': '-', '▲': '+', '▼': '-', '⚠': '!', '≥': '>=', '≤': '<=', '→': '->', '✓': 'OK' }
function winAnsi(s: string): number[] {
  const out: number[] = []
  for (const ch of s) {
    const c = SUBS[ch] ?? ch, code = c.codePointAt(0)!
    if (c === '–') out.push(0x96); else if (c === '—') out.push(0x97); else if (c === '•') out.push(0x95)
    else if (c === '’') out.push(0x92); else if (c === '“') out.push(0x93); else if (c === '”') out.push(0x94); else if (c === '€') out.push(0x80)
    else if (code >= 32 && code < 256) out.push(code); else out.push(63)
  }
  return out
}
const hexOf = (s: string) => winAnsi(s).map((b) => b.toString(16).padStart(2, '0')).join('')
export function widthOf(s: string, size: number, bold: boolean): number {
  let w = 0
  for (const ch of s) { const b = BASE[ch] ?? ch; const i = b.charCodeAt(0) - 32; w += i >= 0 && i < W.length ? W[i] : 556 }
  return ((w * (bold ? 1.06 : 1)) / 1000) * size
}
const num = (n: number) => (Math.round(n * 100) / 100).toString()
const col = (c: RGB) => c.map((x) => (Math.round(x * 1000) / 1000).toString()).join(' ')

/* ───────── Modelo ───────── */
export interface PdfTable { cols: { label: string; align?: 'r'; w: number }[]; rows: string[][]; foot?: string[] }
export type PdfBlock =
  | { t: 'heading'; text: string }
  | { t: 'text'; text: string; bold?: boolean; muted?: boolean }
  | { t: 'boxes'; boxes: { title: string; lines: string[] }[] }
  | { t: 'table'; table: PdfTable }
  | { t: 'totals'; rows: [string, string, boolean?][] }
  | { t: 'kv'; rows: [string, string][] }
  | { t: 'stamp'; text: string }
export interface PdfDoc {
  title: string; folio?: string; date?: string
  business: { name: string; legal?: string; line1?: string; line2?: string }
  /** Logotipo ya convertido a JPEG (ver `logoToJpeg`). */
  logo?: { jpeg: Uint8Array; w: number; h: number }
  blocks: PdfBlock[]; signatures?: string[]; footer: string; landscape?: boolean
}

/* ───────── Motor ───────── */
class Pdf {
  PW: number; PH: number; M = 36
  pages: string[][] = []
  y = 0
  private cur!: string[]
  constructor(landscape: boolean) { this.PW = landscape ? 841.89 : 595.28; this.PH = landscape ? 595.28 : 841.89; this.newPage() }
  newPage() { this.cur = []; this.pages.push(this.cur); this.y = this.M }
  ensure(h: number) { if (this.y + h > this.PH - this.M - 16) { this.newPage(); return true } return false }
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; color?: RGB; align?: 'l' | 'r' | 'c' } = {}) {
    const size = o.size ?? 10, bold = !!o.bold, w = widthOf(s, size, bold)
    const px = o.align === 'r' ? x - w : o.align === 'c' ? x - w / 2 : x
    this.cur.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${col(o.color ?? COL.text)} rg ${num(px)} ${num(this.PH - y - size * 0.8)} Td <${hexOf(s)}> Tj ET`)
  }
  rect(x: number, y: number, w: number, h: number, fill: RGB) { if (w > 0 && h > 0) this.cur.push(`${col(fill)} rg ${num(x)} ${num(this.PH - y - h)} ${num(w)} ${num(h)} re f`) }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB = COL.line, w = 0.6, dash = false) {
    this.cur.push(`${dash ? '[3 3] 0 d ' : ''}${col(c)} RG ${w} w ${num(x1)} ${num(this.PH - y1)} m ${num(x2)} ${num(this.PH - y2)} l S${dash ? ' [] 0 d' : ''}`)
  }
  image(x: number, y: number, w: number, h: number) { this.cur.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.PH - y - h)} cm /Im1 Do Q`) }
  wrap(s: string, width: number, size: number, bold = false): string[] {
    const out: string[] = []
    for (const para of String(s).split('\n')) {
      let line = ''
      const push = (w: string) => {
        // palabra más ancha que la columna: se parte por caracteres
        while (widthOf(w, size, bold) > width && w.length > 1) { let k = w.length - 1; while (k > 1 && widthOf(w.slice(0, k), size, bold) > width) k--; if (line) { out.push(line); line = '' } out.push(w.slice(0, k)); w = w.slice(k) }
        const t = line ? line + ' ' + w : w
        if (widthOf(t, size, bold) <= width || !line) line = t; else { out.push(line); line = w }
      }
      for (const word of para.split(/\s+/).filter(Boolean)) push(word)
      out.push(line)
    }
    return out
  }
  build(footer: string, logo?: PdfDoc['logo']): Uint8Array {
    const objs: (string | null)[] = []
    const add = (s: string) => { objs.push(s); return objs.length }
    add('<< /Type /Catalog /Pages 2 0 R >>'); add('') // 1, 2
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') // 3
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>') // 4
    let imgRef = ''
    if (logo) {
      let bin = ''; for (let i = 0; i < logo.jpeg.length; i++) bin += String.fromCharCode(logo.jpeg[i])
      const id = add(`<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.jpeg.length} >>\nstream\n${bin}\nendstream`)
      imgRef = `/XObject << /Im1 ${id} 0 R >>`
    }
    const kids: number[] = []
    this.pages.forEach((ops, i) => {
      const f = (s: string, x: number) => `BT /F1 8 Tf ${col(COL.muted)} rg ${num(x)} 22 Td <${hexOf(s)}> Tj ET`
      const content = [...ops, f(footer, this.M), f(`Página ${i + 1} de ${this.pages.length}`, this.PW - this.M - 46)].join('\n')
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
      kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.PW)} ${num(this.PH)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${imgRef} >> /Contents ${cid} 0 R >>`))
    })
    objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`
    let out = '%PDF-1.4\n'
    const offs: number[] = []
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
    const xref = out.length
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff // todo es latin1: 1 carácter = 1 byte
    return bytes
  }
}

/** Dibuja el documento completo. */
export function docPdf(d: PdfDoc): Uint8Array {
  const p = new Pdf(!!d.landscape), M = p.M, CW = p.PW - 2 * M
  // Encabezado de marca
  const H = 84
  p.rect(0, 0, p.PW, H, COL.dark); p.rect(0, H, p.PW, 4, COL.ac)
  let tx = M
  if (d.logo) { const hh = 46, ww = Math.min((d.logo.w / d.logo.h) * hh, 110); p.rect(M - 3, 17, ww + 6, hh + 6, COL.white); p.image(M, 20, ww, hh); tx = M + ww + 16 }
  else { p.rect(M, 20, 48, 48, COL.ac); p.text(M + 24, 31, (d.business.name || 'T').trim().charAt(0).toUpperCase(), { size: 26, bold: true, color: COL.white, align: 'c' }); tx = M + 62 }
  p.text(tx, 20, d.business.name, { size: 14, bold: true, color: COL.white })
  let by = 38
  for (const l of [d.business.legal, d.business.line1, d.business.line2].filter(Boolean) as string[]) { p.text(tx, by, p.wrap(l, CW * 0.5 - (tx - M), 8)[0], { size: 8, color: [0.85, 0.91, 0.94] }); by += 11 }
  const T = d.title.toUpperCase(), tlines = widthOf(T, 19, true) > CW * 0.5 ? p.wrap(T, CW * 0.45, 13, true).slice(0, 2) : [T], tsz = tlines.length === 1 && tlines[0] === T ? 19 : 13
  tlines.forEach((l, i) => p.text(p.PW - M, (tsz === 19 ? 18 : 16) + i * 16, l, { size: tsz, bold: true, color: COL.white, align: 'r' }))
  if (d.folio) { const w = widthOf(d.folio, 11, true) + 20; p.rect(p.PW - M - w, 44, w, 18, COL.ac); p.text(p.PW - M - 10, 48, d.folio, { size: 11, bold: true, color: COL.white, align: 'r' }) }
  if (d.date) p.text(p.PW - M, 68, d.date, { size: 8.5, color: [0.85, 0.91, 0.94], align: 'r' })
  p.y = H + 18

  const heading = (s: string) => { p.ensure(34); p.y += 4; p.rect(M, p.y, CW, 16, COL.soft); p.rect(M, p.y, 3.5, 16, COL.ac); p.text(M + 10, p.y + 3.5, s.toUpperCase(), { size: 8.5, bold: true, color: COL.dark }); p.y += 22 }
  for (const b of d.blocks) {
    if (b.t === 'heading') heading(b.text)
    else if (b.t === 'text') { for (const l of p.wrap(b.text, CW, 9.5, b.bold)) { p.ensure(13); p.text(M, p.y, l, { size: 9.5, bold: b.bold, color: b.muted ? COL.muted : COL.text }); p.y += 13 } p.y += 2 }
    else if (b.t === 'kv') { for (const [k, v] of b.rows) { const ls = p.wrap(v, CW - 150, 9.5); p.ensure(13 * ls.length); p.text(M, p.y, k, { size: 9.5, color: COL.muted }); ls.forEach((l, i) => p.text(M + 150, p.y + i * 13, l, { size: 9.5, bold: true })); p.y += 13 * ls.length } p.y += 2 }
    else if (b.t === 'stamp') { p.ensure(30); const w = widthOf(b.text, 12, true) + 20; p.rect(M, p.y, w, 22, COL.bad); p.text(M + 10, p.y + 5, b.text, { size: 12, bold: true, color: COL.white }); p.y += 30 }
    else if (b.t === 'boxes') {
      const n = b.boxes.length, gap = 14, bw = (CW - gap * (n - 1)) / n
      const lines = b.boxes.map((x) => x.lines.flatMap((l) => p.wrap(l, bw - 12, 9.5)))
      const h = 22 + Math.max(...lines.map((l) => l.length)) * 12.5
      p.ensure(h + 6)
      b.boxes.forEach((x, i) => {
        const bx = M + i * (bw + gap)
        p.rect(bx, p.y, bw, 16, COL.soft); p.rect(bx, p.y, 3.5, 16, COL.ac); p.text(bx + 10, p.y + 3.5, x.title.toUpperCase(), { size: 8.5, bold: true, color: COL.dark })
        lines[i].forEach((l, j) => p.text(bx + 6, p.y + 22 + j * 12.5, l, { size: 9.5, bold: j === 0 }))
      })
      p.y += h + 4
    } else if (b.t === 'table') {
      const t = b.table, tw = t.cols.reduce((a, c) => a + c.w, 0)
      const xs = t.cols.reduce<number[]>((a, c) => [...a, a[a.length - 1] + (c.w / tw) * CW], [M])
      const head = () => {
        p.rect(M, p.y, CW, 17, COL.dark)
        t.cols.forEach((c, i) => p.text(c.align === 'r' ? xs[i + 1] - 6 : xs[i] + 6, p.y + 4.5, c.label.toUpperCase(), { size: 7.5, bold: true, color: COL.white, align: c.align === 'r' ? 'r' : 'l' }))
        p.y += 19
      }
      p.ensure(46); head()
      t.rows.forEach((row, ri) => {
        const cells = row.map((c, i) => p.wrap(c, xs[i + 1] - xs[i] - 12, 9))
        const h = Math.max(...cells.map((c) => c.length)) * 11.5 + 7
        if (p.ensure(h + 4)) head()
        if (ri % 2) p.rect(M, p.y - 1, CW, h, COL.zebra)
        cells.forEach((ls, i) => ls.forEach((l, j) => p.text(t.cols[i].align === 'r' ? xs[i + 1] - 6 : xs[i] + 6, p.y + 2 + j * 11.5, l, { size: 9, align: t.cols[i].align === 'r' ? 'r' : 'l' })))
        p.line(M, p.y + h - 1, p.PW - M, p.y + h - 1, COL.line, 0.4); p.y += h
      })
      if (t.foot) { p.ensure(20); p.rect(M, p.y + 2, CW, 17, COL.soft); t.foot.forEach((c, i) => p.text(t.cols[i].align === 'r' ? xs[i + 1] - 6 : xs[i] + 6, p.y + 6, c, { size: 9, bold: true, align: t.cols[i].align === 'r' ? 'r' : 'l' })); p.y += 22 }
      p.y += 6
    } else if (b.t === 'totals') {
      const w = 230, x = p.PW - M - w
      p.ensure(b.rows.length * 17 + 10)
      for (const [l, v, bold] of b.rows) {
        if (bold) { p.rect(x, p.y - 2, w, 20, COL.dark); p.text(x + 8, p.y + 3, l, { size: 11, bold: true, color: COL.white }); p.text(x + w - 8, p.y + 3, v, { size: 11, bold: true, color: COL.white, align: 'r' }); p.y += 24 }
        else { p.text(x + 8, p.y, l, { size: 9.5, color: COL.muted }); p.text(x + w - 8, p.y, v, { size: 9.5, align: 'r' }); p.line(x, p.y + 13, x + w, p.y + 13, COL.line, 0.4); p.y += 17 }
      }
      p.y += 6
    }
  }
  if (d.signatures?.length) {
    p.ensure(80); p.y += 44
    const n = d.signatures.length, gap = 40, sw = (CW - gap * (n - 1)) / n
    d.signatures.forEach((s, i) => { const x = M + i * (sw + gap); p.line(x, p.y, x + sw, p.y, COL.dark, 1); p.text(x + sw / 2, p.y + 5, s, { size: 8.5, color: COL.muted, align: 'c' }) })
    p.y += 24
  }
  return p.build(d.footer, d.logo)
}

/** Convierte el logotipo (data URL png/jpeg/webp) a JPEG con fondo blanco, para incrustarlo en el PDF. Solo en el navegador. */
export async function logoToJpeg(dataUrl: string): Promise<PdfDoc['logo'] | undefined> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, 300 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
    const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height)
    const b64 = c.toDataURL('image/jpeg', 0.85).split(',')[1], bin = atob(b64), jpeg = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) jpeg[i] = bin.charCodeAt(i)
    return { jpeg, w: c.width, h: c.height }
  } catch { return undefined }
}
