import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fmtCell, reportToCsv } from '../domain/csv'
import { inRange } from '../domain/dates'
import { REPORTS, reportById, type ReportData } from '../domain/reports'
import { download, fmtDate, fmtDateTime, type Data } from '../ui/data'
import { reportDoc } from '../ui/docs'
import { downloadPdf, makePdf, pdfName } from '../ui/pdfActions'
import { useSession } from '../ui/session'
import { PeriodPicker, usePeriod } from '../ui/period'
import { Badge, Empty, Icon, useUi } from '../ui/ui'

const GROUP_ORDER = ['Ventas', 'Rentabilidad', 'Finanzas', 'Cobranza', 'Inventario', 'Compras', 'Clientes', 'Personal']

function toData(d: Data): ReportData {
  return { sales: d.sales, expenses: d.expenses, ledger: d.ledger, receipts: d.receipts, products: d.products, balances: d.balances, movements: d.movements, orders: d.orders, customers: d.customers, vehicles: d.vehicles, employees: d.employees, suppliers: d.suppliers, services: d.services, settings: d.settings }
}

function Viewer({ data, id }: { data: Data; id: string }) {
  const nav = useNavigate(), ui = useUi(), { ctx } = useSession()
  const def = reportById(id)
  const ps = usePeriod(data.today, id === 'cxc' || id === 'cxp' || id === 'valor_inventario' || id === 'margen_bajo' ? 'hoy' : 'mes')
  const [sep, setSep] = useState<',' | ';'>(',')
  const res = useMemo(() => (def ? def.run(toData(data), ps.range, new Date().toISOString()) : null), [def, data, ps.range])
  if (!def || !res) return <Empty title="Reporte no encontrado" action={<Link className="btn" to="/reportes">Volver</Link>} />
  if (def.sensitive && !data.can('costos.ver')) return <div className="empty"><h3>Sin acceso a costos</h3><p>Este reporte incluye costos o márgenes y tu rol no tiene permiso para verlos.</p></div>
  const exportCsv = () => { download(`${def.id}-${ps.range.from}_${ps.range.to}.csv`, reportToCsv(res, sep), 'text/csv;charset=utf-8'); ui.toast('Reporte exportado a CSV') }
  const ranged = def.ranged
  const nTotals = res.totals
  return (
    <div className="stack-lg">
      <div className="page-head no-print"><div><button className="btn small ghost" onClick={() => nav('/reportes')}><Icon n="back" size={16} />Reportes</button><h1>{def.title}</h1><div className="sub">{def.description}</div></div>
        <div className="row wrap"><select aria-label="Separador CSV" value={sep} onChange={(e) => setSep(e.target.value as ',' | ';')} style={{ width: 'auto' }}><option value=",">CSV con coma</option><option value=";">CSV con punto y coma</option></select><button className="btn" onClick={exportCsv}><Icon n="down" size={18} />CSV</button><button className="btn primary" onClick={async () => { const doc = reportDoc(data, res); downloadPdf(pdfName(doc), await makePdf(ctx, data, doc)); ui.toast('PDF generado') }}><Icon n="down" size={18} />PDF</button></div></div>
      {ranged && <div className="no-print"><PeriodPicker s={ps} /></div>}
      <div className="card stack-sm">
        <div className="row between wrap"><b>{res.title}</b>{res.sensitive && <Badge tone="warn">Contiene costos (uso interno)</Badge>}</div>
        <div className="small"><b>Periodo:</b> {res.range ? (res.range.from === res.range.to ? fmtDate(res.range.from) : `${fmtDate(res.range.from)} – ${fmtDate(res.range.to)}`) : 'Al corte'} · <b>Generado:</b> {fmtDateTime(res.generatedAt)} · <b>Filtros:</b> {res.filters.join(' | ') || 'ninguno'}</div>
        <div className="small muted"><b>Definición:</b> {res.definition}</div>
        <div className="small muted"><b>Fuente:</b> {res.source}</div>
        {res.warnings.map((w) => <div key={w} className="banner">{w}</div>)}
      </div>
      {!res.rows.length ? <Empty title="Sin datos para este periodo" text="No hay registros que cumplan los criterios del reporte." /> : (
        <div className="tablewrap"><table className="table">
          <thead><tr>{res.columns.map((c) => <th key={c.key} className={c.kind === 'text' || c.kind === 'date' ? '' : 'r'}>{c.label}</th>)}</tr></thead>
          <tbody>{res.rows.map((r, i) => <tr key={i}>{r.map((v, j) => { const k = res.columns[j].kind; return <td key={j} className={`${k === 'text' || k === 'date' ? '' : 'r num'} ${typeof v === 'number' && v < 0 && k === 'money' ? 'neg' : ''}`}>{k === 'date' && typeof v === 'string' ? fmtDate(v) : fmtCell(v, k)}</td> })}</tr>)}</tbody>
          {nTotals && <tfoot><tr>{nTotals.map((v, j) => { const k = res.columns[j]?.kind ?? 'text'; return <td key={j} className={k === 'text' || k === 'date' ? '' : 'r num'}>{typeof v === 'string' ? v : fmtCell(v, k)}</td> })}</tr></tfoot>}
        </table></div>
      )}
      <p className="small muted no-print">Las exportaciones respetan tus permisos. Este reporte es gerencial y no sustituye un sistema contable o fiscal certificado.</p>
    </div>
  )
}

export function Reportes({ data }: { data: Data }) {
  const { id } = useParams()
  const canCost = data.can('costos.ver')
  if (id) return <Viewer data={data} id={id} />
  const groups = GROUP_ORDER.map((g) => ({ g, items: REPORTS.filter((r) => r.group === g && (!r.sensitive || canCost)) })).filter((x) => x.items.length)
  const hidden = REPORTS.filter((r) => r.sensitive && !canCost).length
  const today = data.today
  const monthStart = today.slice(0, 8) + '01'
  const salesThisMonth = data.sales.filter((s) => s.status === 'emitida' && inRange(s.date, { from: monthStart, to: today })).length
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Reportes y estadísticas</h1><div className="sub">{REPORTS.length} reportes · cada uno indica periodo, filtros, definición y fuente · exporta a CSV o imprime/PDF</div></div></div>
      {hidden > 0 && <div className="banner info">{hidden} reporte(s) con costos o márgenes no se muestran porque tu rol no tiene permiso de costos.</div>}
      {salesThisMonth === 0 && data.sales.length === 0 && <div className="banner info">Aún no hay ventas: los reportes se llenarán con los datos reales que registres.</div>}
      {groups.map(({ g, items }) => (
        <section key={g} className="stack"><h2>{g}</h2>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {items.map((r) => <Link key={r.id} to={`/reportes/${r.id}`} className="item" style={{ alignItems: 'flex-start' }}><Icon n="chart" size={20} /><div className="grow"><div className="ttl">{r.title}</div><div className="sub">{r.description}</div></div></Link>)}
          </div>
        </section>
      ))}
    </div>
  )
}
