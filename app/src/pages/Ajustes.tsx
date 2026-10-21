import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { registry } from '../db/db'
import { createDemoOrganization } from '../db/demo'
import { exportCsvs } from '../domain/csv'
import { OVERHEAD_LABEL } from '../domain/finance'
import { ROLE_LABEL } from '../domain/permissions'
import type { AuditLog, ExpenseCategory, OverheadMethod, PaymentMethod, TaxRate } from '../domain/types'
import { deleteDemoOrganizations, deleteOrganization } from '../services/auth'
import { createBackup, parseBackup, restoreBackup, FORMAT, type ValidationReport } from '../services/backup'
import { saveSettings, type SettingsPatch } from '../services/catalog'
import { changeOwnPin, setLogo } from '../services/config'
import { useOpen } from '../ui/create'
import { download, fmtDateTime, type Data } from '../ui/data'
import { compressImage, useAttachments } from '../ui/image'
import { useSession } from '../ui/session'
import { Badge, Empty, Field, Icon, MoneyInput, NumInput, Sheet, useBusy, useUi } from '../ui/ui'
import type { ReportData } from '../domain/reports'

declare const __APP_VERSION__: string
const toReportData = (d: Data): ReportData => ({ sales: d.sales, expenses: d.expenses, ledger: d.ledger, receipts: d.receipts, products: d.products, balances: d.balances, movements: d.movements, orders: d.orders, customers: d.customers, vehicles: d.vehicles, employees: d.employees, suppliers: d.suppliers, services: d.services, settings: d.settings })
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function Sec({ title, hint, children, id }: { title: string; hint?: string; children: ReactNode; id?: string }) {
  return <section className="stack" id={id}><div><h2>{title}</h2>{hint && <p className="small muted">{hint}</p>}</div>{children}</section>
}

/** Guarda un bloque de ajustes con botón propio, solo habilitado si hubo cambios. */
function useSave(data: Data) {
  const ctx = useSession().ctx, ui = useUi()
  const [busy, guard] = useBusy()
  const canEdit = data.can('config.editar')
  return { busy, canEdit, save: (patch: SettingsPatch, msg = 'Ajustes guardados') => guard(() => ui.run(() => saveSettings(ctx, patch), msg)) }
}

function Negocio({ data }: { data: Data }) {
  const s = data.settings, { busy, canEdit, save } = useSave(data), ctx = useSession().ctx, ui = useUi()
  const [f, setF] = useState({ businessName: s.businessName, legalName: s.legalName, taxId: s.taxId, address: s.address, phone: s.phone, email: s.email })
  const file = useRef<HTMLInputElement>(null)
  const logos = useAttachments(ctx, s.logoId ? [s.logoId] : [])
  const dirty = JSON.stringify(f) !== JSON.stringify({ businessName: s.businessName, legalName: s.legalName, taxId: s.taxId, address: s.address, phone: s.phone, email: s.email })
  const up = async (fl?: File) => { if (!fl) return; try { const c = await compressImage(fl, 400, 0.85); await ui.run(() => setLogo(ctx, c), 'Logotipo actualizado') } catch (e) { ui.toast((e as Error).message, true) } }
  return (
    <Sec title="Mi taller" hint="Estos datos aparecen en cotizaciones, órdenes y comprobantes.">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <Field label="Nombre comercial"><input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
        <div className="grid2"><Field label="Razón social"><input value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></Field><Field label="RFC"><input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value.toUpperCase() })} /></Field></div>
        <Field label="Dirección"><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <div className="grid2"><Field label="Teléfono"><input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field><Field label="Correo"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field></div>
        <div className="grid2"><Field label="Moneda"><input value="Peso mexicano (MXN)" disabled /></Field><Field label="Zona horaria e idioma"><input value={`${s.timezone} · Español (México)`} disabled /></Field></div>
        <div className="row wrap"><span className="small muted">Logotipo:</span>{logos[0] ? <img src={logos[0].dataUrl} alt="Logotipo del taller" style={{ height: 40, borderRadius: 6, background: '#fff' }} /> : <span className="small muted">sin logotipo</span>}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { up(e.target.files?.[0]); e.target.value = '' }} />
          <button className="btn small" onClick={() => file.current?.click()}>Subir logotipo</button>{logos[0] && <button className="btn small ghost" onClick={() => ui.run(() => setLogo(ctx, null), 'Logotipo quitado')}>Quitar</button>}</div>
        {canEdit && <div className="row end"><button className="btn primary" disabled={busy || !dirty || !f.businessName.trim()} onClick={() => save(f)}>Guardar</button></div>}
      </fieldset>
    </Sec>
  )
}

function Impuestos({ data }: { data: Data }) {
  const s = data.settings, { busy, canEdit, save } = useSave(data)
  const [taxes, setTaxes] = useState<TaxRate[]>(s.taxes), [def, setDef] = useState(s.defaultTaxId), [incl, setIncl] = useState(s.pricesIncludeTax)
  const dirty = JSON.stringify([taxes, def, incl]) !== JSON.stringify([s.taxes, s.defaultTaxId, s.pricesIncludeTax])
  return (
    <Sec title="Impuestos" hint="Las tasas son configurables y deben verificarse con tu contador: no todos los productos y servicios tienen el mismo tratamiento fiscal.">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        {taxes.map((t, i) => (
          <div key={t.id} className="row"><input aria-label="Nombre del impuesto" value={t.name} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /><div style={{ width: 110 }}><NumInput aria-label="Tasa %" value={t.rate} onChange={(v) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, rate: v ?? 0 } : x)))} /></div><span className="small muted">%</span>
            <label className="chk"><input type="radio" name="deftax" checked={def === t.id} onChange={() => setDef(t.id)} />Predeterminado</label>
            {taxes.length > 1 && <button className="btn small ghost danger" onClick={() => { setTaxes(taxes.filter((_, j) => j !== i)); if (def === t.id) setDef(taxes.find((x) => x.id !== t.id)!.id) }} aria-label="Quitar impuesto"><Icon n="trash" size={16} /></button>}</div>
        ))}
        <button className="btn small" onClick={() => setTaxes([...taxes, { id: 'tax-' + Math.random().toString(36).slice(2, 7), name: 'Nuevo impuesto', rate: 0 }])}>Agregar impuesto</button>
        <label className="chk"><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} />Los precios que capturo (catálogo, partidas) ya incluyen impuestos</label>
        <p className="small muted">Cambiar esto no recalcula documentos ya emitidos: cada venta conserva sus importes. Aplica a lo que captures desde ahora.</p>
        {canEdit && <div className="row end"><button className="btn primary" disabled={busy || !dirty} onClick={() => save({ taxes, defaultTaxId: def, pricesIncludeTax: incl })}>Guardar</button></div>}
      </fieldset>
    </Sec>
  )
}

function Politicas({ data }: { data: Data }) {
  const s = data.settings, { busy, canEdit, save } = useSave(data)
  const init = { targetMarginPct: s.targetMarginPct, minMarginPct: s.minMarginPct, warrantyDays: s.warrantyDays, warrantyText: s.warrantyText, quoteValidDays: s.quoteValidDays, quoteTerms: s.quoteTerms, requireAuthorization: s.requireAuthorization, lowStockDefault: s.lowStockDefault, labor: s.labor }
  const [f, setF] = useState(init)
  const dirty = JSON.stringify(f) !== JSON.stringify(init)
  return (
    <Sec title="Márgenes, mano de obra y políticas">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="grid2"><Field label="Margen objetivo (%)" hint="Sobre la venta neta"><NumInput value={f.targetMarginPct} onChange={(v) => setF({ ...f, targetMarginPct: v ?? 0 })} /></Field><Field label="Margen mínimo (%)" hint="Debajo de esto se generan alertas"><NumInput value={f.minMarginPct} onChange={(v) => setF({ ...f, minMarginPct: v ?? 0 })} /></Field></div>
        <h3>Mano de obra</h3>
        <div className="grid3"><Field label="Horas productivas al mes" hint="Horas realmente facturables por mecánico"><NumInput value={f.labor.productiveHoursPerMonth} onChange={(v) => setF({ ...f, labor: { ...f.labor, productiveHoursPerMonth: v ?? 0 } })} /></Field><Field label="Carga laboral (%)" hint="Prestaciones y cargas sobre el salario"><NumInput value={f.labor.loadPct} onChange={(v) => setF({ ...f, labor: { ...f.labor, loadPct: v ?? 0 } })} /></Field><Field label="Tarifa comercial por hora"><MoneyInput cents={f.labor.defaultRateCents} onChange={(v) => setF({ ...f, labor: { ...f.labor, defaultRateCents: v ?? 0 } })} /></Field></div>
        <p className="small muted">Costo laboral por hora = salario × (1 + carga %) ÷ horas productivas. El método de costos indirectos se elige en <Link to="/rentabilidad?t=indirectos">Rentabilidad → Indirectos</Link> (hoy: {OVERHEAD_LABEL[s.overheadMethod]}).</p>
        <h3>Políticas</h3>
        <label className="chk"><input type="checkbox" checked={f.requireAuthorization} onChange={(e) => setF({ ...f, requireAuthorization: e.target.checked })} />Exigir autorización del cliente antes de ejecutar trabajos (recomendado)</label>
        <div className="grid2"><Field label="Garantía (días)"><NumInput value={f.warrantyDays} onChange={(v) => setF({ ...f, warrantyDays: v ?? 0 })} /></Field><Field label="Vigencia de cotizaciones (días)"><NumInput value={f.quoteValidDays} onChange={(v) => setF({ ...f, quoteValidDays: v ?? 0 })} /></Field></div>
        <Field label="Texto de garantía"><textarea value={f.warrantyText} onChange={(e) => setF({ ...f, warrantyText: e.target.value })} /></Field>
        <Field label="Condiciones de cotización"><textarea value={f.quoteTerms} onChange={(e) => setF({ ...f, quoteTerms: e.target.value })} /></Field>
        <Field label="Stock mínimo por defecto (productos nuevos)"><NumInput value={f.lowStockDefault} onChange={(v) => setF({ ...f, lowStockDefault: v ?? 0 })} /></Field>
        {canEdit && <div className="row end"><button className="btn primary" disabled={busy || !dirty} onClick={() => save(f)}>Guardar</button></div>}
      </fieldset>
    </Sec>
  )
}

function Catalogos({ data }: { data: Data }) {
  const s = data.settings, { busy, canEdit, save } = useSave(data)
  const [pm, setPm] = useState<PaymentMethod[]>(s.paymentMethods), [ec, setEc] = useState<ExpenseCategory[]>(s.expenseCategories)
  const [pc, setPc] = useState(s.productCategories.join('\n')), [sc, setSc] = useState(s.serviceCategories.join('\n')), [un, setUn] = useState(s.units.join('\n')), [pf, setPf] = useState(s.prefixes)
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)
  const dirty = JSON.stringify([pm, ec, lines(pc), lines(sc), lines(un), pf]) !== JSON.stringify([s.paymentMethods, s.expenseCategories, s.productCategories, s.serviceCategories, s.units, s.prefixes])
  return (
    <Sec title="Catálogos y folios" hint="Categorías, métodos de pago, unidades y prefijos de folio.">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <h3>Métodos de pago</h3>
        {pm.map((m, i) => <div key={m.id} className="row"><input aria-label="Método de pago" value={m.name} onChange={(e) => setPm(pm.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /><select aria-label="Cuenta" style={{ width: 150 }} value={m.account} onChange={(e) => setPm(pm.map((x, j) => (j === i ? { ...x, account: e.target.value as 'caja' | 'banco' } : x)))}><option value="caja">Efectivo (caja)</option><option value="banco">Banco</option></select>{pm.length > 1 && <button className="btn small ghost danger" aria-label="Quitar método" onClick={() => setPm(pm.filter((_, j) => j !== i))}><Icon n="trash" size={16} /></button>}</div>)}
        <button className="btn small" onClick={() => setPm([...pm, { id: 'pm-' + Math.random().toString(36).slice(2, 7), name: 'Nuevo método', account: 'banco' }])}>Agregar método de pago</button>
        <p className="small muted">Los métodos de tipo «efectivo» exigen caja abierta al registrar cobros y pagos.</p>
        <h3>Categorías de gastos</h3>
        {ec.map((c, i) => <div key={c.id} className="row wrap"><input aria-label="Categoría" value={c.name} style={{ flex: '1 1 160px' }} onChange={(e) => setEc(ec.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <select aria-label="Tratamiento" style={{ width: 210 }} value={c.kind} onChange={(e) => setEc(ec.map((x, j) => (j === i ? { ...x, kind: e.target.value as ExpenseCategory['kind'] } : x)))}><option value="operativo">Gasto operativo</option><option value="mano_obra_directa">Nómina de mecánicos (ya está en el costo)</option></select>
          <label className="chk"><input type="checkbox" checked={c.allocate} disabled={c.kind !== 'operativo'} onChange={(e) => setEc(ec.map((x, j) => (j === i ? { ...x, allocate: e.target.checked } : x)))} />Asignable a órdenes</label></div>)}
        <button className="btn small" onClick={() => setEc([...ec, { id: 'cat-' + Math.random().toString(36).slice(2, 7), name: 'Nueva categoría', kind: 'operativo', allocate: false }])}>Agregar categoría</button>
        <p className="small muted">Una categoría «nómina de mecánicos» no se resta dos veces: el costo laboral imputado a las órdenes ya la representa. No se pueden borrar categorías con gastos; edítalas.</p>
        <div className="grid3"><Field label="Categorías de productos (una por línea)"><textarea rows={6} value={pc} onChange={(e) => setPc(e.target.value)} /></Field><Field label="Categorías de servicios"><textarea rows={6} value={sc} onChange={(e) => setSc(e.target.value)} /></Field><Field label="Unidades de medida"><textarea rows={6} value={un} onChange={(e) => setUn(e.target.value)} /></Field></div>
        <h3>Folios</h3>
        <div className="grid3">{(['orden', 'cotizacion', 'venta', 'compra', 'recepcion'] as const).map((k) => <Field key={k} label={`${{ orden: 'Órdenes', cotizacion: 'Cotizaciones', venta: 'Ventas', compra: 'Compras', recepcion: 'Recepciones' }[k]} · siguiente ${pf[k]}-${String(s.counters[k]).padStart(4, '0')}`}><input value={pf[k]} maxLength={6} onChange={(e) => setPf({ ...pf, [k]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></Field>)}</div>
        <p className="small muted">Los folios son consecutivos, únicos y se asignan al guardar. Estados de las órdenes: el flujo (borrador → autorizada → reparación → pruebas → lista → entregada) es fijo en esta versión.</p>
        {canEdit && <div className="row end"><button className="btn primary" disabled={busy || !dirty || Object.values(pf).some((x) => !x)} onClick={() => save({ paymentMethods: pm, expenseCategories: ec, productCategories: lines(pc), serviceCategories: lines(sc), units: lines(un), prefixes: pf })}>Guardar</button></div>}
      </fieldset>
    </Sec>
  )
}

function Usuarios({ data }: { data: Data }) {
  const ctx = useSession().ctx, open = useOpen(), ui = useUi()
  const users = useLiveQuery(() => ctx.db.users.toArray(), [ctx.db]) ?? []
  const [pin, setPin] = useState({ cur: '', n1: '', n2: '' }), [busy, guard] = useBusy()
  const admin = data.can('usuarios.admin')
  return (
    <Sec title="Usuarios, roles y seguridad" hint="Cada persona entra con su PIN. Los permisos se verifican en la capa de servicios de la aplicación.">
      {admin && <>
        <div className="stack-sm">{users.map((u) => <button key={u.id} className="item" onClick={() => open({ k: 'user', v: { ...u, pinHash: undefined, pinSalt: undefined } as never })}><Icon n="user" /><div className="grow"><div className="ttl">{u.name} {!u.active && <Badge>Inactivo</Badge>}</div><div className="sub">{ROLE_LABEL[u.role]}{u.employeeId ? ` · ${data.empMap.get(u.employeeId)?.name ?? ''}` : ''}{(u.grant?.length || u.revoke?.length) ? ' · permisos personalizados' : ''}</div></div><Icon n="chevron" size={16} /></button>)}</div>
        <button className="btn" onClick={() => open({ k: 'user' })}><Icon n="plus" size={18} />Agregar usuario</button>
      </>}
      <div className="card stack-sm"><b>Cambiar mi PIN</b>
        <div className="grid3"><Field label="PIN actual"><input type="password" inputMode="numeric" value={pin.cur} onChange={(e) => setPin({ ...pin, cur: e.target.value.replace(/\D/g, '') })} autoComplete="current-password" /></Field><Field label="Nuevo PIN"><input type="password" inputMode="numeric" value={pin.n1} onChange={(e) => setPin({ ...pin, n1: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" /></Field><Field label="Repite el nuevo PIN"><input type="password" inputMode="numeric" value={pin.n2} onChange={(e) => setPin({ ...pin, n2: e.target.value.replace(/\D/g, '') })} autoComplete="new-password" /></Field></div>
        <div className="row end"><button className="btn" disabled={busy || pin.n1.length < 4 || pin.cur.length < 4} onClick={() => guard(async () => { if (pin.n1 !== pin.n2) { ui.toast('Los PIN nuevos no coinciden.', true); return } await ui.run(() => changeOwnPin(ctx, pin.cur, pin.n1), 'PIN actualizado'); setPin({ cur: '', n1: '', n2: '' }) })}>Cambiar PIN</button></div></div>
      <p className="small muted">Las sesiones caducan a las 12 horas. Seguridad real: este taller vive en el almacenamiento de este dispositivo; los roles evitan errores y accesos casuales desde la aplicación, pero quien controle el dispositivo y sepa usar sus herramientas de desarrollo podría leer la base local. Para aislamiento fuerte entre personas se necesita un servidor (ver documentación).</p>
    </Sec>
  )
}

function Auditoria({ data }: { data: Data }) {
  const ctx = useSession().ctx
  const [q, setQ] = useState('')
  const [on, setOn] = useState(false)
  const rows = useLiveQuery(async (): Promise<AuditLog[]> => (on ? ctx.db.audit.orderBy('at').reverse().limit(300).toArray() : []), [ctx.db, on]) ?? []
  if (!data.can('auditoria.ver')) return null
  const f = rows.filter((r) => !q || `${r.action} ${r.entity} ${r.userName} ${r.reason ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Sec title="Auditoría" hint="Bitácora de acciones críticas (solo anexar: no se puede editar ni borrar). Nunca guarda PIN ni secretos.">
      {!on ? <button className="btn" onClick={() => setOn(true)}>Ver últimos eventos</button> : <>
        <div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por acción, usuario, entidad…" /></div>
        <div className="tablewrap"><table className="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody>{f.slice(0, 100).map((r) => <tr key={r.id}><td className="nowrap">{fmtDateTime(r.at)}</td><td>{r.userName}</td><td><span className="kbd">{r.action}</span></td><td>{r.entity}</td><td className="small muted">{r.reason ?? (r.after ? JSON.stringify(r.after).slice(0, 90) : '')}</td></tr>)}</tbody></table></div>
        {!f.length && <Empty title="Sin eventos" />}</>}
    </Sec>
  )
}

function Respaldo({ data }: { data: Data }) {
  const { ctx, logout } = useSession(), ui = useUi()
  const file = useRef<HTMLInputElement>(null)
  const [rep, setRep] = useState<{ r: ValidationReport; name: string } | null>(null)
  const [mode, setMode] = useState<'combinar' | 'reemplazar'>('combinar')
  const [sep, setSep] = useState<',' | ';'>(',')
  const [busy, guard] = useBusy()
  const stamp = data.today
  const exp = data.can('respaldo.exportar'), res = data.can('respaldo.restaurar')
  const down = async () => { const b = await ui.run(() => createBackup(ctx)); if (b) { download(`torque-${slug(data.settings.businessName)}-${stamp}.json`, JSON.stringify(b), 'application/json'); ui.toast('Copia de seguridad descargada') } }
  const csv = (name?: string) => {
    const files = exportCsvs(toReportData(data), { costs: data.can('costos.ver'), salaries: data.can('personal.salarios') }, sep)
    const names = name ? [name] : Object.keys(files)
    for (const n of names) download(n, files[n], 'text/csv;charset=utf-8')
    ui.toast(`${names.length} archivo(s) CSV exportado(s)`)
  }
  const pick = async (f?: File) => { if (f) setRep({ r: parseBackup(await f.text(), ctx.orgId), name: f.name }) }
  const doRestore = () => guard(async () => {
    if (!rep?.r.ok || !rep.r.data) return
    if (mode === 'reemplazar' && !(await ui.confirm('Se reemplazarán TODOS los datos de este taller por los de la copia. No se puede deshacer; te recomendamos descargar una copia antes. Después tendrás que iniciar sesión de nuevo.', 'Reemplazar todo', true))) return
    const r = await ui.run(() => restoreBackup(ctx, rep.r.data!, mode))
    if (r) { ui.toast(`Restauración completada: ${r.added} registro(s) ${mode === 'reemplazar' ? 'restaurados' : 'agregados'}${mode === 'combinar' ? `, ${r.skipped} ya existían` : ''}.`); setRep(null); if (mode === 'reemplazar') logout() }
  })
  return (
    <Sec title="Copia de seguridad y exportación" hint="Tus datos viven en este dispositivo. Descarga copias con frecuencia, sobre todo antes de cambiar de teléfono o computadora.">
      <p className="small muted">Última copia: <b>{data.settings.lastBackupAt ? fmtDateTime(data.settings.lastBackupAt) : 'nunca'}</b> · formato <span className="kbd">{FORMAT}</span>. El archivo incluye usuarios con el hash de su PIN: guárdalo en un lugar seguro.</p>
      {!data.settings.lastBackupAt && <div className="banner">Aún no has hecho ninguna copia de seguridad.</div>}
      <div className="row wrap">
        {exp && <button className="btn primary" onClick={down}><Icon n="down" size={18} />Descargar copia (JSON)</button>}
        {res && <><input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} /><button className="btn" onClick={() => file.current?.click()}><Icon n="up" size={18} />Restaurar desde archivo…</button></>}
      </div>
      {exp && <div className="card stack-sm"><b>Exportar a CSV (Excel)</b>
        <Field label="Separador"><select value={sep} onChange={(e) => setSep(e.target.value as ',' | ';')}><option value=",">Coma (Excel en México / inglés)</option><option value=";">Punto y coma (Excel con configuración regional europea)</option></select></Field>
        <div className="grid">{['clientes.csv', 'vehiculos.csv', 'ordenes.csv', 'ventas.csv', 'ventas_partidas.csv', 'movimientos_dinero.csv', 'gastos.csv', 'productos.csv', 'proveedores.csv', 'compras_recepciones.csv', 'empleados.csv'].map((n) => <button key={n} className="btn small" onClick={() => csv(n)}>{n.replace('.csv', '').replace('_', ' ')}</button>)}</div>
        <button className="btn" onClick={() => csv()}>Exportar todo</button>
        <p className="small muted">UTF-8 con BOM (acentos correctos en Excel). {data.can('costos.ver') ? '' : 'Sin permiso de costos: se omiten costos y márgenes. '}{data.can('personal.salarios') ? '' : 'Sin permiso de salarios: se omite el costo laboral. '}Para reportes con periodo y filtros usa <Link to="/reportes">Reportes</Link>.</p></div>}
      {rep && (
        <Sheet title="Revisar copia de seguridad" onClose={() => setRep(null)} footer={<><button className="btn" onClick={() => setRep(null)}>Cancelar</button><button className="btn primary" disabled={!rep.r.ok || busy} onClick={doRestore}>{mode === 'reemplazar' ? 'Reemplazar datos' : 'Combinar datos'}</button></>}>
          <div className="stack">
            <div className="small muted">{rep.name}</div>
            {rep.r.errors.length > 0 && <div className="banner bad" role="alert"><b>No se puede importar:</b><ul>{rep.r.errors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {rep.r.warnings.length > 0 && <div className="banner"><ul style={{ margin: 0 }}>{rep.r.warnings.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {rep.r.ok && <>
              <div className="card stack-sm small"><b>Contenido ({fmtDateTime(rep.r.data!.createdAt)} · v{rep.r.data!.schemaVersion})</b>{Object.entries(rep.r.counts).filter(([, n]) => n).map(([k, n]) => <div key={k} className="row between"><span>{k}</span><span className="num">{n}</span></div>)}</div>
              <Field label="Modo de restauración"><select value={mode} onChange={(e) => setMode(e.target.value as 'combinar' | 'reemplazar')}><option value="combinar">Combinar: agrega lo que falte y conserva lo actual</option><option value="reemplazar">Reemplazar: sustituye todos los datos del taller</option></select></Field>
              {mode === 'reemplazar' && <div className="banner bad">Reemplazar borra los datos actuales. Se pedirá confirmación.</div>}
              <p className="small muted">La operación es atómica: si algo falla, tus datos quedan como estaban. Una copia de otro taller se rechaza.</p></>}
          </div>
        </Sheet>)}
    </Sec>
  )
}

function Demo({ data }: { data: Data }) {
  const { ctx, logout } = useSession(), ui = useUi()
  const org = useLiveQuery(() => registry.orgs.get(ctx.orgId), [ctx.orgId])
  const demos = useLiveQuery(() => registry.orgs.filter((o) => o.demo).toArray(), []) ?? []
  const [busy, guard] = useBusy()
  const [prog, setProg] = useState<string | null>(null)
  const [del, setDel] = useState('')
  const reset = () => guard(async () => {
    if (!(await ui.confirm('Se eliminarán SOLO los talleres de demostración (datos ficticios). Tus talleres reales no se tocan.', 'Eliminar demostración', true))) return
    const n = await ui.run(() => deleteDemoOrganizations())
    if (n !== undefined) { ui.toast(`Demostración eliminada (${n})`); if (org?.demo) logout() }
  })
  const create = () => guard(async () => { setProg('Generando…'); const c = await ui.run(() => createDemoOrganization(40, (d, t, l) => setProg(`${l} (${Math.round(t ? (d / t) * 100 : 0)} %)`))); setProg(null); if (c) ui.toast('Taller de demostración creado: cierra sesión para entrar a él.') })
  return (
    <Sec title="Datos de demostración" hint="Un taller ficticio separado, con su propia base de datos: nunca se mezcla con tus datos reales.">
      {org?.demo && <div className="banner info">Estás dentro del taller de demostración. Todo lo que ves es ficticio. PIN de todos los usuarios: <b>1234</b>.</div>}
      <div className="row wrap">
        {!demos.length && !org?.demo && <button className="btn" disabled={busy} onClick={create}>{prog ?? 'Crear taller de demostración'}</button>}
        {demos.length > 0 && <button className="btn danger" disabled={busy} onClick={reset}>Reiniciar demostración (solo borra datos ficticios)</button>}
      </div>
      {!org?.demo && data.can('config.editar') && (
        <div className="card stack-sm"><b className="neg">Zona delicada: eliminar este taller</b>
          <p className="small muted">Borra definitivamente todos los datos de «{data.settings.businessName}» de este dispositivo. Descarga una copia antes. Escribe el nombre exacto del taller para confirmar.</p>
          <div className="row"><input value={del} onChange={(e) => setDel(e.target.value)} placeholder={data.settings.businessName} aria-label="Nombre del taller para confirmar" /><button className="btn danger" disabled={busy || del.trim() !== data.settings.businessName} onClick={() => guard(async () => { const r = await ui.run(() => deleteOrganization(ctx.orgId, del)); if (r !== undefined) logout() })}>Eliminar taller</button></div></div>)}
    </Sec>
  )
}

function Version() {
  const ui = useUi()
  const check = async () => {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg) { ui.toast('La actualización automática solo funciona en la app instalada o publicada con HTTPS.'); return }
    await reg.update(); ui.toast('Buscando versión nueva… si hay una, se aplicará sola.')
  }
  return (
    <div className="stack-sm center">
      <p className="small muted">Versión de la app: <span className="kbd">{__APP_VERSION__}</span></p>
      <div><button className="btn small" onClick={check}><Icon n="refresh" size={16} />Buscar actualización</button></div>
      <p className="small muted">La app busca versiones nuevas sola cada vez que vuelve a primer plano y funciona sin conexión; todos los datos se guardan en este dispositivo.</p>
    </div>
  )
}

export function Ajustes({ data }: { data: Data }) {
  const { user, logout } = useSession()
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Ajustes</h1><div className="sub">{data.settings.businessName} · {user.name} · {ROLE_LABEL[user.role]}</div></div><div className="row"><Link className="btn" to="/guia">Guía de inicio</Link><button className="btn" onClick={logout}><Icon n="logout" size={18} />Cerrar sesión</button></div></div>
      {!data.can('config.editar') && <div className="banner info">Tu rol no puede modificar la configuración del taller; puedes ver los valores vigentes.</div>}
      <Negocio data={data} /><Impuestos data={data} /><Politicas data={data} /><Catalogos data={data} /><Usuarios data={data} /><Auditoria data={data} /><Respaldo data={data} /><Demo data={data} />
      <Version />
    </div>
  )
}
export type { OverheadMethod }
