import { useState } from 'react'
import { lineAmounts } from '../../domain/lines'
import { formatMXN, formatQty } from '../../domain/money'
import { ITEM_STATUS_LABEL, ITEM_TYPE_LABEL } from '../../domain/orders'
import type { Authorization } from '../../domain/types'
import { authorizeItems } from '../../services/workorders'
import type { Data } from '../data'
import { isClosed, printHref, VIA_LABEL } from '../orders/helpers'
import { useCtx } from '../session'
import { Badge, Empty, Field, Sheet, useBusy, useUi } from '../ui'

export function AuthorizeSheet({ data, orderId, itemIds, onClose }: { data: Data; orderId: string; itemIds?: string[]; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const order = data.orderMap.get(orderId)
  const pending = order?.items.filter((i) => i.status === 'sugerido' || i.status === 'cotizado') ?? []
  const [sel, setSel] = useState<string[]>(() => (itemIds?.length ? itemIds : pending.map((i) => i.id)))
  const [by, setBy] = useState(() => (order ? data.custMap.get(order.customerId)?.name ?? '' : ''))
  const [via, setVia] = useState<Authorization['via']>('presencial')
  const [notes, setNotes] = useState('')
  const [done, setDone] = useState<Authorization>()

  if (!order) return <Sheet title="Autorizar trabajos" onClose={onClose}><Empty title="La orden no existe" /></Sheet>
  if (done) {
    return (
      <Sheet title="Autorización registrada" onClose={onClose} footer={<><a className="btn" href={printHref('autorizacion', orderId, done.id)}>Imprimir autorización</a><button className="btn primary" onClick={onClose}>Listo</button></>}>
        <div className="stack">
          <div className="banner ok" role="status">Se autorizaron {done.itemIds.length} partida(s) por {formatMXN(done.amountCents)} (con IVA), aprobadas por {done.approvedBy}.</div>
          <p className="small muted">Quedó registrado quién autorizó, cuándo, por qué importe y por qué vía. Si la orden estaba en recepción, diagnóstico o pendiente de autorización, pasó a «Autorizada».</p>
        </div>
      </Sheet>
    )
  }
  if (isClosed(order)) return <Sheet title="Autorizar trabajos" onClose={onClose}><Empty title="La orden ya no se puede modificar" /></Sheet>
  if (!pending.length) return <Sheet title="Autorizar trabajos" onClose={onClose}><Empty title="No hay partidas por autorizar" text="Las partidas sugeridas o cotizadas aparecen aquí. Agrega partidas a la orden para pedir autorización." /></Sheet>

  const quote = order.quotationId ? data.quotations.find((x) => x.id === order.quotationId) : undefined
  const quoteVersion = quote ? quote.approvedVersion : undefined
  const total = pending.filter((i) => sel.includes(i.id)).reduce((a, i) => a + lineAmounts(i, data.settings.pricesIncludeTax).totalCents, 0)
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))
  const autoMove = ['borrador', 'pendiente_autorizacion', 'en_diagnostico', 'espera_diagnostico'].includes(order.status)
  const invalid = !sel.length || !by.trim()

  const save = () => guard(async () => {
    if (invalid) { ui.toast(!sel.length ? 'Selecciona al menos una partida.' : 'Escribe quién autoriza.', true); return }
    const a = await ui.run(() => authorizeItems(ctx, orderId, { itemIds: sel, approvedBy: by, via, notes, quotationId: quoteVersion ? quote!.id : undefined, quotationVersion: quoteVersion }))
    if (a) setDone(a)
  })

  return (
    <Sheet title="Autorizar trabajos" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || invalid} onClick={save}>Registrar autorización</button></>}>
      <div className="stack">
        <div className="small muted">Orden {order.folio}. Marca lo que el cliente aprobó; el resto sigue pendiente.</div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
          <legend className="small muted" style={{ fontWeight: 600, marginBottom: 6 }}>Partidas por autorizar</legend>
          <div className="row between"><button type="button" className="btn small ghost" onClick={() => setSel(pending.map((i) => i.id))}>Marcar todas</button><button type="button" className="btn small ghost" onClick={() => setSel([])}>Quitar todas</button></div>
          {pending.map((i) => (
            <label key={i.id} className="item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.includes(i.id)} onChange={() => toggle(i.id)} aria-label={`Autorizar ${i.description}`} />
              <div className="grow"><div className="ttl">{i.description}</div><div className="sub">{ITEM_TYPE_LABEL[i.type]} · {formatQty(i.qty)} {i.unit}{i.discountCents > 0 && ` · descuento ${formatMXN(i.discountCents)}`}</div></div>
              <div style={{ textAlign: 'right' }}><div className="num"><b>{formatMXN(lineAmounts(i, data.settings.pricesIncludeTax).totalCents)}</b></div><Badge tone={i.status === 'cotizado' ? 'warn' : ''}>{ITEM_STATUS_LABEL[i.status]}</Badge></div>
            </label>
          ))}
        </fieldset>
        <div className="card flat row between" aria-live="polite"><span>Total que se aprueba (con IVA)</span><b className="num" style={{ fontSize: '1.2rem' }}>{formatMXN(total)}</b></div>

        <div className="ord-form-grid">
          <Field label="Quién autoriza" hint="Por defecto, el cliente de la orden."><input value={by} onChange={(e) => setBy(e.target.value)} autoComplete="off" /></Field>
          <Field label="Vía de autorización"><select value={via} onChange={(e) => setVia(e.target.value as Authorization['via'])}>{(Object.keys(VIA_LABEL) as Authorization['via'][]).map((v) => <option key={v} value={v}>{VIA_LABEL[v]}</option>)}</select></Field>
          <div className="full"><Field label="Notas (opcional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej. El cliente pidió posponer el cambio de balatas traseras." /></Field></div>
        </div>
        {quote && <div className="small muted">{quoteVersion ? `Se registrará la versión ${quoteVersion} de la cotización ${quote.folio} aprobada por el cliente.` : `La orden viene de la cotización ${quote.folio}, pero no tiene una versión aprobada: la autorización se registra sin versión.`}</div>}
        {autoMove && <div className="small muted">Al registrar, la orden pasará a «Autorizada».</div>}
      </div>
    </Sheet>
  )
}
