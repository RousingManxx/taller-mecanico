import { Link } from 'react-router-dom'
import { saveSettings } from '../services/catalog'
import { useOpen, type Sheet } from '../ui/create'
import type { Data } from '../ui/data'
import { useCtx } from '../ui/session'
import { useUi } from '../ui/ui'

export function Guia({ data }: { data: Data }) {
  const open = useOpen(), ctx = useCtx(), ui = useUi()
  const s = data.settings
  const steps: { done: boolean; title: string; text: string; to?: string; sheet?: Sheet; cta: string }[] = [
    { done: !!s.address || !!s.phone, title: 'Datos de tu taller', text: 'Nombre, dirección, teléfono y logotipo: aparecen en cotizaciones, órdenes y comprobantes.', to: '/ajustes', cta: 'Abrir ajustes' },
    { done: s.taxes.length > 0 && s.labor.productiveHoursPerMonth > 0, title: 'Impuestos, márgenes y mano de obra', text: 'Revisa la tasa de IVA con tu contador, el margen objetivo y las horas productivas por mecánico.', to: '/ajustes', cta: 'Revisar' },
    { done: data.employees.some((e) => e.isMechanic && e.monthlyCostCents > 0), title: 'Tus mecánicos y su costo laboral', text: 'Con su costo por hora productiva, cada orden mostrará su costo real de mano de obra.', sheet: { k: 'employee' }, cta: 'Agregar mecánico' },
    { done: data.services.length > 0, title: 'Catálogo de servicios', text: 'Servicios que ofreces, con horas estándar y precio: afinación, frenos, diagnóstico…', sheet: { k: 'service' }, cta: 'Agregar servicio' },
    { done: data.products.length > 0 && data.receipts.length > 0, title: 'Refacciones y tu primera compra', text: 'Registra productos y recibe una compra: el inventario y su costo promedio se calculan solos.', sheet: { k: 'product' }, cta: 'Agregar producto' },
    { done: data.customers.length > 0 && data.vehicles.length > 0, title: 'Primer cliente y vehículo', text: 'Cada vehículo tiene su historial de intervenciones y detecta recurrencias de fallas.', sheet: { k: 'customer' }, cta: 'Registrar cliente' },
    { done: data.orders.length > 0, title: 'Tu primera orden de trabajo', text: 'Recibe el vehículo, diagnostica, cotiza, autoriza, repara y entrega. La rentabilidad real aparece al cerrar.', sheet: { k: 'order' }, cta: 'Crear orden' },
    { done: data.cashSessions.length > 0, title: 'Abre la caja', text: 'Los cobros en efectivo se registran dentro de una sesión de caja que se cuadra al cierre.', to: '/caja', cta: 'Ir a caja' },
    { done: !!s.lastBackupAt, title: 'Haz tu primera copia de seguridad', text: 'Tus datos viven en este dispositivo: descarga una copia con frecuencia.', to: '/ajustes', cta: 'Ir a copias' },
  ]
  const done = steps.filter((x) => x.done).length
  const finish = () => ui.run(() => saveSettings(ctx, { onboardingDone: true }), 'Guía completada')
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Guía de inicio</h1><div className="sub">{done} de {steps.length} pasos completos</div></div></div>
      <div className="bar" role="img" aria-label={`${done} de ${steps.length} pasos`}><span style={{ width: `${(done / steps.length) * 100}%`, background: 'var(--accent)' }} /></div>
      <div className="stack">{steps.map((st, i) => (
        <div key={st.title} className="card row" style={{ alignItems: 'flex-start' }}>
          <span className="badge" style={st.done ? { background: 'var(--ok-soft)', color: 'var(--ok)' } : undefined} aria-label={st.done ? 'Completo' : 'Pendiente'}>{st.done ? '✓' : i + 1}</span>
          <div className="grow"><b>{st.title}</b><p className="small muted" style={{ margin: '2px 0 8px' }}>{st.text}</p>
            {st.to ? <Link className="btn small" to={st.to}>{st.cta}</Link> : st.sheet ? <button className="btn small" onClick={() => open(st.sheet!)}>{st.cta}</button> : null}</div>
        </div>))}</div>
      <div className="card flat stack-sm"><b>¿Qué distingue a Torque?</b>
        <p className="small muted">Cada venta, refacción y orden muestra su <b>costo real</b>, su <b>utilidad</b> y su <b>margen</b> (utilidad ÷ venta neta, no el markup). Las ventas no se confunden con los cobros, ni la utilidad con el saldo bancario. Revisa «Costos y rentabilidad» cuando tengas tus primeras órdenes cerradas.</p></div>
      <div className="row wrap"><button className="btn primary" onClick={finish}>Terminar guía</button><Link className="btn" to="/">Ir al inicio</Link></div>
    </div>
  )
}
