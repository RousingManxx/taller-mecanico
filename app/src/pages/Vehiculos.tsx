import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Vehicle } from '../domain/types'
import { norm, visitDay } from '../ui/crm/lib'
import { SearchBox } from '../ui/crm/parts'
import { useOpen } from '../ui/create'
import { fmtDate, type Data } from '../ui/data'
import { Badge, DataTable, Empty, Seg, type Column } from '../ui/ui'

type Filter = 'activos' | 'inactivos' | 'todos'

export function Vehiculos({ data }: { data: Data }) {
  const nav = useNavigate(), open = useOpen()
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') ?? ''
  const filter = (sp.get('f') as Filter | null) ?? 'activos'
  const setParam = (k: string, v: string, def = '') => setSp((p) => { const n = new URLSearchParams(p); if (v && v !== def) n.set(k, v); else n.delete(k); return n }, { replace: true })

  const lastVisit = useMemo(() => {
    const m = new Map<string, string>()
    for (const o of data.orders) { if (o.status !== 'entregada') continue; const d = visitDay(o, data.settings.timezone); if (d > (m.get(o.vehicleId) ?? '')) m.set(o.vehicleId, d) }
    return m
  }, [data.orders, data.settings.timezone])

  const rows = useMemo(() => {
    const t = norm(q.trim())
    return data.vehicles
      .filter((v) => (filter === 'todos' ? true : filter === 'activos' ? v.active : !v.active))
      .filter((v) => !t || norm(v.plate).includes(t) || norm(v.vin).includes(t) || norm(v.make).includes(t) || norm(v.model).includes(t) || norm(`${v.make} ${v.model}`).includes(t) || norm(data.custMap.get(v.customerId)?.name).includes(t))
      .sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, 'es') || a.plate.localeCompare(b.plate))
  }, [data.vehicles, data.custMap, q, filter])

  const cols: Column<Vehicle>[] = [
    { key: 'v', label: 'Vehículo', primary: true, render: (v) => <span>{v.make} {v.model}{v.year ? ` ${v.year}` : ''}{!v.active && <> <Badge>Inactivo</Badge></>}</span> },
    { key: 'p', label: 'Placas', render: (v) => v.plate || <span className="muted">Sin placas</span> },
    { key: 'vin', label: 'VIN', hideMobile: true, render: (v) => v.vin || '—' },
    { key: 'o', label: 'Propietario', render: (v) => data.custMap.get(v.customerId)?.name ?? '—' },
    { key: 'km', label: 'Km', align: 'r', render: (v) => v.km.toLocaleString('es-MX') },
    { key: 'l', label: 'Última visita', hideMobile: true, render: (v) => fmtDate(lastVisit.get(v.id)) },
  ]
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div><h1>Vehículos</h1><div className="sub">{data.vehicles.filter((v) => v.active).length} activos · {data.vehicles.length} registrados</div></div>
        {data.can('vehiculos.editar') && <button className="btn primary" onClick={() => open({ k: 'vehicle' })}>Nuevo vehículo</button>}
      </div>
      <div className="stack">
        <SearchBox value={q} onChange={(v) => setParam('q', v)} placeholder="Buscar por placas, VIN, marca, modelo o propietario" label="Buscar vehículos" />
        <Seg<Filter> value={filter} options={[['activos', 'Activos'], ['inactivos', 'Inactivos'], ['todos', 'Todos']]} onChange={(v) => setParam('f', v, 'activos')} label="Filtrar por estado" />
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(v) => v.id} onRow={(v) => nav(`/vehiculos/${v.id}`)}
        empty={<Empty title={q || filter !== 'activos' ? 'Ningún vehículo coincide' : 'Aún no hay vehículos'} text={q ? 'Prueba con otras placas, VIN, marca o propietario, o revisa el filtro de estado.' : 'Registra el primer vehículo de un cliente para llevar su historial.'} action={!q && data.can('vehiculos.editar') ? <button className="btn primary" onClick={() => open({ k: 'vehicle' })}>Registrar vehículo</button> : undefined} />} />
    </div>
  )
}
