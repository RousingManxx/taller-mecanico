import { useMemo, useState } from 'react'
import { PERIOD_LABEL, periodRange, previousRange, type Period, type Range } from '../domain/dates'
import { fmtDate } from './data'
import { Seg } from './ui'

export interface PeriodState { period: Period; setPeriod: (p: Period) => void; range: Range; prev: Range; custom: Range; setCustom: (r: Range) => void; label: string }

/** Periodo seleccionado y su equivalente anterior (mes vs. mismos días del mes pasado). */
export function usePeriod(today: string, initial: Period = 'mes'): PeriodState {
  const [period, setPeriod] = useState<Period>(initial)
  const [custom, setCustom] = useState<Range>({ from: today.slice(0, 8) + '01', to: today })
  return useMemo(() => {
    const range = periodRange(period, today, custom)
    const label = period === 'custom' ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : PERIOD_LABEL[period]
    return { period, setPeriod, range, prev: previousRange(period, range), custom, setCustom, label }
  }, [period, today, custom])
}

const OPTIONS: [Period, string][] = [['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes'], ['mes_anterior', 'Mes anterior'], ['trimestre', 'Trimestre'], ['anio', 'Año'], ['custom', 'Rango']]
export function PeriodPicker({ s, compact }: { s: PeriodState; compact?: boolean }) {
  const opts = compact ? OPTIONS.filter(([k]) => k !== 'mes_anterior' && k !== 'custom') : OPTIONS
  return (
    <div className="stack-sm">
      <Seg value={s.period} onChange={s.setPeriod} options={opts} label="Periodo" />
      {s.period === 'custom' && (
        <div className="grid2">
          <label className="f">Desde<input type="date" value={s.custom.from} max={s.custom.to} onChange={(e) => e.target.value && s.setCustom({ ...s.custom, from: e.target.value })} /></label>
          <label className="f">Hasta<input type="date" value={s.custom.to} min={s.custom.from} onChange={(e) => e.target.value && s.setCustom({ ...s.custom, to: e.target.value })} /></label>
        </div>
      )}
    </div>
  )
}
