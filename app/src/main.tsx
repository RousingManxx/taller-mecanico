import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'

// Pide al navegador que no limpie los datos automáticamente (best-effort; no hay garantía).
try { navigator.storage?.persist?.() } catch { /* sin soporte */ }

// En la PWA instalada: bloquea el zoom por pellizco (gestos de Safari iOS). En el navegador de escritorio no se toca.
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
if (standalone) for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault())

// Busca una versión nueva cada vez que la app vuelve a primer plano y la aplica sola (iOS no actualiza PWAs instaladas por su cuenta).
// Recarga solo cuando una versión NUEVA toma el control (no en la primera instalación).
const hadController = !!navigator.serviceWorker?.controller
let reloading = false
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload() } })
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
