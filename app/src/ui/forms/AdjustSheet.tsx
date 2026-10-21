import { useMemo, useState } from 'react'
import '../css/stock.css'
import { formatMXN, formatQty, round } from '../../domain/money'
import { adjustStock, type AdjustInput } from '../../services/inventory'
import { unitCostOf } from '../alerts'
import type { Data } from '../data'
import { useCtx } from '../session'
import { norm } from '../stock/helpers'
import { Field, MoneyInput, NumInput, Sheet, useBusy, useOpKey, useUi } from '../ui'

type Kind = 'entrada' | 'ajuste_positivo' | 'ajuste_negativo' | 'merma'
const KINDS: Record<Kind, { label: string; input: Pick<AdjustInput, 'direction' | 'kind'>; hint: string }> = {
  entrada: { label: 'Entrada de mercancía (sin compra registrada)', input: { direction: 'entrada', kind: 'entrada' }, hint: 'Suma existencias con un costo unitario.' },
  ajuste_positivo: { label: 'Ajuste positivo (corrección a favor)', input: { direction: 'entrada', kind: 'ajuste' }, hint: 'Corrige un faltante en el sistema.' },
  ajuste_negativo: { label: 'Ajuste negativo (corrección en contra)', input: { direction: 'salida', kind: 'ajuste' }, hint: 'Corrige un sobrante en el sistema; sale al costo promedio.' },
  merma: { label: 'Merma (pérdida, daño o caducidad)', input: { direction: 'salida', kind: 'merma' }, hint: 'Registra una pérdida; sale al costo promedio y afecta el costo.' },
}

export function AdjustSheet({ data: d, productId, onClose }: { data: Data; productId?: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi(), opKey = useOpKey()
  const [busy, guard] = useBusy()
  const canCost = d.can('costos.ver')
  const [pid, setPid] = useState(productId ?? '')
  const [find, setFind] = useState('')
  const [kind, setKind] = useState<Kind>('ajuste_negativo')
  const [qty, setQty] = useState<number | undefined>()
  const [unit, setUnit] = useState<number | undefined>()
  const [why, setWhy] = useState('')
  const [tried, setTried] = useState(false)
  const prods = useMemo(() => {
    const t = norm(find.trim())
    return d.products.filter((p) => (p.active || p.id === productId) && (!t || [p.sku, p.name, p.partNo, p.barcode].some((s) => norm(s).includes(t)))).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 200)
  }, [d.products, find, productId])
  const p = pid ? d.prodMap.get(pid) : undefined
  const st = p ? d.stock.get(p.id) ?? { qty: 0, valueCents: 0 } : undefined
  const avg = p ? unitCostOf(d, p.id) : 0
  const out = KINDS[kind].input.direction === 'salida'
  const err = {
    p: !p ? 'Elige el producto.' : undefined,
    qty: !(qty !== undefined && qty > 0) ? 'La cantidad debe ser mayor que cero.' : out && st && qty !== undefined && qty > st.qty + 1e-9 ? `Solo hay ${formatQty(st.qty)} ${p?.unit}: no se puede sacar más de lo que existe.` : undefined,
    unit: !out && avg <= 0 && !(unit !== undefined && unit > 0) ? 'Este producto no tiene costo previo: indica el costo unitario de la entrada.' : undefined,
    why: !why.trim() ? 'El motivo es obligatorio: queda en el historial y la auditoría.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried ? err[k] : undefined)
  const unitUsed = !out ? (unit !== undefined && unit > 0 ? unit : avg) : avg
  const after = st && qty && qty > 0 ? st.qty + (out ? -qty : qty) : undefined
  const save = () => guard(async () => {
    setTried(true)
    if (hasErr || !p || !qty) { ui.toast('Revisa los campos marcados en rojo.', true); return }
    const m = await ui.run(() => adjustStock(ctx, { productId: p.id, qty, ...KINDS[kind].input, unitCostCents: !out ? unit : undefined, reason: why }, opKey), `Movimiento registrado: ${p.name}`)
    if (m) onClose()
  })
  return (
    <Sheet title="Ajuste de inventario" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={save}>Registrar movimiento</button>
    </>}>
      <div className="stack">
        {!productId && <Field label="Buscar producto"><input type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="SKU, nombre, parte o código de barras" autoComplete="off" /></Field>}
        <Field label="Producto *" error={show('p')}>
          <select value={pid} onChange={(e) => setPid(e.target.value)} aria-invalid={!!show('p') || undefined} disabled={!!productId}>
            <option value="">— Elegir producto —</option>
            {prods.map((x) => <option key={x.id} value={x.id}>{x.sku} · {x.name} ({formatQty(d.stock.get(x.id)?.qty ?? 0)} {x.unit})</option>)}
          </select>
        </Field>
        <Field label="Tipo de movimiento *" hint={KINDS[kind].hint}>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>{(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}</select>
        </Field>
        <div className="grid">
          <Field label={`Cantidad${p ? ` (${p.unit})` : ''} *`} error={show('qty')}><NumInput value={qty} onChange={setQty} invalid={!!show('qty')} /></Field>
          {!out && (
            <Field label="Costo unitario (sin IVA)" error={show('unit')} hint={avg > 0 ? (canCost ? `Vacío = costo promedio vigente (${formatMXN(Math.round(avg))})` : 'Vacío = costo promedio vigente') : 'Obligatorio: aún no hay costo'}>
              <MoneyInput cents={unit} onChange={setUnit} invalid={!!show('unit')} />
            </Field>
          )}
        </div>
        <Field label="Motivo *" error={show('why')}><textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Ej. Conteo en estante, pieza dañada en el traslado…" aria-invalid={!!show('why') || undefined} /></Field>
        {p && st && (
          <div className="card flat stack-sm" aria-live="polite">
            <div className="row between wrap"><span className="muted">Existencias actuales</span><b className="num">{formatQty(st.qty)} {p.unit}</b></div>
            {after !== undefined && <div className="row between wrap"><span className="muted">Existencias después</span><b className={`num ${after < 0 ? 'neg' : ''}`}>{formatQty(after)} {p.unit}</b></div>}
            {canCost && qty && qty > 0 && unitUsed > 0 && <div className="row between wrap"><span className="muted">{out ? 'Costo que sale del inventario' : 'Valor que entra al inventario'}</span><b className="num">{formatMXN(round(unitUsed * qty))}</b></div>}
          </div>
        )}
        <div className="small muted">El movimiento queda en el historial y no se puede editar: si te equivocas, registra otro ajuste que lo compense.</div>
      </div>
    </Sheet>
  )
}
