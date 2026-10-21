import { useState } from 'react'
import { expensePaid } from '../../domain/finance'
import { formatMXN, round } from '../../domain/money'
import type { Expense } from '../../domain/types'
import { saveExpense } from '../../services/expenses'
import type { Data } from '../data'
import { CashGate, MethodSelect } from '../money/common'
import { isCashMethod } from '../money/helpers'
import { useCtx } from '../session'
import { Field, MoneyInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

export function ExpenseForm({ data, expense, onClose }: { data: Data; expense?: Expense; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const s = data.settings
  const [concept, setConcept] = useState(expense?.concept ?? '')
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? s.expenseCategories[0]?.id ?? '')
  const [date, setDate] = useState(expense?.date ?? data.today)
  const [amount, setAmount] = useState<number | undefined>(expense?.amountCents)
  const [tax, setTax] = useState<number | undefined>(expense?.taxCents ?? 0)
  const [supplierId, setSupplierId] = useState(expense?.supplierId ?? '')
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? '')
  const [costCenter, setCostCenter] = useState(expense?.costCenter ?? '')
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [payNow, setPayNow] = useState(false)
  const [methodId, setMethodId] = useState(s.paymentMethods[0]?.id ?? '')
  const [reference, setReference] = useState('')
  const cat = s.expenseCategories.find((c) => c.id === categoryId)
  const taxRate = s.taxes.find((t) => t.id === s.defaultTaxId)?.rate ?? 16
  const paid = expense ? expensePaid(expense, data.ledger) : 0
  const total = (amount ?? 0) + (tax ?? 0)
  const errAmount = amount === undefined || amount <= 0 ? 'Captura el importe sin IVA (mayor que cero).' : undefined
  const errDue = dueDate && dueDate < date ? 'El vencimiento no puede ser anterior a la fecha del gasto.' : undefined
  const errPaid = expense && paid > total ? `Ya se pagaron ${formatMXN(paid)}: el nuevo total no puede ser menor.` : undefined
  const valid = concept.trim().length > 0 && !errAmount && !errDue && !errPaid && !!categoryId
  const save = () => guard(async () => {
    if (!valid || amount === undefined) { ui.toast(!concept.trim() ? 'El concepto es obligatorio.' : errAmount ?? errDue ?? errPaid ?? 'Revisa los datos del gasto.', true); return }
    const r = await ui.run(() => saveExpense(ctx, { id: expense?.id, concept, categoryId, date, amountCents: amount, taxCents: tax ?? 0, supplierId: supplierId || undefined, dueDate: dueDate || undefined, costCenter, notes }, payNow && !expense ? { methodId, reference } : undefined, opKey), expense ? 'Gasto actualizado' : payNow ? 'Gasto registrado y pagado' : 'Gasto registrado')
    if (r) onClose()
  })
  return (
    <Sheet title={expense ? 'Editar gasto' : 'Registrar gasto'} onClose={onClose} wide footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !valid} onClick={save}>{expense ? 'Guardar cambios' : payNow ? 'Registrar y pagar' : 'Registrar gasto'}</button></>}>
      <div className="stack-lg">
        <div className="stack">
          <h3>Gasto</h3>
          <Field label="Concepto"><input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Ej. Renta del local, recibo de luz…" /></Field>
          <div className="grid2">
            <Field label="Categoría"><select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{s.expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Fecha del gasto"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
          </div>
          {cat?.kind === 'mano_obra_directa'
            ? <div className="banner info"><b>{cat.name}</b>: se registra para controlar el efectivo y las obligaciones, pero <b>no se resta dos veces</b> en la utilidad, porque ya está incluida como costo laboral de las órdenes. Solo la parte que no se absorbe con horas facturadas (capacidad ociosa) se resta como gasto.</div>
            : <div className="small muted">«{cat?.name}» es un gasto operativo: se resta de la utilidad bruta para obtener el resultado operativo{cat?.allocate ? ' y participa en el fondo de costos indirectos' : ''}.</div>}
        </div>
        <div className="stack">
          <h3>Importes</h3>
          <div className="grid2">
            <Field label="Importe sin IVA" error={errAmount}><MoneyInput cents={amount} onChange={setAmount} invalid={!!errAmount} aria-label="Importe sin IVA" /></Field>
            <Field label="IVA" hint="El IVA se paga pero no es costo: solo el importe sin IVA se reconoce como gasto."><MoneyInput cents={tax} onChange={setTax} aria-label="IVA" /></Field>
          </div>
          <div className="mny-pickrow">
            <button type="button" className="btn small" disabled={!amount} onClick={() => setTax(round((amount ?? 0) * taxRate / 100))}>Calcular IVA {taxRate} %</button>
            <button type="button" className="btn small ghost" onClick={() => setTax(0)}>Sin IVA</button>
          </div>
          <div className="mny-sum">
            <div className="mny-kv"><span>Se reconoce como gasto</span><span className="num">{formatMXN(amount ?? 0)}</span></div>
            <div className="mny-kv total"><span>Total a pagar</span><span className="num">{formatMXN(total)}</span></div>
            {expense && <div className="mny-kv"><span>Pagado hasta ahora</span><span className="num">{formatMXN(paid)}</span></div>}
          </div>
          {errPaid && <div className="err" role="alert">{errPaid}</div>}
        </div>
        <div className="stack">
          <h3>Detalle</h3>
          <div className="grid2">
            <Field label="Proveedor (opcional)"><select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Sin proveedor</option>{data.suppliers.filter((x) => x.active || x.id === supplierId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Vence (opcional)" error={errDue} hint="Si no lo indicas, se considera vencido desde su fecha."><input type="date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} /></Field>
          </div>
          <Field label="Centro de costo (opcional)"><input value={costCenter} onChange={(e) => setCostCenter(e.target.value)} placeholder="Ej. Taller, Administración" /></Field>
          <Field label="Notas (opcional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        {!expense && (
          <div className="stack">
            <h3>Pago</h3>
            <label className="chk"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />Pagar ahora el total ({formatMXN(total)})</label>
            {payNow ? (
              <>
                <div className="grid2"><MethodSelect data={data} value={methodId} onChange={setMethodId} label="Pagar con" /><Field label="Referencia (opcional)"><input value={reference} onChange={(e) => setReference(e.target.value)} /></Field></div>
                <CashGate data={data} needed={isCashMethod(data, methodId)} />
              </>
            ) : <div className="small muted">Sin pagar: queda como obligación pendiente en Por pagar. Podrás pagarlo completo o en parcialidades.</div>}
          </div>
        )}
        {expense && paid > 0 && <div className="small muted">Este gasto ya tiene pagos registrados ({formatMXN(paid)}); no se modifican al editarlo.</div>}
      </div>
    </Sheet>
  )
}
