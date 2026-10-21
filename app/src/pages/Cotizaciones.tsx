import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { formatMXN } from '../domain/money'
import { QUOTE_LABEL } from '../domain/quotes'
import type { Quotation, QuoteStatus } from '../domain/types'
import { refreshExpiredQuotations } from '../services/quotations'
import { QUOTE_ORDER, QUOTE_TONE, effStatus, norm, quoteTotals } from '../ui/crm/lib'
import { SearchBox } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, plateOf, type Data } from '../ui/data'
import { useCtx } from '../ui/session'
import { Badge, DataTable, Empty, type Column } from '../ui/ui'
import '../ui/css/crm.css'

const SHORT: Record<QuoteStatus, string> = { borrador: 'Borrador', enviada: 'Enviada', vista: 'Vista', aprobada: 'Aprobada', rechazada: 'Rechazada', vencida: 'Vencida', convertida: 'Convertida' }

export function Cotizaciones({ data }: { data: Data }) {
  const ctx = useCtx(), nav = useNavigate(), open = useOpen()
  const [sp, setSp] = useSearchParams()
  const estado = sp.get('estado') ?? ''
  const q = sp.get('q') ?? ''
  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const canEdit = data.can('cotizaciones.editar')

  // Al abrir la lista se marcan como vencidas las cotizaciones sin respuesta cuya vigencia terminó.
  useEffect(() => { if (canEdit) refreshExpiredQuotations(ctx).catch(() => undefined) }, [ctx, canEdit])

  const withStatus = useMemo(() => data.quotations.map((x) => ({ x, s: effStatus(x, data.today) })), [data.quotations, data.today])
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const r of withStatus) m.set(r.s, (m.get(r.s) ?? 0) + 1); return m }, [withStatus])
  const rows = useMemo(() => {
    const t = norm(q.trim())
    return withStatus
      .filter((r) => !estado || r.s === estado)
      .filter(({ x }) => !t || norm(x.folio).includes(t) || norm(data.custMap.get(x.customerId)?.name).includes(t) || norm(data.vehMap.get(x.vehicleId)?.plate).includes(t) || norm(plateOf(data.vehMap.get(x.vehicleId))).includes(t))
      .map((r) => r.x)
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.folio.localeCompare(a.folio))
  }, [withStatus, estado, q, data.custMap, data.vehMap])

  const cols: Column<Quotation>[] = [
    { key: 'f', label: 'Folio', primary: true, render: (x) => <span>{x.folio}{x.currentVersion > 1 && <> <Badge>v{x.currentVersion}</Badge></>}</span> },
    { key: 'c', label: 'Cliente', render: (x) => data.custMap.get(x.customerId)?.name ?? '—' },
    { key: 'v', label: 'Vehículo', hideMobile: true, render: (x) => plateOf(data.vehMap.get(x.vehicleId)) },
    { key: 'd', label: 'Fecha', hideMobile: true, render: (x) => fmtDate(x.issueDate) },
    { key: 'u', label: 'Vigencia', render: (x) => fmtDate(x.validUntil) },
    { key: 't', label: 'Total', align: 'r', render: (x) => formatMXN(quoteTotals(x, data.settings).totalCents) },
    { key: 's', label: 'Estado', render: (x) => { const s = effStatus(x, data.today); return <Badge tone={QUOTE_TONE[s]}>{QUOTE_LABEL[s]}</Badge> } },
  ]
  const all = data.quotations.length
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Cotizaciones</h1><div className="sub">{all} en total · el total incluye IVA</div></div>
        {canEdit && <button className="btn primary" onClick={() => open({ k: 'quote' })}>Nueva cotización</button>}
      </div>
      <div className="stack">
        <SearchBox value={q} onChange={(v) => setParam('q', v)} placeholder="Buscar por folio, cliente o placas" label="Buscar cotizaciones" />
        <div className="chips" role="group" aria-label="Filtrar por estado">
          <button className="chip" aria-pressed={!estado} onClick={() => setParam('estado', '')}>Todas ({all})</button>
          {QUOTE_ORDER.map((s) => <button key={s} className="chip" aria-pressed={estado === s} onClick={() => setParam('estado', s)}>{SHORT[s]} ({counts.get(s) ?? 0})</button>)}
        </div>
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(x) => x.id} onRow={(x) => nav(`/cotizaciones/${x.id}`)}
        empty={<Empty title={all ? 'Ninguna cotización coincide' : 'Aún no hay cotizaciones'} text={all ? 'Prueba con otro estado o búsqueda.' : 'Crea la primera cotización para un cliente y su vehículo.'} action={!all && canEdit ? <button className="btn primary" onClick={() => open({ k: 'quote' })}>Crear cotización</button> : undefined} />} />
    </div>
  )
}
