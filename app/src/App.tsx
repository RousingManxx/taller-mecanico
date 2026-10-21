import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { registry } from './db/db'
import type { Permission } from './domain/permissions'
import { ROLE_LABEL } from './domain/permissions'
import { Agenda } from './pages/Agenda'
import { Ajustes } from './pages/Ajustes'
import { Caja } from './pages/Caja'
import { ClienteFicha } from './pages/ClienteFicha'
import { Clientes } from './pages/Clientes'
import { Cobranza } from './pages/Cobranza'
import { Compras } from './pages/Compras'
import { CotizacionDetalle } from './pages/CotizacionDetalle'
import { Cotizaciones } from './pages/Cotizaciones'
import { Gastos } from './pages/Gastos'
import { Guia } from './pages/Guia'
import { Imprimir } from './pages/Imprimir'
import { Inicio } from './pages/Inicio'
import { Inventario } from './pages/Inventario'
import { OrdenDetalle } from './pages/OrdenDetalle'
import { Ordenes } from './pages/Ordenes'
import { Personal } from './pages/Personal'
import { Rentabilidad } from './pages/Rentabilidad'
import { Reportes } from './pages/Reportes'
import { VehiculoFicha } from './pages/VehiculoFicha'
import { Vehiculos } from './pages/Vehiculos'
import { VentaDetalle } from './pages/VentaDetalle'
import { Ventas } from './pages/Ventas'
import { Welcome } from './pages/Welcome'
import { buildAlerts } from './ui/alerts'
import { SheetHost, useOpen, type Sheet as SheetKind } from './ui/create'
import { useData, type Data } from './ui/data'
import { SearchPanel } from './ui/search'
import { SessionProvider, useSession } from './ui/session'
import { Icon, Sheet, UiProvider } from './ui/ui'

interface NavItem { to: string; label: string; icon: string; perm?: Permission | Permission[]; group: string; badge?: 'orders' | 'alerts' }
const NAV: NavItem[] = [
  { to: '/', label: 'Inicio', icon: 'home', group: 'Operación' },
  { to: '/agenda', label: 'Agenda', icon: 'cal', perm: 'agenda.ver', group: 'Operación' },
  { to: '/ordenes', label: 'Órdenes de trabajo', icon: 'wrench', perm: 'ordenes.ver', group: 'Operación', badge: 'orders' },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: 'doc', perm: 'cotizaciones.ver', group: 'Operación' },
  { to: '/clientes', label: 'Clientes', icon: 'users', perm: 'clientes.ver', group: 'Operación' },
  { to: '/vehiculos', label: 'Vehículos', icon: 'car', perm: 'vehiculos.ver', group: 'Operación' },
  { to: '/ventas', label: 'Ventas y cobros', icon: 'cash', perm: 'ventas.ver', group: 'Comercial' },
  { to: '/inventario', label: 'Refacciones e inventario', icon: 'box', perm: 'inventario.ver', group: 'Comercial' },
  { to: '/compras', label: 'Compras y proveedores', icon: 'truck', perm: 'compras.ver', group: 'Comercial' },
  { to: '/rentabilidad', label: 'Costos y rentabilidad', icon: 'pie', perm: 'finanzas.ver', group: 'Finanzas' },
  { to: '/caja', label: 'Caja y dinero', icon: 'wallet', perm: 'caja.ver', group: 'Finanzas' },
  { to: '/gastos', label: 'Gastos', icon: 'receipt', perm: 'gastos.ver', group: 'Finanzas' },
  { to: '/cobranza', label: 'Por cobrar y por pagar', icon: 'inbox', perm: ['ventas.ver', 'gastos.ver', 'compras.ver'], group: 'Finanzas' },
  { to: '/personal', label: 'Personal', icon: 'users', perm: 'personal.ver', group: 'Equipo' },
  { to: '/reportes', label: 'Reportes', icon: 'chart', perm: ['finanzas.ver', 'ventas.ver', 'inventario.ver'], group: 'Equipo' },
  { to: '/ajustes', label: 'Ajustes', icon: 'gear', group: 'Sistema' },
]
const allowedNav = (d: Data, n: NavItem) => !n.perm || (Array.isArray(n.perm) ? n.perm.some((p) => d.can(p)) : d.can(n.perm))
const QUICK: { k: SheetKind['k']; label: string; icon: string; perm: Permission }[] = [
  { k: 'order', label: 'Nueva orden de trabajo', icon: 'wrench', perm: 'ordenes.crear' },
  { k: 'customer', label: 'Registrar cliente', icon: 'user', perm: 'clientes.editar' },
  { k: 'vehicle', label: 'Registrar vehículo', icon: 'car', perm: 'vehiculos.editar' },
  { k: 'quote', label: 'Crear cotización', icon: 'doc', perm: 'cotizaciones.editar' },
  { k: 'sale', label: 'Registrar una venta', icon: 'cash', perm: 'ventas.crear' },
  { k: 'payment', label: 'Registrar un pago', icon: 'wallet', perm: 'cobros.registrar' },
  { k: 'purchase', label: 'Registrar compra', icon: 'truck', perm: 'compras.editar' },
  { k: 'expense', label: 'Registrar gasto', icon: 'receipt', perm: 'gastos.editar' },
  { k: 'appointment', label: 'Agendar cita', icon: 'cal', perm: 'agenda.editar' },
]

function useEscape(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [on, close])
}

function QuickMenu({ data, cls }: { data: Data; cls: string }) {
  const [on, setOn] = useState(false)
  const open = useOpen()
  const first = useRef<HTMLButtonElement>(null)
  useEscape(on, () => setOn(false))
  useEffect(() => { if (on) first.current?.focus() }, [on])
  const items = QUICK.filter((q) => data.can(q.perm))
  if (!items.length) return null
  return (
    <>
      <button className={cls} aria-label="Acciones rápidas" aria-haspopup="menu" aria-expanded={on} onClick={() => setOn(!on)}>{cls.includes('iconbtn') ? <Icon n="plus" /> : <><Icon n="plus" size={18} />Nuevo</>}</button>
      {on && (<>
        <div className="scrim" onClick={() => setOn(false)} />
        <div className="menu glass topleft" role="menu">
          {items.map((q, i) => <button key={q.k} role="menuitem" ref={i === 0 ? first : undefined} onClick={() => { setOn(false); open({ k: q.k } as SheetKind) }}><Icon n={q.icon} size={20} />{q.label}</button>)}
          {data.can('finanzas.ver') && <><hr /><Link role="menuitem" to="/rentabilidad" onClick={() => setOn(false)}><Icon n="pie" size={20} />Consultar rentabilidad</Link></>}
        </div>
      </>)}
    </>
  )
}

function AlertsSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const alerts = useMemo(() => buildAlerts(data), [data])
  const nav = useNavigate()
  return (
    <Sheet title="Notificaciones" onClose={onClose}>
      {!alerts.length && <p className="muted">Todo en orden: no hay alertas pendientes.</p>}
      <div className="stack-sm">
        {alerts.map((a) => <button key={a.id} className="item" onClick={() => { nav(a.to); onClose() }}><span className={`badge ${a.tone === 'info' ? 'info' : a.tone}`}>{a.tone === 'bad' ? 'Crítica' : a.tone === 'warn' ? 'Aviso' : 'Info'}</span><div className="grow"><div className="ttl">{a.title}</div><div className="sub">{a.detail}</div></div></button>)}
      </div>
    </Sheet>
  )
}

function ProfileMenu({ data, onClose }: { data: Data; onClose: () => void }) {
  const { user, logout } = useSession()
  useEscape(true, onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="menu glass topright" role="menu">
        <div style={{ padding: '8px 12px' }}><b>{user.name}</b><div className="small muted">{ROLE_LABEL[user.role]}</div><div className="small muted">{data.settings.businessName}</div></div>
        <hr />
        <Link role="menuitem" to="/ajustes" onClick={onClose}><Icon n="gear" size={20} />Ajustes</Link>
        <Link role="menuitem" to="/guia" onClick={onClose}><Icon n="info" size={20} />Guía de inicio</Link>
        <button role="menuitem" onClick={() => { onClose(); logout() }}><Icon n="logout" size={20} />Cerrar sesión / cambiar de taller</button>
      </div>
    </>
  )
}

function MoreSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const nav = NAV.filter((n) => allowedNav(data, n))
  return (
    <Sheet title="Todos los módulos" onClose={onClose}>
      <div className="morelist">{nav.map((n) => <NavLink key={n.to} to={n.to} onClick={onClose} end={n.to === '/'}><Icon n={n.icon} size={24} />{n.label}</NavLink>)}</div>
    </Sheet>
  )
}

function Guard({ data, perm, children }: { data: Data; perm?: Permission | Permission[]; children: ReactNode }) {
  if (perm && !(Array.isArray(perm) ? perm.some((p) => data.can(p)) : data.can(perm))) return <div className="empty"><h3>Sin acceso</h3><p>Tu rol no tiene permiso para ver esta sección. Pide acceso al propietario del taller.</p></div>
  return <>{children}</>
}

function Shell() {
  const { ctx, user } = useSession()
  const data = useData(ctx)
  const loc = useLocation()
  const nav = useNavigate()
  const [panel, setPanel] = useState<null | 'alerts' | 'profile' | 'more' | 'search'>(null)
  const redirected = useRef(false)
  const org = useLiveQuery(() => registry.orgs.get(ctx.orgId), [ctx.orgId])
  const alerts = useMemo(() => (data.ready ? buildAlerts(data) : []), [data])
  const crit = alerts.filter((a) => a.tone === 'bad').length
  const openOrders = data.orders.filter((o) => !['entregada', 'cancelada'].includes(o.status)).length
  const current = NAV.filter((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to))).pop()
  const title = current?.label ?? (loc.pathname.startsWith('/guia') ? 'Guía de inicio' : 'Torque')
  useEffect(() => {
    if (data.ready && !redirected.current) {
      redirected.current = true
      if (!data.settings.onboardingDone && !org?.demo && data.orders.length === 0 && data.customers.length === 0 && user.role === 'propietario') nav('/guia', { replace: true })
    }
  }, [data.ready, data.settings.onboardingDone, data.orders.length, data.customers.length, org, user.role, nav])
  useEffect(() => { document.title = `${title} · ${data.settings.businessName || 'Torque'}` }, [title, data.settings.businessName])
  if (!data.ready) return <div className="main muted" role="status">Cargando…</div>
  if (loc.pathname.startsWith('/imprimir')) return <Routes><Route path="/imprimir/:tipo/:id" element={<Imprimir data={data} />} /></Routes>
  const nitems = NAV.filter((n) => allowedNav(data, n))
  const groups = [...new Set(nitems.map((n) => n.group))]
  const tabs = [nitems.find((n) => n.to === '/'), nitems.find((n) => n.to === '/ordenes'), nitems.find((n) => n.to === '/inventario'), nitems.find((n) => n.to === '/rentabilidad') ?? nitems.find((n) => n.to === '/ventas')].filter(Boolean) as NavItem[]
  return (
    <SheetHost data={data}>
      <div className="app">
        <aside className="sidebar" aria-label="Navegación principal">
          <div className="brand"><span className="logo"><Icon n="wrench" size={18} /></span>Torque</div>
          {groups.map((g) => (<div key={g}><div className="grp">{g}</div>{nitems.filter((n) => n.group === g).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon n={n.icon} size={20} />{n.label}{n.badge === 'orders' && openOrders > 0 && <span className="badge-n">{openOrders}</span>}</NavLink>
          ))}</div>))}
          <div className="foot">{data.settings.businessName}<br />{user.name} · {ROLE_LABEL[user.role]}</div>
        </aside>
        <header className="desk-top">
          <div className="search"><Icon n="search" size={18} /><input type="search" placeholder="Buscar cliente, placas, folio, SKU…" aria-label="Búsqueda global" onFocus={() => setPanel('search')} readOnly /></div>
          <QuickMenu data={data} cls="btn primary" />
          <button className="iconbtn glass" aria-label={`Notificaciones${alerts.length ? ` (${alerts.length})` : ''}`} onClick={() => setPanel('alerts')}><Icon n="bell" />{alerts.length > 0 && <span className="dotbadge" style={crit ? undefined : { background: 'var(--warn)' }}>{alerts.length}</span>}</button>
          <button className="iconbtn glass" aria-label="Perfil de usuario" aria-haspopup="menu" onClick={() => setPanel('profile')}><Icon n="user" /></button>
        </header>
        <div className="topbar">
          <QuickMenu data={data} cls="iconbtn glass" />
          <div className="title">{title}</div>
          <button className="iconbtn glass" aria-label="Buscar" onClick={() => setPanel('search')}><Icon n="search" /></button>
          <button className="iconbtn glass" aria-label={`Notificaciones${alerts.length ? ` (${alerts.length})` : ''}`} onClick={() => setPanel('alerts')}><Icon n="bell" />{alerts.length > 0 && <span className="dotbadge" style={crit ? undefined : { background: 'var(--warn)' }}>{alerts.length}</span>}</button>
        </div>
        <nav className="tabbar glass" aria-label="Navegación principal móvil">
          {tabs.map((n) => <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}><Icon n={n.icon} size={22} /><span>{n.to === '/ordenes' ? 'Órdenes' : n.to === '/inventario' ? 'Inventario' : n.to === '/rentabilidad' ? 'Finanzas' : n.to === '/ventas' ? 'Ventas' : 'Inicio'}</span>{n.badge === 'orders' && openOrders > 0 && <span className="badge-n">{openOrders}</span>}</NavLink>)}
          <button className="tab" onClick={() => setPanel('more')} aria-label="Más módulos"><Icon n="more" size={22} /><span>Más</span></button>
        </nav>
        <main className="main">
          {org?.demo && <div className="banner info" style={{ marginBottom: 12 }}>Estás en el <b>taller de demostración</b>: todos los datos son ficticios y están separados de tus datos reales. <Link to="/ajustes">Administrar demostración</Link></div>}
          <div className="page" key={loc.pathname}>
            <Routes>
              <Route path="/" element={<Inicio data={data} />} />
              <Route path="/agenda" element={<Guard data={data} perm="agenda.ver"><Agenda data={data} /></Guard>} />
              <Route path="/clientes" element={<Guard data={data} perm="clientes.ver"><Clientes data={data} /></Guard>} />
              <Route path="/clientes/:id" element={<Guard data={data} perm="clientes.ver"><ClienteFicha data={data} /></Guard>} />
              <Route path="/vehiculos" element={<Guard data={data} perm="vehiculos.ver"><Vehiculos data={data} /></Guard>} />
              <Route path="/vehiculos/:id" element={<Guard data={data} perm="vehiculos.ver"><VehiculoFicha data={data} /></Guard>} />
              <Route path="/ordenes" element={<Guard data={data} perm="ordenes.ver"><Ordenes data={data} /></Guard>} />
              <Route path="/ordenes/:id" element={<Guard data={data} perm="ordenes.ver"><OrdenDetalle data={data} /></Guard>} />
              <Route path="/cotizaciones" element={<Guard data={data} perm="cotizaciones.ver"><Cotizaciones data={data} /></Guard>} />
              <Route path="/cotizaciones/:id" element={<Guard data={data} perm="cotizaciones.ver"><CotizacionDetalle data={data} /></Guard>} />
              <Route path="/ventas" element={<Guard data={data} perm="ventas.ver"><Ventas data={data} /></Guard>} />
              <Route path="/ventas/:id" element={<Guard data={data} perm="ventas.ver"><VentaDetalle data={data} /></Guard>} />
              <Route path="/inventario" element={<Guard data={data} perm="inventario.ver"><Inventario data={data} /></Guard>} />
              <Route path="/compras" element={<Guard data={data} perm="compras.ver"><Compras data={data} /></Guard>} />
              <Route path="/rentabilidad" element={<Guard data={data} perm="finanzas.ver"><Rentabilidad data={data} /></Guard>} />
              <Route path="/caja" element={<Guard data={data} perm="caja.ver"><Caja data={data} /></Guard>} />
              <Route path="/gastos" element={<Guard data={data} perm="gastos.ver"><Gastos data={data} /></Guard>} />
              <Route path="/cobranza" element={<Guard data={data} perm={['ventas.ver', 'gastos.ver', 'compras.ver']}><Cobranza data={data} /></Guard>} />
              <Route path="/personal" element={<Guard data={data} perm="personal.ver"><Personal data={data} /></Guard>} />
              <Route path="/reportes" element={<Guard data={data} perm={['finanzas.ver', 'ventas.ver', 'inventario.ver']}><Reportes data={data} /></Guard>} />
              <Route path="/reportes/:id" element={<Guard data={data} perm={['finanzas.ver', 'ventas.ver', 'inventario.ver']}><Reportes data={data} /></Guard>} />
              <Route path="/ajustes" element={<Ajustes data={data} />} />
              <Route path="/guia" element={<Guia data={data} />} />
              <Route path="*" element={<Inicio data={data} />} />
            </Routes>
          </div>
        </main>
      </div>
      {panel === 'alerts' && <AlertsSheet data={data} onClose={() => setPanel(null)} />}
      {panel === 'profile' && <ProfileMenu data={data} onClose={() => setPanel(null)} />}
      {panel === 'more' && <MoreSheet data={data} onClose={() => setPanel(null)} />}
      {panel === 'search' && <Sheet title="Buscar" onClose={() => setPanel(null)}><SearchPanel data={data} autoFocus onPick={() => setPanel(null)} /></Sheet>}
    </SheetHost>
  )
}

export default function App() {
  return (
    <HashRouter>
      <UiProvider>
        <SessionProvider fallback={(start) => <Welcome onStart={start} />}>
          <Shell />
        </SessionProvider>
      </UiProvider>
    </HashRouter>
  )
}
