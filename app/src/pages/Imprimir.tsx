import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PdfBlock, PdfDoc } from '../domain/pdf'
import { buildDoc } from '../ui/docs'
import type { Data } from '../ui/data'
import { useAttachments } from '../ui/image'
import { canShareFiles, downloadPdf, makePdf, pdfName, sharePdf } from '../ui/pdfActions'
import { useSession } from '../ui/session'
import { Empty, Icon, useBusy, useUi } from '../ui/ui'

/** Vista previa en pantalla de un modelo de documento (el PDF se dibuja con el mismo modelo). */
function Block({ b }: { b: PdfBlock }) {
  if (b.t === 'heading') return <h2>{b.text}</h2>
  if (b.t === 'text') return <p style={{ margin: '4px 0', fontWeight: b.bold ? 700 : 400, color: b.muted ? '#5d6b77' : undefined }}>{b.text}</p>
  if (b.t === 'stamp') return <span className="stamp">{b.text}</span>
  if (b.t === 'kv') return <table><tbody>{b.rows.map(([k, v]) => <tr key={k}><td style={{ width: '32%', color: '#5d6b77' }}>{k}</td><td><b>{v}</b></td></tr>)}</tbody></table>
  if (b.t === 'boxes') return <div className="grid2" style={{ marginTop: 10 }}>{b.boxes.map((x) => <div key={x.title}><h2>{x.title}</h2>{x.lines.map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}</div>)}</div>
  if (b.t === 'totals') return <table style={{ width: 280, marginLeft: 'auto', marginTop: 8 }}><tbody>{b.rows.map(([l, v, bold]) => <tr key={l} className={bold ? 'tot' : ''}><td>{l}</td><td className="r">{v}</td></tr>)}</tbody></table>
  return (
    <div style={{ overflowX: 'auto' }}><table style={{ marginTop: 6 }}><thead><tr>{b.table.cols.map((c) => <th key={c.label} className={c.align}>{c.label}</th>)}</tr></thead>
      <tbody>{b.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={b.table.cols[j].align}>{c}</td>)}</tr>)}</tbody>
      {b.table.foot && <tfoot><tr className="tot">{b.table.foot.map((c, j) => <td key={j} className={b.table.cols[j].align}>{c}</td>)}</tr></tfoot>}</table></div>
  )
}

export function DocView({ data, doc }: { data: Data; doc: PdfDoc }) {
  const { ctx } = useSession()
  const logo = useAttachments(ctx, data.settings.logoId ? [data.settings.logoId] : [])[0]
  return (
    <article className="doc">
      <div className="dhead"><div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          {logo ? <img src={logo.dataUrl} alt="" style={{ height: 48, maxWidth: 110, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 4 }} /> : <span className="mark">{(doc.business.name || 'T').trim().charAt(0).toUpperCase()}</span>}
          <div className="biz"><b>{doc.business.name}</b>{[doc.business.legal, doc.business.line1, doc.business.line2].filter(Boolean).map((l) => <div key={l} className="small">{l}</div>)}</div></div>
        <div className="right"><h1>{doc.title}</h1>{doc.folio && <span className="folio">{doc.folio}</span>}{doc.date && <div className="small">{doc.date}</div>}</div>
      </div></div>
      <div className="dbody">{doc.blocks.map((b, i) => <Block key={i} b={b} />)}
        {doc.signatures && <div className="sig">{doc.signatures.map((s) => <div key={s}>{s}</div>)}</div>}</div>
      <div className="foot"><span>{doc.footer}</span></div>
    </article>
  )
}

/** Barra de acciones de un documento: respeta el área segura (notch) y funciona dentro de la PWA instalada. */
export function PdfBar({ data, doc }: { data: Data; doc: PdfDoc }) {
  const { ctx } = useSession(), ui = useUi(), nav = useNavigate()
  const [busy, guard] = useBusy()
  const save = () => guard(async () => { const b = await makePdf(ctx, data, doc); downloadPdf(pdfName(doc), b); ui.toast('PDF generado') })
  const share = () => guard(async () => { const b = await makePdf(ctx, data, doc); if (!(await sharePdf(pdfName(doc), b, `${doc.title} ${doc.folio ?? ''}`))) { downloadPdf(pdfName(doc), b); ui.toast('Tu navegador no permite compartir: se descargó el PDF.') } })
  return (
    <div className="pdfbar no-print">
      <button className="btn" aria-label="Volver" onClick={() => (history.length > 1 ? nav(-1) : nav('/'))}><Icon n="back" size={18} /><span className="hide-xs">Volver</span></button>
      <span className="grow" />
      {canShareFiles() && <button className="btn" disabled={busy} onClick={share}><Icon n="send" size={18} />Compartir</button>}
      <button className="btn primary" disabled={busy} onClick={save}><Icon n="down" size={18} />{busy ? 'Generando…' : 'Descargar PDF'}</button>
    </div>
  )
}

export function Imprimir({ data }: { data: Data }) {
  const { tipo = '', id = '' } = useParams()
  const [sp] = useSearchParams()
  const doc = buildDoc(data, tipo, id, sp.get('auth'))
  if (!doc) return <div className="pdfpage"><div className="pdfbar no-print"><a className="btn" href="#/"><Icon n="back" size={18} />Inicio</a></div><Empty title="Documento no encontrado" text="Verifica que tengas acceso a este registro." /></div>
  return (
    <div className="pdfpage">
      <PdfBar data={data} doc={doc} />
      <div className="pdfscroll"><DocView data={data} doc={doc} /></div>
    </div>
  )
}
