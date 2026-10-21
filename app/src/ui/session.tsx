import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { resume } from '../services/auth'
import type { Ctx } from '../services/core'

const KEY = 'torque.session'
const TTL = 12 * 3600 * 1000 // las sesiones caducan a las 12 h

interface Session { ctx: Ctx; user: Ctx['user']; start: (c: Ctx) => void; logout: () => void }
const S = createContext<Session>(null as never)
export const useSession = () => useContext(S)
export const useCtx = (): Ctx => useContext(S).ctx

function save(c: Ctx | null) {
  try { if (c) localStorage.setItem(KEY, JSON.stringify({ orgId: c.orgId, userId: c.user.id, at: Date.now() })); else localStorage.removeItem(KEY) } catch { /* sin almacenamiento */ }
}

/** Guarda solo ids (nunca el PIN). Se revalida que el usuario siga activo al reabrir. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: (start: (c: Ctx) => void) => ReactNode }) {
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem(KEY)
        if (raw) {
          const s = JSON.parse(raw) as { orgId: string; userId: string; at: number }
          if (Date.now() - s.at < TTL) { const c = await resume(s.orgId, s.userId); if (c) setCtx(c) }
        }
      } catch { /* sesión inválida */ }
      setBooting(false)
    })()
  }, [])
  const start = useCallback((c: Ctx) => { save(c); setCtx(c) }, [])
  const logout = useCallback(() => { save(null); setCtx(null) }, [])
  const value = useMemo(() => (ctx ? { ctx, user: ctx.user, start, logout } : null), [ctx, start, logout])
  if (booting) return <div className="main muted" role="status">Cargando…</div>
  if (!value) return <>{fallback(start)}</>
  return <S.Provider value={value}>{children}</S.Provider>
}
