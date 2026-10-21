import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { lineAmounts } from '../domain/lines'
import { formatMXN, formatNum, formatPct, formatQty } from '../domain/money'
import { ITEM_TYPE_LABEL } from '../domain/orders'
import { QUOTE_LABEL, quoteSummary } from '../domain/quotes'
import type { Quotation, QuoteItem, QuoteVersion } from '../domain/types'
import { approveQuotation, convertQuotationToOrder, duplicateQuotation, markQuotationViewed, refreshExpiredQuotations, rejectQuotation, sendQuotation } from '../services/quotations'
import { QUOTE_TONE, effStatus } from '../ui/crm/lib'
import { useSubmit } from '../ui/crm/hooks'
import { Info } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, fmtDateTime, plateOf, type Data } from '../ui/data'
import { useCtx } from '../ui/session'
import { Badge, DataTable, Empty, Field, NumInput, Sheet, useBusy, useUi, type Column } from '../ui/ui'
import '../ui/css/crm.css'

export function CotizacionDetalle({ data }: { data: Data }) {
  const { id = '' } = useParams()
  const q = data.quotations.find((x) => x.id === id)
  if (!q) return <Empty title="Cotización no encontrada" text="Puede que el enlace sea incorrecto." action={<Link className="btn" to="/cotizaciones">Volver a cotizaciones</Link>} />
  return <Detalle key={q.id} data={data} q={q} />
}

function Detalle({ data, q }: { data: Data; q: Quotation }) {
  const ctx = useCtx(), ui = useUi(), nav = useNavigate(), open = useOpen()
  const [busy, guard] = useBusy()
  const [viewN, setViewN] = useState<number | null>(null)
  const [converting, setConverting] = useState(false)
  const users = useLiveQuery(async () => new Map((await ctx.db.users.toArray()).map((u) => [u.id, u.name])), [ctx.db]) ?? new Map<string, string>()
  const canEdit = data.can('cotizaciones.editar'), showCost = data.can('costos.ver')
  const status = effStatus(q, data.today)
  const cust = data.custMap.get(q.customerId), veh = data.vehMap.get(q.vehicleId)
  const sortedV = useMemo(() => [...q.versions].sort((a, b) => b.n - a.n), [q.versions])
  const shownN = viewN ?? q.currentVersion
  const v: QuoteVersion = q.versions.find((x) => x.n === shownN) ?? q.versions[q.versions.length - 1]
  const isCurrent = v.n === q.currentVersion
  const sum = useMemo(() => quoteSummary(v.items, data.settings), [v.items, data.settings])
  const noCost = v.items.filter((i) => !(i.estUnitCost > 0)).length

  useEffect(() => { if (canEdit) refreshExpiredQuotations(ctx).catch(() => undefined) }, [ctx, canEdit])

  const act = (fn: () => Promise<unknown>, ok: string) => guard(() => ui.run(fn, ok))
  const send = () => act(() => sendQuotation(ctx, q.id), 'Marcada como enviada. Torque no la envía por sí mismo: compártela imprimiéndola o por tu medio habitual.')
  const viewed = () => act(() => markQuotationViewed(ctx, q.id), 'Marcada como vista por el cliente')
  const approve = async () => {
    const who = await ui.askReason('Aprobar cotización', '¿Quién aprueba? (nombre del cliente o su representante)', 'Aprobar')
    if (!who) return
    await act(() => approveQuotation(ctx, q.id, who), `Cotización aprobada (versión ${q.currentVersion}) por ${who}`)
  }
  const reject = async () => {
    const why = await ui.askReason('Rechazar cotización', 'Motivo del rechazo', 'Rechazar')
    if (!why) return
    await act(() => rejectQuotation(ctx, q.id, why), 'Cotización rechazada')
  }
  const duplicate = () => guard(async () => {
    const c = await ui.run(() => duplicateQuotation(ctx, q.id), 'Cotización duplicada como borrador')
    if (c) nav(`/cotizaciones/${c.id}`)
  })

  const cols: Column<QuoteItem>[] = [
    { key: 'd', label: 'Concepto', primary: true, render: (i) => <span>{i.description}</span> },
    { key: 't', label: 'Tipo', hideMobile: true, render: (i) => ITEM_TYPE_LABEL[i.type] },
    { key: 'q', label: 'Cant.', align: 'r', render: (i) => <span className="nowrap">{formatQty(i.qty)} {i.unit}</span> },
    { key: 'p', label: data.settings.pricesIncludeTax ? 'Precio (IVA incl.)' : 'Precio (sin IVA)', align: 'r', render: (i) => <span className="nowrap">{formatMXN(i.unitPriceCents)}</span> },
    { key: 'x', label: 'Descuento', align: 'r', hideMobile: true, render: (i) => (i.discountCents ? formatMXN(i.discountCents) : '—') },
    { key: 'i', label: 'IVA', align: 'r', hideMobile: true, render: (i) => <span className="nowrap">{formatNum(i.taxRate)} %</span> },
    { key: 'm', label: 'Importe con IVA', align: 'r', render: (i) => <span className="nowrap">{formatMXN(lineAmounts(i, data.settings.pricesIncludeTax).totalCents)}</span> },
  ]

  const open_ = ['borrador', 'enviada', 'vista'].includes(q.status) && status !== 'vencida'
  return (
    <div className="stack-lg">
      <div className="stack">
        <Link to="/cotizaciones" className="small">← Cotizaciones</Link>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <div>
            <h1>Cotización {q.folio}</h1>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              <Badge tone={QUOTE_TONE[status]}>{QUOTE_LABEL[status]}</Badge>
              <Badge>Versión vigente: v{q.currentVersion}</Badge>
              {q.approvedVersion && <Badge tone="ok">Aprobada: v{q.approvedVersion}</Badge>}
            </div>
          </div>
          <div className="row wrap"><a className="btn" href={`#/imprimir/cotizacion/${q.id}`} target="_blank" rel="noopener noreferrer">Imprimir</a></div>
        </div>
        <div className="small">Cliente: {cust ? <Link to={`/clientes/${cust.id}`}>{cust.name}</Link> : '—'} · Vehículo: {veh ? <Link to={`/vehiculos/${veh.id}`}>{plateOf(veh)}</Link> : '—'} · Emitida {fmtDate(q.issueDate)} · Vigente hasta {fmtDate(q.validUntil)}</div>
      </div>

      {status === 'vencida' && q.status !== 'vencida' && <div className="banner" role="status">La vigencia terminó el {fmtDate(q.validUntil)}. Duplícala para cotizar de nuevo con vigencia renovada.</div>}
      {q.status === 'vencida' && <div className="banner" role="status">Cotización vencida el {fmtDate(q.validUntil)}. Puedes editarla (se crea una versión nueva con vigencia renovada) o duplicarla.</div>}
      {q.status === 'rechazada' && <div className="banner bad" role="status"><b>Rechazada.</b> Motivo: {q.rejectReason || 'sin motivo registrado'}.</div>}
      {q.approvedBy && <div className="banner ok" role="status">Aprobada por <b>{q.approvedBy}</b> el {fmtDateTime(q.approvedAt)} (versión {q.approvedVersion}).{q.workOrderId && <> Convertida en la orden <Link to={`/ordenes/${q.workOrderId}`}>{data.orderMap.get(q.workOrderId)?.folio ?? 'ver orden'}</Link>.</>}</div>}
      {!isCurrent && (
        <div className="banner info" role="status">
          Estás viendo la <b>versión {v.n}</b> en modo lectura{v.n === q.approvedVersion ? ' (la que aprobó el cliente)' : ' (anterior)'}. <button className="btn small" onClick={() => setViewN(null)}>Volver a la versión vigente</button>
        </div>
      )}

      {canEdit && (
        <div className="row wrap" role="group" aria-label="Acciones de la cotización">
          {q.status === 'borrador' && status !== 'vencida' && <button className="btn primary" disabled={busy} onClick={send}>Marcar como enviada</button>}
          {q.status === 'enviada' && status !== 'vencida' && <button className="btn" disabled={busy} onClick={viewed}>Marcar como vista</button>}
          {open_ && <button className="btn primary" disabled={busy} onClick={approve}>Aprobar</button>}
          {open_ && <button className="btn danger" disabled={busy} onClick={reject}>Rechazar</button>}
          {q.status === 'aprobada' && data.can('ordenes.crear') && <button className="btn primary" disabled={busy} onClick={() => setConverting(true)}>Convertir en orden de trabajo</button>}
          {!['aprobada', 'convertida'].includes(q.status) && <button className="btn" disabled={busy} onClick={() => open({ k: 'quote', v: q })}>{q.status === 'borrador' ? 'Editar' : q.status === 'vencida' || q.status === 'rechazada' ? 'Editar y reabrir (nueva versión)' : 'Editar (crea nueva versión)'}</button>}
          <button className="btn" disabled={busy} onClick={duplicate}>Duplicar</button>
        </div>
      )}

      <div className="crm-cols">
        <div className="stack-lg">
          <section className="stack" aria-labelledby="cd-items">
            <h2 id="cd-items">Partidas{!isCurrent && ` (versión ${v.n})`}</h2>
            <DataTable rows={v.items} columns={cols} rowKey={(i) => i.id} empty={<Empty title="Sin partidas" />} />
          </section>
          <section className="stack" aria-labelledby="cd-vers">
            <h2 id="cd-vers">Versiones</h2>
            <p className="small muted">Cada vez que se edita una cotización ya enviada se conserva la versión anterior.</p>
            <ul className="crm-ul crm-versions">
              {sortedV.map((x) => (
                <li key={x.n} className="item" style={{ cursor: 'default' }}>
                  <div className="grow">
                    <div className="ttl row wrap" style={{ gap: 6 }}>Versión {x.n}{x.n === q.currentVersion && <Badge tone="info">Vigente</Badge>}{x.n === q.approvedVersion && <Badge tone="ok">Aprobada</Badge>}{x.n === shownN && x.n !== q.currentVersion && <Badge>Mostrando</Badge>}</div>
                    <div className="sub">{fmtDateTime(x.createdAt)} · {users.get(x.userId) ?? 'Usuario'} · {formatMXN(quoteSummary(x.items, data.settings).totalCents)} · {x.items.length} partida(s)</div>
                  </div>
                  {x.n !== shownN && <button className="btn small" onClick={() => setViewN(x.n === q.currentVersion ? null : x.n)}>Ver</button>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="stack-lg">
          <section className="card stack-sm" aria-labelledby="cd-cli">
            <h2 id="cd-cli">Resumen para el cliente</h2>
            <dl className="crm-infos single">
              <Info label="Subtotal neto"><span className="num">{formatMXN(sum.netCents)}</span></Info>
              {sum.discountCents > 0 && <Info label="Descuentos incluidos"><span className="num">{formatMXN(sum.discountCents)}</span></Info>}
              <Info label="IVA"><span className="num">{formatMXN(sum.taxCents)}</span></Info>
              <Info label="Total"><b className="num" style={{ fontSize: '1.25rem' }}>{formatMXN(sum.totalCents)}</b></Info>
              <Info label="Vigencia">Hasta el {fmtDate(q.validUntil)}</Info>
              <Info label="Tiempo estimado">{v.estimatedDays ? `${formatNum(v.estimatedDays)} día${v.estimatedDays === 1 ? '' : 's'}` : 'Por definir'}</Info>
              <Info label="Condiciones">{v.terms || '—'}</Info>
              <Info label="Garantía">{v.warranty || '—'}</Info>
              {v.notes && <Info label="Notas">{v.notes}</Info>}
            </dl>
          </section>
          {showCost && (
            <section className="card flat stack-sm" aria-labelledby="cd-int">
              <h2 id="cd-int">Resumen interno</h2>
              <Badge tone="warn">Uso interno, no aparece en la cotización del cliente</Badge>
              <dl className="crm-infos single">
                <Info label="Costo estimado"><span className="num">{formatMXN(sum.estCostCents)}</span></Info>
                <Info label="Utilidad prevista"><span className="num">{formatMXN(sum.estProfitCents)}</span></Info>
                <Info label="Margen previsto (sobre venta neta)"><b className="num">{formatPct(sum.estMarginPct)}</b></Info>
                <Info label="Markup (sobre costo)"><span className="num">{formatPct(sum.estMarkupPct)}</span></Info>
              </dl>
              {noCost > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{noCost} partida(s) sin costo estimado: el margen puede ser menor al mostrado.</div>}
              <div className="small muted">Costos con el valor del inventario y la mano de obra al momento de guardar la versión.</div>
            </section>
          )}
        </div>
      </div>
      {converting && <ConvertSheet data={data} q={q} onClose={() => setConverting(false)} />}
    </div>
  )
}

function ConvertSheet({ data, q, onClose }: { data: Data; q: Quotation; onClose: () => void }) {
  const ctx = useCtx(), nav = useNavigate()
  const { busy, error, submit } = useSubmit()
  const veh = data.vehMap.get(q.vehicleId)
  const [km, setKm] = useState<number | undefined>(veh?.km)
  const [mech, setMech] = useState('')
  const [complaint, setComplaint] = useState(`Según cotización ${q.folio}`)
  const kmErr = km === undefined || km < 0 ? 'Indica el kilometraje de entrada (no puede ser negativo).' : ''
  const mechanics = data.employees.filter((e) => e.isMechanic && e.active)
  const go = async () => {
    if (kmErr) return
    const r = await submit(() => convertQuotationToOrder(ctx, q.id, { km: km ?? 0, mechanicId: mech || undefined, complaint }), 'Orden creada con las partidas autorizadas de la versión aprobada')
    if (r) { onClose(); nav(`/ordenes/${r.value.id}`) }
  }
  return (
    <Sheet title={`Convertir ${q.folio} en orden`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !!kmErr} onClick={go}>Crear orden</button></>}>
      <div className="stack">
        {error && <div className="banner bad" role="alert">{error}</div>}
        <p className="small muted">Se creará la orden con las partidas de la versión aprobada ya autorizadas, sin recapturar nada.</p>
        <Field label="Kilometraje de entrada *" error={kmErr}><NumInput value={km} onChange={setKm} inputMode="numeric" invalid={!!kmErr} /></Field>
        <Field label="Mecánico asignado (opcional)"><select value={mech} onChange={(e) => setMech(e.target.value)}><option value="">Sin asignar</option>{mechanics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Motivo de ingreso"><input value={complaint} onChange={(e) => setComplaint(e.target.value)} /></Field>
      </div>
    </Sheet>
  )
}
