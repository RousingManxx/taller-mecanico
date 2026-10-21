import { useState } from 'react'
import { HELP } from '../ui/helpContent'
import type { Data } from '../ui/data'
import { Icon } from '../ui/ui'

export function Ayuda({ data }: { data: Data }) {
  const [open, setOpen] = useState<string>(HELP[0].id)
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const sections = HELP.filter((s) => !t || JSON.stringify(s).toLowerCase().includes(t))
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Guía de uso</h1><div className="sub">{data.settings.businessName} · cómo usar Torque en el día a día</div></div></div>
      <div className="search"><Icon n="search" size={18} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la guía (cobrar, caja, PIN, PDF…)" aria-label="Buscar en la guía" /></div>
      {!sections.length && <div className="empty"><h3>Sin resultados</h3><p>Prueba con otra palabra.</p></div>}
      <div className="stack">
        {sections.map((s) => {
          const on = !!t || open === s.id
          return (
            <section key={s.id} className="card stack-sm">
              <button className="row between" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} aria-expanded={on} onClick={() => setOpen(on && !t ? '' : s.id)}>
                <h2>{s.title}</h2><Icon n="chevron" size={18} className={on ? 'rot' : ''} />
              </button>
              {on && s.blocks.map((b, i) => (
                <div key={i} className="stack-sm">
                  {b.h && <h3>{b.h}</h3>}{b.p && <p style={{ margin: 0 }}>{b.p}</p>}
                  {b.list && <ul style={{ margin: 0, paddingLeft: 20 }}>{b.list.map((x) => <li key={x} style={{ marginBottom: 4 }}>{x}</li>)}</ul>}
                </div>
              ))}
            </section>
          )
        })}
      </div>
    </div>
  )
}
