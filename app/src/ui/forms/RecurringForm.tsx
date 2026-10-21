import { useState } from 'react'
import { formatMXN, round } from '../../domain/money'
import type { RecurringExpense } from '../../domain/types'
import { saveRecurring } from '../../services/expenses'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Field, MoneyInput, NumInput, Seg, Sheet, useBusy, useUi } from '../ui'

export function RecurringForm({ data, recurring, onClose }: { data: Data; recurring?: RecurringExpense; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const s = data.settings
  const [concept, setConcept] = useState(recurring?.concept ?? '')
  const [categoryId, setCategoryId] = useState(recurring?.categoryId ?? s.expenseCategories[0]?.id ?? '')
  const [amount, setAmount] = useState<number | undefined>(recurring?.amountCents)
  const [tax, setTax] = useState<number | undefined>(recurring?.taxCents ?? 0)
  const [frequency, setFrequency] = useState<'mensual' | 'semanal'>(recurring?.frequency ?? 'mensual')
  const [day, setDay] = useState<number | undefined>(recurring?.dayOfMonth ?? 1)
  const [supplierId, setSupplierId] = useState(recurring?.supplierId ?? '')
  const [costCenter, setCostCenter] = useState(recurring?.costCenter ?? '')
  const [active, setActive] = useState(recurring?.active ?? true)
  const [startDate, setStartDate] = useState(recurring?.startDate ?? data.today)
  const taxRate = s.taxes.find((t) => t.id === s.defaultTaxId)?.rate ?? 16
  const errAmount = amount === undefined || amount <= 0 ? 'Captura el importe sin IVA (mayor que cero).' : undefined
  const errDay = frequency === 'mensual' && (day === undefined || !Number.isInteger(day) || day < 1 || day > 31) ? 'El día del mes debe estar entre 1 y 31.' : undefined
  const valid = concept.trim().length > 0 && !errAmount && !errDay
  const save = () => guard(async () => {
    if (!valid || amount === undefined) { ui.toast(!concept.trim() ? 'El concepto es obligatorio.' : errAmount ?? errDay ?? 'Revisa los datos.', true); return }
    const dom = day !== undefined && Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1
    const r = await ui.run(() => saveRecurring(ctx, { id: recurring?.id, concept, categoryId, amountCents: amount, taxCents: tax ?? 0, frequency, dayOfMonth: dom, supplierId: supplierId || undefined, costCenter, active, startDate }), recurring ? 'Plantilla actualizada' : 'Plantilla creada')
    if (r) onClose()
  })
  return (
    <Sheet title={recurring ? 'Editar gasto recurrente' : 'Nuevo gasto recurrente'} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !valid} onClick={save}>Guardar plantilla</button></>}>
      <div className="stack">
        <div className="banner info">Una plantilla no es un gasto: sirve para generar los gastos reales cada periodo con «Generar vencidos». Hasta entonces solo es una estimación.</div>
        <Field label="Concepto"><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Renta del local" /></Field>
        <div className="grid2">
          <Field label="Categoría"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{s.expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Proveedor (opcional)"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Sin proveedor</option>{data.suppliers.filter((x) => x.active || x.id === supplierId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        </div>
        <div className="grid2">
          <Field label="Importe sin IVA" error={errAmount}><MoneyInput cents={amount} onChange={setAmount} invalid={!!errAmount} aria-label="Importe sin IVA" /></Field>
          <Field label="IVA"><MoneyInput cents={tax} onChange={setTax} aria-label="IVA" /></Field>
        </div>
        <div className="mny-pickrow">
          <button type="button" className="btn small" disabled={!amount} onClick={() => setTax(round((amount ?? 0) * taxRate / 100))}>Calcular IVA {taxRate} %</button>
          <button type="button" className="btn small ghost" onClick={() => setTax(0)}>Sin IVA</button>
          <span className="small muted">Total por periodo: <b className="num">{formatMXN((amount ?? 0) + (tax ?? 0))}</b></span>
        </div>
        <Field label="Frecuencia"><Seg value={frequency} options={[['mensual', 'Mensual'], ['semanal', 'Semanal']]} onChange={setFrequency} label="Frecuencia" /></Field>
        <div className="grid2">
          {frequency === 'mensual' && <Field label="Día del mes" error={errDay} hint="En meses cortos se usa el último día."><NumInput value={day} onChange={setDay} invalid={!!errDay} aria-label="Día del mes" /></Field>}
          <Field label="Fecha de inicio" hint={frequency === 'semanal' ? 'Se repite cada 7 días a partir de esta fecha.' : 'No se generan gastos anteriores a esta fecha.'}><input type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} /></Field>
        </div>
        <Field label="Centro de costo (opcional)"><input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} /></Field>
        <label className="chk"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Activa (genera gastos y entra en la previsión)</label>
      </div>
    </Sheet>
  )
}
