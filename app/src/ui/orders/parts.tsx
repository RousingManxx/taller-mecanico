import { useId, useMemo, useState, type ReactNode } from 'react'
import { STATUS_LABEL } from '../../domain/orders'
import type { OrderStatus, WorkOrder } from '../../domain/types'
import { Badge, Field, useMedia } from '../ui'
import { norm, PRIORITY_LABEL, PRIORITY_TONE, STATUS_TONE } from './helpers'
import '../css/orders.css'

export const StatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
export const PriorityBadge = ({ priority }: { priority: WorkOrder['priority'] }) => <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>

/** Sección de formulario: en pantallas pequeñas las opcionales arrancan plegadas. */
export function Section({ title, children, optional }: { title: string; children: ReactNode; optional?: boolean }) {
  const wide = useMedia('(min-width: 700px)')
  return (
    <details className="ord-sec" open={!optional || wide ? true : undefined}>
      <summary><h3>{title}</h3></summary>
      <div className="stack">{children}</div>
    </details>
  )
}

/** Selector buscable: muestra coincidencias como botones y, al elegir, una ficha con «Cambiar». */
export function Picker<T extends { id: string }>({ label, items, value, onChange, title, sub, right, haystack, error, placeholder, limit = 8, minChars = 0, emptyText, extra }: {
  label: string; items: T[]; value: T | undefined; onChange: (v: T | undefined) => void
  title: (t: T) => ReactNode; sub?: (t: T) => ReactNode; right?: (t: T) => ReactNode; haystack: (t: T) => string
  error?: string; placeholder?: string; limit?: number; minChars?: number; emptyText?: string; extra?: ReactNode
}) {
  const [q, setQ] = useState('')
  const id = useId()
  const t = norm(q.trim())
  const found = useMemo(() => (t.length < minChars ? [] : items.filter((i) => !t || norm(haystack(i)).includes(t))), [items, t, minChars, haystack])
  if (value) {
    return (
      <div className="stack-sm">
        <span className="small muted" style={{ fontWeight: 600 }}>{label}</span>
        <div className="ord-picked">
          <div className="grow"><div className="t">{title(value)}</div>{sub && <div className="s">{sub(value)}</div>}</div>
          <button type="button" className="btn small" onClick={() => { onChange(undefined); setQ('') }} aria-label={`Cambiar ${label.toLowerCase()}`}>Cambiar</button>
        </div>
        {error && <span className="err" role="alert">{error}</span>}
      </div>
    )
  }
  return (
    <div className="stack-sm">
      <Field label={label} error={error}><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder ?? 'Escribe para buscar…'} aria-describedby={id} aria-invalid={error ? true : undefined} autoComplete="off" /></Field>
      <div id={id} className="stack-sm">
        {t.length < minChars && <span className="small muted">Escribe al menos {minChars} {minChars === 1 ? 'letra' : 'letras'} para buscar.</span>}
        {t.length >= minChars && !found.length && <span className="small muted">{emptyText ?? 'Sin coincidencias.'}</span>}
        {found.length > 0 && <div className="ord-opts" role="group" aria-label={`Resultados de ${label.toLowerCase()}`}>
          {found.slice(0, limit).map((i) => (
            <button key={i.id} type="button" className="ord-opt" onClick={() => onChange(i)}>
              <span><span className="t">{title(i)}</span>{sub && <span className="s" style={{ display: 'block' }}>{sub(i)}</span>}</span>
              {right && <span className="r">{right(i)}</span>}
            </button>
          ))}
        </div>}
        {found.length > limit && <span className="small muted">Mostrando {limit} de {found.length}: sigue escribiendo para afinar.</span>}
        {extra}
      </div>
    </div>
  )
}

/** Fila etiqueta/valor para resúmenes. */
export const Row = ({ l, children }: { l: string; children: ReactNode }) => <div><div className="l">{l}</div><div className="v">{children}</div></div>
