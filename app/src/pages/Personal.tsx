import { useMemo } from 'react'
import { diffDays, inRange } from '../domain/dates'
import { hourlyLaborCost } from '../domain/labor'
import { formatMXN, formatNum } from '../domain/money'
import { billableItems } from '../domain/orders'
import { marginPct } from '../domain/pricing'
import { useOpen } from '../ui/create'
import type { Data } from '../ui/data'
import { PeriodPicker, usePeriod } from '../ui/period'
import { Badge, DataTable, Empty, Icon } from '../ui/ui'

export function Personal({ data }: { data: Data }) {
  const open = useOpen()
  const ps = usePeriod(data.today, 'mes')
  const canSal = data.can('personal.salarios'), canCost = data.can('costos.ver'), canEdit = data.can('personal.editar')
  const days = diffDays(ps.range.from, ps.range.to) + 1
  const rows = useMemo(() => data.employees.map((e) => {
    let worked = 0, billed = 0, services = 0, rework = 0, net = 0, cost = 0
    const orders = new Set<string>()
    for (const o of data.orders) {
      for (const t of o.timeEntries) if (t.kind === 'trabajo' && t.endAt && t.employeeId === e.id && inRange(t.endAt.slice(0, 10), ps.range)) { worked += t.minutes / 60; orders.add(o.id) }
      if (o.status === 'entregada' && o.deliveredAt && inRange(o.deliveredAt.slice(0, 10), ps.range)) {
        for (const i of billableItems(o)) if (i.type === 'servicio' && (i.mechanicId ?? o.mechanicId) === e.id) { services++; if (!o.isWarranty) billed += i.stdHours * i.qty; orders.add(o.id) }
      }
      if (o.isWarranty && inRange(o.receivedAt.slice(0, 10), ps.range)) { const orig = data.orderMap.get(o.warrantyOfOrderId ?? '') ?? data.orders.find((x) => x.id === o.warrantyOfOrderId); if (orig?.mechanicId === e.id) rework++ }
    }
    for (const s of data.sales) if (s.status === 'emitida' && inRange(s.date, ps.range)) for (const i of s.items) if (i.type === 'servicio' && i.mechanicId === e.id) { net += i.netCents; cost += i.costCents }
    const available = (e.productiveHoursPerMonth ?? data.settings.labor.productiveHoursPerMonth) * (days / 30.4)
    return { e, worked, billed, services, rework, net, cost, orders: orders.size, available, hourly: hourlyLaborCost(e, data.settings) }
  }), [data, ps.range, days])
  const mech = rows.filter((r) => r.e.isMechanic)
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Personal y productividad</h1><div className="sub">{data.employees.filter((e) => e.active).length} activo(s) · {ps.label}</div></div>{canEdit && <button className="btn primary" onClick={() => open({ k: 'employee' })}><Icon n="plus" size={18} />Nuevo empleado</button>}</div>
      {!canSal && <div className="banner info">La información salarial está oculta para tu rol.</div>}
      <PeriodPicker s={ps} />
      {!data.employees.length ? <Empty title="Aún no hay empleados" text="Agrega a tus mecánicos para asignarles órdenes, registrar sus tiempos y medir su productividad." action={canEdit ? <button className="btn primary" onClick={() => open({ k: 'employee' })}>Agregar empleado</button> : undefined} /> : (
        <DataTable rows={rows} rowKey={(r) => r.e.id} onRow={canEdit ? (r) => open({ k: 'employee', v: data.employees.find((x) => x.id === r.e.id) }) : undefined}
          columns={[
            { key: 'n', label: 'Empleado', primary: true, render: (r) => <>{r.e.name} {!r.e.active && <Badge>Inactivo</Badge>}<div className="small muted">{r.e.role}{r.e.specialty ? ` · ${r.e.specialty}` : ''}</div></> },
            { key: 'a', label: 'Horas disponibles (est.)', align: 'r', hideMobile: true, render: (r) => (r.e.isMechanic ? formatNum(r.available) : '—') }, { key: 'w', label: 'Horas trabajadas', align: 'r', render: (r) => (r.e.isMechanic ? formatNum(r.worked) : '—') },
            { key: 'b', label: 'Horas facturadas', align: 'r', render: (r) => (r.e.isMechanic ? formatNum(r.billed) : '—') }, { key: 'u', label: 'Utilización', align: 'r', hideMobile: true, render: (r) => (r.e.isMechanic && r.available > 0 ? formatNum((r.worked / r.available) * 100) + ' %' : 'n/c') },
            { key: 'f', label: 'Eficiencia', align: 'r', render: (r) => (r.worked > 0 ? formatNum((r.billed / r.worked) * 100) + ' %' : 'n/c') },
            { key: 'o', label: 'Órdenes', align: 'r', render: (r) => r.orders }, { key: 's', label: 'Servicios', align: 'r', hideMobile: true, render: (r) => r.services }, { key: 'r', label: 'Retrabajos', align: 'r', hideMobile: true, render: (r) => <span className={r.rework ? 'neg' : ''}>{r.rework}</span> },
            { key: 'v', label: 'Mano de obra vendida', align: 'r', hideMobile: true, render: (r) => (canCost ? formatMXN(r.net) : '—') },
            { key: 'p', label: 'Utilidad de sus trabajos', align: 'r', hideMobile: true, render: (r) => (canCost ? <>{formatMXN(r.net - r.cost)} <span className="small muted">({marginPct(r.net, r.cost) === null ? 'n/c' : formatNum(marginPct(r.net, r.cost)!) + ' %'})</span></> : '—') },
            ...(canSal ? [{ key: 'h', label: 'Costo por hora', align: 'r' as const, hideMobile: true, render: (r: (typeof rows)[number]) => (r.e.isMechanic ? (r.e.monthlyCostCents ? formatMXN(r.hourly) : 'sin captura') : '—') }] : []),
          ]} />
      )}
      {mech.length > 0 && <div className="card flat stack-sm"><b>Cómo leer estos indicadores</b>
        <p className="small muted">Horas trabajadas = tramos registrados con cronómetro. Horas facturadas = tiempo estándar de los servicios entregados (sin garantías). Eficiencia = facturadas ÷ trabajadas. Utilización = trabajadas ÷ horas productivas disponibles (estimadas por días del periodo). Las ventas atribuidas a una persona no son el beneficio que ella generó: dependen del tipo de servicio, la calidad y los retrabajos. Los datos de nómina aquí son estimaciones gerenciales.</p></div>}
    </div>
  )
}
