import { useState } from 'react'
import { expenseBalance, expensePaid, expenseTotal } from '../../domain/finance'
import { formatMXN } from '../../domain/money'
import { payExpense } from '../../services/expenses'
import { fmtDate, type Data } from '../data'
import { CashGate, MethodSelect } from '../money/common'
import { isCashMethod } from '../money/helpers'
import { useCtx } from '../session'
import { Field, MoneyInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

export function ExpensePaySheet({ data, expenseId, onClose }: { data: Data; expenseId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const e = data.expenses.find((x) => x.id === expenseId)
  const bal = e ? expenseBalance(e, data.ledger) : 0
  const [amount, setAmount] = useState<number | undefined>(bal || undefined)
  const [methodId, setMethodId] = useState(data.settings.paymentMethods[0]?.id ?? '')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(data.today)
  if (!e) return <Sheet title="Pagar gasto" onClose={onClose}><div className="banner">El gasto no existe.</div></Sheet>
  if (e.cancelled) return <Sheet title="Pagar gasto" onClose={onClose}><div className="banner">El gasto está cancelado.</div></Sheet>
  if (bal <= 0) return <Sheet title="Pagar gasto" onClose={onClose}><div className="banner ok">Este gasto ya está pagado por completo.</div></Sheet>
  const err = amount === undefined || amount <= 0 ? 'El importe debe ser mayor que cero.' : amount > bal ? `El pago no puede superar el saldo pendiente (${formatMXN(bal)}).` : undefined
  const save = () => guard(async () => {
    if (err || amount === undefined) { ui.toast(err ?? 'Captura el importe.', true); return }
    const r = await ui.run(() => payExpense(ctx, e.id, amount, methodId, { reference, date }, opKey), amount < bal ? 'Pago parcial registrado' : 'Gasto pagado')
    if (r) onClose()
  })
  return (
    <Sheet title="Pagar gasto" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !!err} onClick={save}>Registrar pago</button></>}>
      <div className="stack">
        <div className="card flat"><b>{e.concept}</b><div className="small muted">{fmtDate(e.date)}{e.dueDate ? ` · vence ${fmtDate(e.dueDate)}` : ''}</div></div>
        <div className="mny-sum">
          <div className="mny-kv"><span>Total del gasto</span><span className="num">{formatMXN(expenseTotal(e))}</span></div>
          <div className="mny-kv"><span>Pagado</span><span className="num">{formatMXN(expensePaid(e, data.ledger))}</span></div>
          <div className="mny-kv total"><span>Saldo pendiente</span><span className="num">{formatMXN(bal)}</span></div>
          <div className="mny-kv"><span>Saldo después de este pago</span><span className="num">{formatMXN(Math.max(0, bal - (amount ?? 0)))}</span></div>
        </div>
        <Field label="Importe a pagar" error={err} hint="Puedes pagar solo una parte; el resto seguirá pendiente."><MoneyInput cents={amount} onChange={setAmount} invalid={!!err} aria-label="Importe a pagar" /></Field>
        <MethodSelect data={data} value={methodId} onChange={setMethodId} label="Pagar con" />
        <CashGate data={data} needed={isCashMethod(data, methodId)} />
        <div className="grid2">
          <Field label="Referencia (opcional)"><input value={reference} onChange={(ev) => setReference(ev.target.value)} placeholder="Folio, SPEI…" /></Field>
          <Field label="Fecha del pago"><input type="date" value={date} max={data.today} onChange={(ev) => ev.target.value && setDate(ev.target.value)} /></Field>
        </div>
      </div>
    </Sheet>
  )
}
