import { useEffect, useState } from 'react'
import { UserError } from '../../services/core'
import { useBusy, useUi } from '../ui'

/** Envío de formularios: evita doble clic, muestra el error de negocio como aviso y también dentro del formulario. */
export function useSubmit() {
  const ui = useUi()
  const [busy, guard] = useBusy()
  const [error, setError] = useState<string | null>(null)
  const submit = <T,>(fn: () => Promise<T>, okMsg?: string) => guard(async () => {
    setError(null)
    try { const value = await fn(); if (okMsg) ui.toast(okMsg); return { value } }
    catch (e) {
      const m = e instanceof UserError ? e.message : (e as Error).message || 'Ocurrió un error inesperado.'
      if (!(e instanceof UserError)) console.error(e)
      setError(m); ui.toast(m, true); return undefined
    }
  })
  return { busy, error, setError, submit }
}

/** Hora actual que se refresca cada minuto (para marcar citas atrasadas sin llamar a Date durante el render). */
export function useNow(ms = 60000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}
