import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { formatMXN, parseNum } from '../domain/money'
import { UserError } from '../services/core'

/* ───────── Iconos (trazo, 24×24) ───────── */
const P: Record<string, string> = {
  plus: 'M12 5v14M5 12h14', home: 'M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z',
  wrench: 'M14.7 6.3a4 4 0 005 5l-8.4 8.4a2.1 2.1 0 01-3-3l8.4-8.4a4 4 0 00-2-2zM15 3l3 3',
  car: 'M5 16V12l2-5h10l2 5v4M3 16h18v3H3zM7 19v1M17 19v1M7.5 12h9',
  users: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 11a2.5 2.5 0 100-5M21 19a5 5 0 00-4-4.8',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  doc: 'M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6', cash: 'M3 7h18v10H3zM12 14a2 2 0 100-4 2 2 0 000 4zM6 10v.01M18 14v.01',
  box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', truck: 'M3 6h11v10H3zM14 9h4l3 3v4h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7', pie: 'M12 3v9h9a9 9 0 11-9-9zM15 3.5A9 9 0 0120.5 9H15z',
  wallet: 'M3 7a2 2 0 012-2h13v4M3 7v11a2 2 0 002 2h15V9H5a2 2 0 01-2-2zM16 14.5v.01', receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5', send: 'M4 12l16-8-6 16-3-7z', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-3-2 .6a7 7 0 00-1.6-.9L15 6h-4l-.4 1.7a7 7 0 00-1.6.9L7 8l-2 3 2 1a7 7 0 000 1.8L5 15l2 3 2-.6a7 7 0 001.6.9L11 20h4l.4-1.7a7 7 0 001.6-.9l2 .6 2-3-2-1a7 7 0 000-1.8z',
  bell: 'M6 16V11a6 6 0 1112 0v5l2 2H4zM10 21h4', search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', edit: 'M4 20h4l11-11-4-4L4 16zM13 7l4 4', alert: 'M12 3l10 18H2zM12 10v5M12 18v.01', info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8v.01',
  down: 'M12 4v12M7 11l5 5 5-5M5 20h14', up: 'M12 16V4M7 9l5-5 5 5M5 20h14', print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z', camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5v.01', percent: 'M6 18L18 6M7.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM16.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z', more: 'M5 12v.01M12 12v.01M19 12v.01',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', history: 'M4 12a8 8 0 108-8 8 8 0 00-6 2.7L4 9M4 4v5h5M12 8v4l3 2',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 118 0v3', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', play: 'M7 4l13 8-13 8z', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6v.01M4 12v.01M4 18v.01', calc: 'M6 3h12v18H6zM9 7h6M9 12v.01M12 12v.01M15 12v.01M9 16v.01M12 16v.01M15 16v.01', swap: 'M7 7h13M17 3l4 4-4 4M17 17H4M7 13l-4 4 4 4',
  box2: 'M5 4h14v4H5zM6 8v12h12V8M10 12h4', refresh: 'M20 12a8 8 0 01-14 5.3M4 12a8 8 0 0114-5.3M18 3v4h-4M6 21v-4h4', link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7', phone: 'M6 3h4l2 5-2.5 1.5a11 11 0 005 5L16 12l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 013-2z', pin: 'M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  star: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z', back: 'M15 5l-7 7 7 7', chevron: 'M9 5l7 7-7 7', filter: 'M4 5h16l-6 8v6l-4-2v-4z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
}
export const Icon = ({ n, size = 22, className }: { n: string; size?: number; className?: string }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[n] ?? ''} /></svg>
)

/* ───────── Hojas (diálogos) ───────── */
export function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button.primary')?.focus()
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab' && ref.current) { // trampa de foco dentro del diálogo
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')].filter((x) => !x.hasAttribute('disabled') && x.offsetParent !== null)
        if (!f.length) return
        const first = f[0], last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    addEventListener('keydown', k, true)
    return () => { removeEventListener('keydown', k, true); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head"><h2>{title}</h2><button className="btn small ghost" onClick={onClose} aria-label="Cerrar">Cerrar</button></div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ───────── Formularios ───────── */
export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="f">{label}{children}{hint && !error && <span className="small muted" style={{ fontWeight: 400 }}>{hint}</span>}{error && <span className="err" role="alert">{error}</span>}</label>
  )
}

/** Entrada numérica; `value` en la unidad mostrada (pesos, horas, %); vacío = undefined. */
export function NumInput({ value, onChange, invalid, ...rest }: { value: number | undefined; onChange: (v: number | undefined) => void; invalid?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value === undefined ? '' : String(value))
  useEffect(() => {
    const cur = parseNum(text)
    if (value === undefined ? !isNaN(cur) : cur !== value) setText(value === undefined ? '' : String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  return <input {...rest} inputMode="decimal" value={text} aria-invalid={invalid || undefined} onChange={(e) => { setText(e.target.value); const n = parseNum(e.target.value); onChange(isNaN(n) ? undefined : n) }} />
}
/** Importe en pesos con valor en centavos enteros. */
export function MoneyInput({ cents, onChange, invalid, ...rest }: { cents: number | undefined; onChange: (c: number | undefined) => void; invalid?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="field-money"><span aria-hidden="true">$</span>
      <NumInput {...rest} invalid={invalid} value={cents === undefined ? undefined : cents / 100} onChange={(v) => onChange(v === undefined ? undefined : Math.round(v * 100))} />
    </div>
  )
}

export const Empty = ({ title, text, action }: { title: string; text?: string; action?: ReactNode }) => (
  <div className="empty"><h3>{title}</h3>{text && <p>{text}</p>}{action}</div>
)
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label?: string }) {
  return <div className="seg" role="group" aria-label={label}>{options.map(([v, l]) => <button key={v} aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>
}
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="chips" role="group">{options.map(([v, l]) => <button key={v} className="chip" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>)}</div>
}
export const Badge = ({ tone = '', children }: { tone?: '' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) => <span className={`badge ${tone}`}>{children}</span>

export function Stat({ label, value, hint, delta, to, onClick, tone }: { label: string; value: ReactNode; hint?: string; delta?: { text: string; dir: 'up' | 'down' | 'flat' } | null; to?: string; onClick?: () => void; tone?: 'ok' | 'bad' | 'warn' }) {
  const body = (<><div className="l">{label}</div><div className={`v num ${tone === 'bad' ? 'neg' : tone === 'ok' ? 'pos' : ''}`}>{value}</div>{delta && <div className={`delta ${delta.dir === 'flat' ? '' : delta.dir}`}>{delta.text}</div>}{hint && <div className="h">{hint}</div>}</>)
  if (to) return <a className="stat" href={`#${to}`}>{body}</a>
  if (onClick) return <button className="stat" onClick={onClick}>{body}</button>
  return <div className="stat">{body}</div>
}
export const Spinner = () => <div className="muted" role="status">Cargando…</div>

/** Variación respecto al periodo anterior, lista para <Stat delta>. */
export function deltaText(cur: number, prev: number, money = true, goodWhenUp = true): { text: string; dir: 'up' | 'down' | 'flat' } | null {
  if (prev === 0 && cur === 0) return null
  if (prev === 0) return { text: 'Sin base de comparación', dir: 'flat' }
  const abs = cur - prev, pct = (abs / Math.abs(prev)) * 100
  const sign = abs > 0 ? '▲ +' : abs < 0 ? '▼ −' : '= '
  const good = abs === 0 ? 'flat' : (abs > 0) === goodWhenUp ? 'up' : 'down'
  return { text: `${sign}${money ? formatMXN(Math.abs(abs)) : Math.abs(abs)} (${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)} %)`, dir: good }
}

/* ───────── Tabla adaptable: tabla en escritorio, tarjetas en móvil ───────── */
export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matchMedia(q).matches)
  useEffect(() => { const mq = matchMedia(q), f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f) }, [q])
  return m
}
export interface Column<T> { key: string; label: string; render: (r: T) => ReactNode; align?: 'r'; hideMobile?: boolean; primary?: boolean }
export function DataTable<T>({ rows, columns, rowKey, onRow, footer, empty, pageSize = 50 }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRow?: (r: T) => void; footer?: ReactNode; empty?: ReactNode; pageSize?: number }) {
  const wide = useMedia('(min-width: 700px)')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [rows.length])
  if (!rows.length) return <>{empty ?? <Empty title="Sin registros" />}</>
  const pages = Math.ceil(rows.length / pageSize), shown = rows.slice(page * pageSize, (page + 1) * pageSize)
  const pager = pages > 1 && <div className="row between small"><span className="muted">{page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} de {rows.length}</span><span className="row"><button className="btn small" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button className="btn small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Siguiente</button></span></div>
  if (wide) return (
    <div className="stack">
      <div className="tablewrap"><table className="table"><thead><tr>{columns.map((c) => <th key={c.key} className={c.align}>{c.label}</th>)}</tr></thead>
        <tbody>{shown.map((r) => <tr key={rowKey(r)} className={onRow ? 'click' : ''} onClick={() => onRow?.(r)} tabIndex={onRow ? 0 : undefined} onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r) } }}>{columns.map((c) => <td key={c.key} className={c.align}>{c.render(r)}</td>)}</tr>)}</tbody>
        {footer && <tfoot>{footer}</tfoot>}</table></div>{pager}</div>
  )
  const prim = columns.find((c) => c.primary) ?? columns[0]
  return (
    <div className="stack"><div className="cards">{shown.map((r) => (
      <button key={rowKey(r)} className="rcard" onClick={() => onRow?.(r)} style={{ cursor: onRow ? 'pointer' : 'default' }}>
        <div className="row between"><b>{prim.render(r)}</b></div>
        {columns.filter((c) => c !== prim && !c.hideMobile).map((c) => <div key={c.key} className="kv"><span>{c.label}</span><span className="num">{c.render(r)}</span></div>)}
      </button>))}</div>{pager}</div>
  )
}

/* ───────── Avisos y confirmaciones ───────── */
interface Ui {
  toast: (m: string, bad?: boolean) => void
  confirm: (m: string, okLabel?: string, danger?: boolean) => Promise<boolean>
  /** Pide un motivo obligatorio (cancelaciones, ajustes, devoluciones). Devuelve null si se cancela. */
  askReason: (title: string, label?: string, okLabel?: string) => Promise<string | null>
  /** Ejecuta una acción de servicio mostrando el error de negocio como aviso. Devuelve el resultado o undefined si falló. */
  run: <T>(fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>
}
const Ctx = createContext<Ui>(null as never)
export const useUi = () => useContext(Ctx)

export function UiProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ m: string; bad?: boolean } | null>(null)
  const [c, setC] = useState<{ m: string; ok: string; danger: boolean; res: (v: boolean) => void } | null>(null)
  const [r, setR] = useState<{ title: string; label: string; ok: string; res: (v: string | null) => void } | null>(null)
  const [txt, setTxt] = useState('')
  const id = useId()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const toast = (m: string, bad?: boolean) => { setT({ m, bad }); clearTimeout(timer.current); timer.current = setTimeout(() => setT(null), bad ? 6000 : 2800) }
  const ui: Ui = {
    toast,
    confirm: (m, ok = 'Confirmar', danger = false) => new Promise((res) => setC({ m, ok, danger, res })),
    askReason: (title, label = 'Motivo', ok = 'Confirmar') => new Promise((res) => { setTxt(''); setR({ title, label, ok, res }) }),
    run: async (fn, okMsg) => {
      try { const v = await fn(); if (okMsg) toast(okMsg); return v }
      catch (e) {
        const msg = e instanceof UserError ? e.message : (e as Error).message || 'Ocurrió un error inesperado.'
        if (!(e instanceof UserError)) console.error(e)
        toast(msg, true); return undefined
      }
    },
  }
  const done = (v: boolean) => { c?.res(v); setC(null) }
  const doneR = (v: string | null) => { r?.res(v); setR(null) }
  return (
    <Ctx.Provider value={ui}>
      {children}
      {t && <div className={`toast glass ${t.bad ? 'bad' : ''}`} role={t.bad ? 'alert' : 'status'} aria-live="polite">{t.m}</div>}
      {c && <Sheet title="¿Seguro?" onClose={() => done(false)} footer={<><button className="btn" onClick={() => done(false)}>Cancelar</button><button className={`btn ${c.danger ? 'danger' : 'primary'}`} onClick={() => done(true)} aria-describedby={id}>{c.ok}</button></>}><p id={id}>{c.m}</p></Sheet>}
      {r && <Sheet title={r.title} onClose={() => doneR(null)} footer={<><button className="btn" onClick={() => doneR(null)}>Cancelar</button><button className="btn primary" disabled={!txt.trim()} onClick={() => doneR(txt.trim())}>{r.ok}</button></>}><Field label={r.label}><textarea value={txt} onChange={(e) => setTxt(e.target.value)} autoFocus /></Field></Sheet>}
    </Ctx.Provider>
  )
}

/** Clave de idempotencia por intento de envío de un formulario: se renueva solo al abrirlo; evita duplicar con doble clic o reintentos. */
export function useOpKey(): string {
  const k = useRef<string>(undefined)
  if (!k.current) k.current = crypto.randomUUID()
  return k.current
}
/** Para evitar doble envío: ignora clics mientras hay una operación en curso. */
export function useBusy(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [busy, setBusy] = useState(false)
  const ref = useRef(false)
  return [busy, async (fn) => { if (ref.current) return undefined; ref.current = true; setBusy(true); try { return await fn() } finally { ref.current = false; setBusy(false) } }]
}
