import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { saleBalance } from '../domain/finance'
import { formatMXN } from '../domain/money'
import { OPEN_STATUSES, STATUS_LABEL, STATUS_ORDER } from '../domain/orders'
import type { OrderStatus, WorkOrder } from '../domain/types'
import { plateOf, type Data } from '../ui/data'
import { useOpen } from '../ui/create'
import { advancesOf, fmtSpan, isClosed, mechanicName, mechanicsOf, minutesInShop, norm, PRIORITY_LABEL, PRIORITY_RANK, promiseInfo, saleOfOrder, useNow } from '../ui/orders/helpers'
import { PriorityBadge, StatusBadge } from '../ui/orders/parts'
import { Badge, Chips, DataTable, Empty, Field, Icon, Seg, useMedia, type Column } from '../ui/ui'

type Estado = 'abiertas' | 'todas' | OrderStatus
const VIEW_KEY = 'torque.ordenes.vista'

export function Ordenes({ data }: { data: Data }) {
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()
  const open = useOpen()
  const raw = sp.get('estado') ?? 'abiertas'
  const estado: Estado = raw === 'abiertas' || raw === 'todas' || (STATUS_ORDER as string[]).includes(raw) ? (raw as Estado) : 'abiertas'
  const q = sp.get('q') ?? ''
  const [mech, setMech] = useState('')
  const [prio, setPrio] = useState('')
  const [view, setView] = useState<'lista' | 'tablero'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'tablero' ? 'tablero' : 'lista' } catch { return 'lista' } })
  const desktop = useMedia('(min-width: 900px)')
  const tableMode = useMedia('(min-width: 700px)')
  const now = useNow(60000)
  const showBoard = view === 'tablero' && desktop
  const canSeeMoney = data.can('ventas.ver')
  const allSeen = data.can('ordenes.ver_todas')

  const setParam = (k: string, v: string) => setSp((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const changeView = (v: 'lista' | 'tablero') => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* sin almacenamiento */ } }

  /** Órdenes que cumplen búsqueda, mecánico y prioridad (antes de filtrar por estado: así los conteos de los chips son coherentes). */
  const base = useMemo(() => {
    const t = norm(q.trim())
    return data.orders.filter((o) => {
      if (mech && (mech === '-' ? o.mechanicId : o.mechanicId !== mech)) return false
      if (prio && o.priority !== prio) return false
      if (!t) return true
      const c = data.custMap.get(o.customerId), v = data.vehMap.get(o.vehicleId)
      return [o.folio, c?.name, v?.plate, v?.vin, v?.make, v?.model, o.complaint].some((x) => norm(x).includes(t))
    })
  }, [data.orders, data.custMap, data.vehMap, q, mech, prio])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const o of base) c.set(o.status, (c.get(o.status) ?? 0) + 1)
    return c
  }, [base])
  const openCount = base.filter((o) => !isClosed(o)).length

  const rows = useMemo(() => {
    const list = base.filter((o) => (estado === 'todas' ? true : estado === 'abiertas' ? !isClosed(o) : o.status === estado))
    // Abiertas primero (prioridad y fecha promesa); cerradas después, de la más reciente a la más antigua.
    return [...list].sort((a, b) => {
      const ca = isClosed(a), cb = isClosed(b)
      if (ca !== cb) return ca ? 1 : -1
      if (ca) return b.receivedAt.localeCompare(a.receivedAt)
      if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
      if ((a.promisedAt ?? '') !== (b.promisedAt ?? '')) return !a.promisedAt ? 1 : !b.promisedAt ? -1 : a.promisedAt.localeCompare(b.promisedAt)
      return a.receivedAt.localeCompare(b.receivedAt)
    })
  }, [base, estado])
  const overdue = data.orders.filter((o) => promiseInfo(o, now, data.today)?.overdue).length

  const vehText = (o: WorkOrder) => plateOf(data.vehMap.get(o.vehicleId))
  const custText = (o: WorkOrder) => data.custMap.get(o.customerId)?.name ?? '—'
  const saldo = (o: WorkOrder) => {
    const sale = saleOfOrder(data, o)
    if (sale) {
      if (sale.status === 'cancelada') return <Badge tone="bad">Venta cancelada</Badge>
      const bal = saleBalance(sale, data.ledger)
      return bal > 0 ? <span className="neg">{formatMXN(bal)}</span> : <Badge tone="ok">Pagada</Badge>
    }
    const adv = advancesOf(data.ledger, o.id)
    return adv > 0 ? <span title="Anticipo recibido; aún no hay venta">Anticipo {formatMXN(adv)}</span> : <span className="muted">—</span>
  }
  const promesa = (o: WorkOrder) => {
    const p = promiseInfo(o, now, data.today)
    if (!p) return <span className="muted">—</span>
    return p.overdue ? <span className="ord-overdue">{p.text} · Vencida</span> : <span>{p.text}</span>
  }
  const enTaller = (o: WorkOrder) => { const m = minutesInShop(o, now); return m === null ? <span className="muted">—</span> : <span>{fmtSpan(m)}</span> }

  const cols: Column<WorkOrder>[] = tableMode ? [
    { key: 'folio', label: 'Folio', primary: true, render: (o) => <span className="row" style={{ gap: 6 }}><b className="nowrap">{o.folio}</b>{o.isWarranty && <Badge tone="warn">Garantía</Badge>}</span> },
    { key: 'cli', label: 'Cliente', render: (o) => custText(o) },
    { key: 'veh', label: 'Vehículo', render: (o) => vehText(o) },
    { key: 'est', label: 'Estado', render: (o) => <StatusBadge status={o.status} /> },
    { key: 'mec', label: 'Mecánico', render: (o) => mechanicName(data, o.mechanicId) },
    { key: 'pri', label: 'Prioridad', render: (o) => <PriorityBadge priority={o.priority} /> },
    { key: 'pro', label: 'Promesa', render: promesa },
    { key: 'tal', label: 'En taller', render: enTaller },
    ...(canSeeMoney ? [{ key: 'sal', label: 'Saldo', align: 'r' as const, render: saldo }] : []),
  ] : [
    { key: 'folio', label: 'Folio', primary: true, render: (o) => <span className="row wrap" style={{ gap: 6 }}><b>{o.folio}</b><StatusBadge status={o.status} />{o.isWarranty && <Badge tone="warn">Garantía</Badge>}</span> },
    { key: 'cli', label: 'Cliente', render: (o) => custText(o) },
    { key: 'veh', label: 'Vehículo', render: (o) => vehText(o) },
    { key: 'mec', label: 'Mecánico', render: (o) => mechanicName(data, o.mechanicId) },
    { key: 'pri', label: 'Prioridad', render: (o) => <PriorityBadge priority={o.priority} /> },
    { key: 'pro', label: 'Promesa', render: promesa },
    { key: 'tal', label: 'En taller', render: enTaller },
    ...(canSeeMoney ? [{ key: 'sal', label: 'Saldo', render: saldo }] : []),
  ]

  const chipOptions: [string, string][] = [
    ['abiertas', `Abiertas (${openCount})`], ['todas', `Todas (${base.length})`],
    ...STATUS_ORDER.map((s) => [s, `${STATUS_LABEL[s]} (${counts.get(s) ?? 0})`] as [string, string]),
  ]
  const filtered = !!(q || mech || prio)
  const clear = () => { setSp({}, { replace: true }); setMech(''); setPrio('') }
  const mechs = mechanicsOf(data)

  const boardCols: OrderStatus[] = estado === 'todas' ? STATUS_ORDER : estado === 'abiertas' ? OPEN_STATUSES : [estado]

  return (
    <div className="stack-lg">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Órdenes de trabajo</h1>
          <div className="sub">{openCount} abiertas{overdue > 0 && <> · <span className="ord-overdue">{overdue} con fecha promesa vencida</span></>}{!allSeen && ' · Solo ves las órdenes asignadas a ti'}</div>
        </div>
        <div className="row wrap">
          {desktop && <Seg<'lista' | 'tablero'> label="Vista" value={view} onChange={changeView} options={[['lista', 'Lista'], ['tablero', 'Tablero']]} />}
          {data.can('ordenes.crear') && <button className="btn primary" onClick={() => open({ k: 'order' })}><Icon n="plus" size={18} />Nueva orden</button>}
        </div>
      </div>

      <div className="stack">
        <div className="ord-filters">
          <div className="search">
            <Icon n="search" size={18} />
            <input type="search" value={q} onChange={(e) => setParam('q', e.target.value)} placeholder="Buscar folio, cliente, placas o motivo…" aria-label="Buscar órdenes" />
          </div>
          {allSeen && <Field label="Mecánico"><select value={mech} onChange={(e) => setMech(e.target.value)}><option value="">Todos</option><option value="-">Sin asignar</option>{mechs.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
          <Field label="Prioridad"><select value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">Todas</option>{(['urgente', 'alta', 'normal', 'baja'] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></Field>
        </div>
        <Chips value={estado} options={chipOptions} onChange={(v) => setParam('estado', v === 'abiertas' ? '' : v)} />
      </div>

      {data.orders.length === 0 ? (
        <Empty title="Aún no hay órdenes de trabajo" text="Una orden registra la recepción del vehículo, los trabajos autorizados, las refacciones usadas y el tiempo de los mecánicos; con ella se calcula la utilidad real de cada reparación." action={data.can('ordenes.crear') ? <button className="btn primary" onClick={() => open({ k: 'order' })}>Crear la primera orden</button> : undefined} />
      ) : rows.length === 0 ? (
        <Empty title="Sin órdenes con estos filtros" text={estado !== 'todas' && estado !== 'abiertas' ? `No hay órdenes en estado «${STATUS_LABEL[estado]}»${filtered ? ' con los filtros aplicados' : ''}.` : filtered ? 'Ninguna orden coincide con la búsqueda o los filtros.' : 'No hay órdenes abiertas: todo está entregado o cancelado.'} action={<span className="row" style={{ justifyContent: 'center' }}>{(filtered || estado !== 'abiertas') && <button className="btn" onClick={clear}>Quitar filtros</button>}</span>} />
      ) : showBoard ? (
        <div className="stack">
          <div className="small muted">Abre una orden para cambiar su estado: cada cambio valida sus requisitos (autorización, mecánico, trabajos pendientes).</div>
          <div className="kanban" role="group" aria-label="Tablero de órdenes por estado">
            {boardCols.map((s) => {
              const col = rows.filter((o) => o.status === s)
              return (
                <section key={s} className="kcol" aria-label={STATUS_LABEL[s]}>
                  <h4><span>{STATUS_LABEL[s]}</span><span>{col.length}</span></h4>
                  {!col.length && <div className="small muted">Sin órdenes.</div>}
                  {col.map((o) => {
                    const p = promiseInfo(o, now, data.today)
                    return (
                      <Link key={o.id} to={`/ordenes/${o.id}`} className="ord-kcard">
                        <span className="row between"><span className="f">{o.folio}</span><PriorityBadge priority={o.priority} /></span>
                        <span>{custText(o)}</span>
                        <span className="m">{vehText(o)}</span>
                        <span className="m">{mechanicName(data, o.mechanicId)}</span>
                        <span className="row wrap" style={{ gap: 6 }}>{o.isWarranty && <Badge tone="warn">Garantía</Badge>}{p && <span className={`m ${p.overdue ? 'ord-overdue' : ''}`}>Promesa: {p.text}{p.overdue ? ' · Vencida' : ''}</span>}</span>
                      </Link>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <div className="small muted">{rows.length} {rows.length === 1 ? 'orden' : 'órdenes'}. Abiertas primero, por prioridad y fecha promesa.</div>
          <DataTable rows={rows} rowKey={(o) => o.id} columns={cols} onRow={(o) => nav(`/ordenes/${o.id}`)} />
        </>
      )}
    </div>
  )
}
