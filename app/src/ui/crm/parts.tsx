import { useId, useRef, type ReactNode } from 'react'
import { Icon } from '../ui'
import '../css/crm.css'

/** Pestañas accesibles (teclado: flechas, Inicio y Fin). El contenido lo pinta quien la usa dentro de `<TabPanel>`. */
export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: [T, string][]; onChange: (v: T) => void; label: string }) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const move = (i: number) => { const n = (i + tabs.length) % tabs.length; onChange(tabs[n][0]); refs.current[n]?.focus() }
  return (
    <div className="seg crm-tabs" role="tablist" aria-label={label}>
      {tabs.map(([v, l], i) => (
        <button key={v} ref={(el) => { refs.current[i] = el }} role="tab" id={`${id}-${v}`} aria-selected={v === value} tabIndex={v === value ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1) } else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1) } else if (e.key === 'Home') { e.preventDefault(); move(0) } else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1) } }}>{l}</button>
      ))}
    </div>
  )
}
export const TabPanel = ({ children, label }: { children: ReactNode; label: string }) => <div role="tabpanel" aria-label={label} className="stack" tabIndex={0}>{children}</div>

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return <div className="search"><Icon n="search" size={18} /><input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} /></div>
}

/** Fila «etiqueta: valor» para fichas. */
export const Info = ({ label, children }: { label: string; children: ReactNode }) => <div className="crm-info"><dt>{label}</dt><dd>{children}</dd></div>
