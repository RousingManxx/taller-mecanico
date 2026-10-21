import { useEffect, useState } from 'react'
import { Icon } from './ui'

interface BIPEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const KEY = 'torque.installDismissed'
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/** Invita a instalar la app: botón nativo en Chrome/Edge/Android; instrucciones en iPhone (Safari no tiene botón). No molesta si ya está instalada o se descartó. */
export function InstallBanner() {
  const [ev, setEv] = useState<BIPEvent | null>(null)
  const [hide, setHide] = useState(() => { try { return !!localStorage.getItem(KEY) } catch { return false } })
  useEffect(() => {
    const f = (e: Event) => { e.preventDefault(); setEv(e as BIPEvent) }
    addEventListener('beforeinstallprompt', f); return () => removeEventListener('beforeinstallprompt', f)
  }, [])
  if (hide || standalone()) return null
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (!ev && !ios) return null
  const dismiss = () => { try { localStorage.setItem(KEY, '1') } catch { /* sin almacenamiento */ } setHide(true) }
  return (
    <div className="banner info row" role="region" aria-label="Instalar la app" style={{ marginBottom: 12 }}>
      <Icon n="down" size={20} />
      <div className="grow">{ev ? <><b>Instala Torque</b> para abrirla como app, a pantalla completa y sin conexión.</> : <><b>Instala Torque en tu iPhone:</b> toca Compartir y luego «Añadir a pantalla de inicio».</>}</div>
      {ev && <button className="btn small primary" onClick={async () => { await ev.prompt(); await ev.userChoice; setEv(null); dismiss() }}>Instalar</button>}
      <button className="btn small ghost" onClick={dismiss} aria-label="Ocultar aviso">Ahora no</button>
    </div>
  )
}
