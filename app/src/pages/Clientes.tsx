import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { formatMXN } from '../domain/money'
import { aggregateCustomers, digits, norm } from '../ui/crm/lib'
import { SearchBox } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, type Data } from '../ui/data'
import { Badge, DataTable, Empty, Seg, type Column } from '../ui/ui'
import type { Customer } from '../domain/types'

type Filter = 'activos' | 'inactivos' | 'todos'

export function Clientes({ data }: { data: Data }) {
  const nav = useNavigate(), open = useOpen()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const filter = (sp.get('f') as Filter | null) ?? 'activos'
  const setParam = (k: string, v: string, def = '') => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== def) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const agg = useMemo(() => aggregateCustomers(data), [data])
  const money = data.can('ventas.ver')

  const rows = useMemo(() => {
    const t = norm(q.trim()), dq = digits(q)
    return data.customers
      .filter((c) => (filter === 'todos' ? true : filter === 'activos' ? c.active : !c.active))
      .filter((c) => !t || norm(c.name).includes(t) || norm(c.email).includes(t) || norm(c.taxId).includes(t) || norm(c.fiscalName).includes(t) || norm(c.id).includes(t) || (dq.length >= 3 && digits(c.phone).includes(dq)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [data.customers, q, filter])
  const totalDebt = money ? rows.reduce((a, c) => a + (agg.get(c.id)?.balanceCents ?? 0), 0) : 0

  const cols: Column<Customer>[] = [
    { key: 'name', label: 'Cliente', primary: true, render: (c) => <span>{c.name}{!c.active && <> <Badge>Inactivo</Badge></>}</span> },
    { key: 'phone', label: 'Teléfono', render: (c) => c.phone || '—' },
    { key: 'email', label: 'Correo', hideMobile: true, render: (c) => c.email || '—' },
    { key: 'veh', label: 'Vehículos', align: 'r', render: (c) => agg.get(c.id)?.vehicles ?? 0 },
    { key: 'visits', label: 'Visitas', align: 'r', render: (c) => agg.get(c.id)?.visits ?? 0 },
    { key: 'last', label: 'Última visita', hideMobile: true, render: (c) => fmtDate(agg.get(c.id)?.lastVisit) },
    ...(money ? [{ key: 'bal', label: 'Saldo pendiente', align: 'r' as const, render: (c: Customer) => { const b = agg.get(c.id)?.balanceCents ?? 0; return b > 0 ? <span className="neg">{formatMXN(b)}</span> : <span className="muted">{formatMXN(0)}</span> } }] : []),
  ]

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Clientes</h1><div className="sub">{data.customers.filter((c) => c.active).length} activos · {data.customers.length} registrados</div></div>
        {data.can('clientes.editar') && <button className="btn primary" onClick={() => open({ k: 'customer' })}>Nuevo cliente</button>}
      </div>
      <div className="stack">
        <SearchBox value={q} onChange={(v) => setParam('q', v)} placeholder="Buscar por nombre, teléfono, correo, RFC o folio de cliente" label="Buscar clientes" />
        <Seg<Filter> value={filter} options={[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']]} onChange={(v) => setParam('f', v, 'activos')} label="Filtrar por estado" />
        {money && totalDebt > 0 && <div className="small muted" role="status">Saldo pendiente de los clientes mostrados: <b className="neg">{formatMXN(totalDebt)}</b> (ventas emitidas menos devoluciones y cobros).</div>}
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(c) => c.id} onRow={(c) => nav(`/clientes/${c.id}`)}
        empty={<Empty title={q || filter !== 'activos' ? 'Ningún cliente coincide' : 'Aún no hay clientes'} text={q ? 'Prueba con otro nombre, teléfono o correo, o revisa el filtro de estado.' : 'Registra a tu primer cliente para empezar a guardar su historial.'} action={!q && data.can('clientes.editar') ? <button className="btn primary" onClick={() => open({ k: 'customer' })}>Registrar cliente</button> : undefined} />} />
    </div>
  )
}
