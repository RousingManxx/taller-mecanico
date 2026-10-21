import { useMemo, useState } from 'react'
import { LEDGER_LABEL } from '../../domain/finance'
import { formatMXN } from '../../domain/money'
import type { LedgerKind } from '../../domain/types'
import { addCashMovement, closeSession, transferBetweenAccounts } from '../../services/cash'
import type { Data } from '../data'
import { CashGate, OpenCashInline } from '../money/common'
import { isCashMethod, openSessionOf, sessionExpectedLive } from '../money/helpers'
import { useCtx } from '../session'
import { Field, MoneyInput, Seg, Sheet, useBusy, useOpKey, useUi } from '../ui'

/* ───────── Abrir caja ───────── */
export function CashOpenSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const open = openSessionOf(data)
  return (
    <Sheet title="Abrir caja" onClose={onClose}>
      {open ? <div className="banner info">Ya hay una caja abierta. Ciérrala antes de abrir otra.</div> : (
        <div className="stack">
          <p className="muted small" style={{ margin: 0 }}>Cuenta el efectivo con el que inicia el turno. Los cobros y pagos en efectivo se ligan a esta sesión y al cerrar se compara lo contado contra lo esperado.</p>
          {!data.can('caja.operar') && <div className="banner">No tienes permiso para abrir la caja.</div>}
          {data.can('caja.operar') && <OpenCashInline data={data} onDone={onClose} />}
        </div>
      )}
    </Sheet>
  )
}

/* ───────── Cerrar caja ───────── */
export function CashCloseSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const sess = openSessionOf(data)
  const [counted, setCounted] = useState<number | undefined>(undefined)
  const [note, setNote] = useState('')
  const rows = useMemo(() => (sess ? data.ledger.filter((l) => l.sessionId === sess.id && l.account === 'caja') : []), [sess, data.ledger])
  if (!sess) return <Sheet title="Cerrar caja" onClose={onClose}><div className="banner info">No hay una caja abierta.</div></Sheet>
  const inC = rows.filter((l) => l.direction === 'in').reduce((a, l) => a + l.amountCents, 0)
  const outC = rows.filter((l) => l.direction === 'out').reduce((a, l) => a + l.amountCents, 0)
  const expected = sessionExpectedLive(sess, data.ledger)
  const diff = counted === undefined ? undefined : counted - expected
  const needNote = diff !== undefined && diff !== 0
  const save = () => guard(async () => {
    if (counted === undefined) { ui.toast('Captura el efectivo contado (puede ser 0).', true); return }
    if (needNote && !note.trim()) { ui.toast('Hay una diferencia: explica el motivo para poder cerrar.', true); return }
    const r = await ui.run(() => closeSession(ctx, counted, note), 'Caja cerrada')
    if (r) onClose()
  })
  return (
    <Sheet title="Cerrar caja" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || counted === undefined || (needNote && !note.trim())} onClick={save}>Cerrar caja</button></>}>
      <div className="stack">
        <div className="mny-sum">
          <div className="mny-kv"><span>Efectivo inicial</span><b className="num">{formatMXN(sess.openingCents)}</b></div>
          <div className="mny-kv"><span>Entradas en efectivo ({rows.filter((l) => l.direction === 'in').length})</span><span className="num pos">+ {formatMXN(inC)}</span></div>
          <div className="mny-kv"><span>Salidas en efectivo ({rows.filter((l) => l.direction === 'out').length})</span><span className="num neg">− {formatMXN(outC)}</span></div>
          <div className="mny-kv total"><span>Efectivo esperado</span><span className="num">{formatMXN(expected)}</span></div>
        </div>
        <Field label="Efectivo contado" hint="Cuenta billetes y monedas físicamente y captura el total."><MoneyInput cents={counted} onChange={setCounted} aria-label="Efectivo contado" /></Field>
        {diff !== undefined && (
          <div className={`banner ${diff === 0 ? 'ok' : 'bad'}`} role="status">
            {diff === 0 ? 'Sin diferencia: el efectivo cuadra.' : diff > 0 ? <>Sobrante de <b>{formatMXN(diff)}</b> respecto a lo esperado.</> : <>Faltante de <b>{formatMXN(-diff)}</b> respecto a lo esperado.</>}
          </div>
        )}
        <Field label={needNote ? 'Motivo de la diferencia (obligatorio)' : 'Notas del cierre (opcional)'} error={needNote && !note.trim() ? 'Explica el motivo para poder cerrar.' : undefined}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej. cambio entregado de más, gasto sin ticket…" />
        </Field>
        <p className="small muted" style={{ margin: 0 }}>Al cerrar se guarda el esperado, el contado y la diferencia en el historial. Los movimientos en efectivo ya no podrán registrarse hasta abrir otra caja.</p>
      </div>
    </Sheet>
  )
}

/* ───────── Movimiento manual de dinero ───────── */
type MoveKind = Extract<LedgerKind, 'aportacion_dueno' | 'retiro_dueno' | 'prestamo_recibido' | 'pago_prestamo' | 'otro_ingreso' | 'otro_egreso'> | 'transferencia'
const MOVES: { k: MoveKind; label: string; dir: 'in' | 'out' | 'x'; help: string }[] = [
  { k: 'aportacion_dueno', label: 'Aportación del propietario', dir: 'in', help: 'El propietario pone dinero en el negocio. No es una venta ni un ingreso operativo.' },
  { k: 'retiro_dueno', label: 'Retiro del propietario', dir: 'out', help: 'El propietario saca dinero. No es un gasto del taller ni reduce la utilidad.' },
  { k: 'prestamo_recibido', label: 'Préstamo recibido', dir: 'in', help: 'Dinero prestado que habrá que devolver. No es venta.' },
  { k: 'pago_prestamo', label: 'Pago de préstamo', dir: 'out', help: 'Abono a un préstamo. Aquí no se calculan intereses: regístralos como gasto (comisiones o financieros) si aplica.' },
  { k: 'otro_ingreso', label: 'Otro ingreso', dir: 'in', help: 'Entrada de dinero que no es cobro de clientes (p. ej. venta de chatarra). Descríbelo bien.' },
  { k: 'otro_egreso', label: 'Otro egreso', dir: 'out', help: 'Salida de dinero que no es gasto ni pago a proveedor. Si es un gasto, regístralo en Gastos.' },
  { k: 'transferencia', label: 'Transferencia caja ↔ banco', dir: 'x', help: 'Mueve dinero entre efectivo y banco, como un depósito o un retiro del cajero. No cambia ventas ni utilidad.' },
]
export function CashMoveSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const methods = data.settings.paymentMethods
  const [kind, setKind] = useState<MoveKind>('aportacion_dueno')
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '')
  const [from, setFrom] = useState<'caja' | 'banco'>('caja')
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [note, setNote] = useState('')
  const [reference, setReference] = useState('')
  const def = MOVES.find((m) => m.k === kind)!
  const sess = openSessionOf(data)
  const isTransfer = kind === 'transferencia'
  const needsCash = isTransfer || isCashMethod(data, methodId)
  const bancoBal = data.ledger.filter((l) => l.account === 'banco').reduce((a, l) => a + (l.direction === 'in' ? l.amountCents : -l.amountCents), 0)
  // Aviso (no bloqueo) si la salida deja la cuenta en negativo.
  const outflow = isTransfer || def.dir === 'out'
  const fromAccount = isTransfer ? from : methods.find((m) => m.id === methodId)?.account
  const available = fromAccount === 'caja' ? (sess ? sessionExpectedLive(sess, data.ledger) : 0) : bancoBal
  const overdraw = outflow && amount !== undefined && amount > available && (fromAccount === 'banco' || !!sess)
  const valid = amount !== undefined && amount > 0 && (isTransfer || note.trim().length > 0)
  const save = () => guard(async () => {
    if (!valid || amount === undefined) { ui.toast(amount === undefined || amount <= 0 ? 'El importe debe ser mayor que cero.' : 'Describe el concepto del movimiento.', true); return }
    if (isTransfer) {
      const r = await ui.run(() => transferBetweenAccounts(ctx, from, amount, note, opKey).then(() => true), 'Transferencia registrada')
      if (r) onClose()
    } else {
      const r = await ui.run(() => addCashMovement(ctx, { kind: kind as Exclude<MoveKind, 'transferencia'>, amountCents: amount, methodId, note, reference }, opKey), 'Movimiento registrado')
      if (r) onClose()
    }
  })
  return (
    <Sheet title="Movimiento de dinero" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !valid} onClick={save}>{isTransfer ? 'Transferir' : 'Registrar movimiento'}</button></>}>
      <div className="stack">
        <Field label="Tipo de movimiento">
          <select value={kind} onChange={(e) => setKind(e.target.value as MoveKind)}>{MOVES.map((m) => <option key={m.k} value={m.k}>{m.label}</option>)}</select>
        </Field>
        <div className="banner info">{def.help}</div>
        {isTransfer ? (
          <Field label="Dirección"><Seg value={from} options={[['caja', 'De caja a banco'], ['banco', 'De banco a caja']]} onChange={setFrom} label="Dirección de la transferencia" /></Field>
        ) : (
          <Field label={def.dir === 'in' ? 'Entra a' : 'Sale de'}>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)}>{methods.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.account === 'caja' ? 'efectivo en caja' : 'banco'})</option>)}</select>
          </Field>
        )}
        <CashGate data={data} needed={needsCash} />
        <Field label="Importe"><MoneyInput cents={amount} onChange={setAmount} aria-label="Importe" /></Field>
        {overdraw && <div className="banner">Este movimiento supera lo disponible en {fromAccount === 'caja' ? 'la caja' : 'el banco'} ({formatMXN(available)}). Se puede registrar, pero revisa que el importe sea correcto.</div>}
        <Field label={isTransfer ? 'Nota (opcional)' : 'Concepto'}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={isTransfer ? 'Ej. depósito del día' : `Ej. ${LEDGER_LABEL[kind] ?? ''}`} /></Field>
        {!isTransfer && <Field label="Referencia (opcional)"><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Folio, número de operación…" /></Field>}
      </div>
    </Sheet>
  )
}
