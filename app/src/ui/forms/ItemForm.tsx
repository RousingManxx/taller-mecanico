import { useState } from 'react'
import { priceAlert, PRICE_ALERT_TEXT, taxRateOf } from '../../domain/alerts'
import { lineAmounts } from '../../domain/lines'
import { formatMXN, formatPct, formatQty } from '../../domain/money'
import { ITEM_TYPE_LABEL } from '../../domain/orders'
import { marginPct, profitCents } from '../../domain/pricing'
import type { ItemType, Product, ServiceDef } from '../../domain/types'
import { addItem, type ItemSpec } from '../../services/workorders'
import type { Data } from '../data'
import { isClosed, stockQty, unitCostOf } from '../orders/helpers'
import { Picker } from '../orders/parts'
import { useCtx } from '../session'
import { Empty, Field, MoneyInput, NumInput, Seg, Sheet, useBusy, useUi } from '../ui'

const TABS: [ItemType, string][] = [['servicio', 'Servicio'], ['refaccion', 'Refacción'], ['consumible', 'Consumible'], ['externo', 'Servicio externo'], ['otro', 'Otro cargo']]

export function ItemForm({ data, orderId, onClose }: { data: Data; orderId: string; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const order = data.orderMap.get(orderId)
  const s = data.settings
  const costs = data.can('costos.ver')
  const [type, setType] = useState<ItemType>('servicio')
  const [svc, setSvc] = useState<ServiceDef>()
  const [prod, setProd] = useState<Product>()
  const [qty, setQty] = useState<number | undefined>(1)
  const [price, setPrice] = useState<number | undefined>()
  const [disc, setDisc] = useState<number | undefined>(0)
  const [desc, setDesc] = useState('')
  const [estCost, setEstCost] = useState<number | undefined>()
  const [tried, setTried] = useState(false)
  const [added, setAdded] = useState(0)

  if (!order) return <Sheet title="Agregar partida" onClose={onClose}><Empty title="La orden no existe" /></Sheet>
  if (isClosed(order)) return <Sheet title="Agregar partida" onClose={onClose}><Empty title="La orden ya no se puede modificar" text={`Está ${order.status === 'entregada' ? 'entregada' : 'cancelada'}. Para un trabajo posterior abre una garantía o una orden nueva.`} /></Sheet>

  const warranty = order.isWarranty
  const picked = type === 'servicio' ? svc : type === 'refaccion' || type === 'consumible' ? prod : undefined
  const taxRate = taxRateOf(s, type === 'servicio' ? svc?.taxId ?? s.defaultTaxId : picked && 'taxId' in picked ? picked.taxId : s.defaultTaxId)
  const unitPrice = warranty ? 0 : price ?? 0
  const discount = warranty ? 0 : disc ?? 0
  const q = qty ?? 0
  const amounts = lineAmounts({ qty: q, unitPriceCents: unitPrice, discountCents: discount, taxRate }, s.pricesIncludeTax)
  const stock = prod ? stockQty(data, prod.id) : 0
  const unitCost = prod ? unitCostOf(data, prod) : 0
  // Precio efectivo por unidad (con descuento) para evaluar la rentabilidad con la misma base que el catálogo.
  const effUnit = q > 0 ? Math.round((q * unitPrice - discount) / q) : unitPrice
  const alert = prod && (type === 'refaccion' || type === 'consumible') ? priceAlert(effUnit, unitCost, taxRate, s, prod.minMarginPct) : null

  const errors = {
    pick: (type === 'servicio' && !svc) ? 'Elige un servicio del catálogo.' : ((type === 'refaccion' || type === 'consumible') && !prod) ? `Elige ${type === 'refaccion' ? 'una refacción' : 'un consumible'} del inventario.` : '',
    desc: (type === 'externo' || type === 'otro') && !desc.trim() ? 'Describe la partida.' : '',
    qty: !(q > 0) ? 'La cantidad debe ser mayor que cero.' : '',
    price: price === undefined && !warranty ? 'Captura el precio unitario.' : '',
    disc: discount < 0 || discount > Math.round(q * unitPrice) ? 'El descuento no puede ser negativo ni mayor al importe.' : '',
  }
  const invalid = Object.values(errors).some(Boolean)

  const changeType = (t: ItemType) => { setType(t); setPrice(undefined); setSvc(undefined); setProd(undefined); setDesc(''); setEstCost(undefined); setTried(false) }
  const pickSvc = (v?: ServiceDef) => { setSvc(v); setPrice(v?.priceCents) }
  const pickProd = (v?: Product) => { setProd(v); setPrice(v?.priceCents) }
  const reset = () => { setSvc(undefined); setProd(undefined); setPrice(undefined); setQty(1); setDisc(0); setDesc(''); setEstCost(undefined); setTried(false) }

  const save = (keep: boolean) => guard(async () => {
    setTried(true)
    if (invalid) { ui.toast('Revisa los campos marcados.', true); return }
    const sp: ItemSpec = { type, qty: q, unitPriceCents: unitPrice, discountCents: discount }
    if (type === 'servicio') sp.refId = svc!.id
    else if (type === 'refaccion' || type === 'consumible') sp.refId = prod!.id
    else { sp.description = desc; if (type === 'externo') sp.costCents = estCost ?? 0 }
    const it = await ui.run(() => addItem(ctx, orderId, sp), 'Partida agregada')
    if (!it) return
    if (keep) { reset(); setAdded((n) => n + 1) } else onClose()
  })

  const autoAuth = warranty || !s.requireAuthorization
  const needsCatalog = type === 'servicio' || type === 'refaccion' || type === 'consumible'
  const items = type === 'servicio' ? data.services.filter((x) => x.active) : data.products.filter((x) => x.active && x.type === type)

  return (
    <Sheet title="Agregar partida" wide onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{added ? 'Cerrar' : 'Cancelar'}</button>
      <button className="btn" disabled={busy} onClick={() => save(true)}>Agregar y seguir</button>
      <button className="btn primary" disabled={busy} onClick={() => save(false)}>Agregar</button>
    </>}>
      <div className="stack">
        <div className="small muted">Orden {order.folio}{added > 0 && ` · ${added} partida${added > 1 ? 's' : ''} agregada${added > 1 ? 's' : ''} en esta sesión`}</div>
        <Seg<ItemType> label="Tipo de partida" value={type} onChange={changeType} options={TABS} />
        {warranty && <div className="banner info">Orden de garantía: el cliente no paga estas partidas (precio $0), pero su costo se registra contra la orden.</div>}

        {type === 'servicio' && (
          <Picker<ServiceDef> label="Servicio del catálogo" items={items as ServiceDef[]} value={svc} onChange={pickSvc} error={tried ? errors.pick : ''}
            title={(x) => x.name} sub={(x) => `${x.category}${x.stdHours ? ` · ${x.stdHours} h estándar` : ''}`} right={(x) => formatMXN(x.priceCents)} haystack={(x) => `${x.name} ${x.category} ${x.description}`}
            placeholder="Busca por nombre o categoría" emptyText="No hay servicios con ese dato. Agrégalos en el catálogo de servicios." />
        )}
        {(type === 'refaccion' || type === 'consumible') && (
          <Picker<Product> label={type === 'refaccion' ? 'Refacción del inventario' : 'Consumible del inventario'} items={items as Product[]} value={prod} onChange={pickProd} error={tried ? errors.pick : ''}
            title={(x) => x.name} sub={(x) => `${x.sku}${x.partNo ? ` · Parte ${x.partNo}` : ''}${x.brand ? ` · ${x.brand}` : ''}`}
            right={(x) => <><div>{formatMXN(x.priceCents)}</div><div className={stockQty(data, x.id) <= 0 ? 'neg' : 'muted'}>{formatQty(stockQty(data, x.id))} {x.unit} en existencia</div></>}
            haystack={(x) => `${x.name} ${x.sku} ${x.partNo} ${x.brand} ${x.barcode} ${x.compat}`} placeholder="Busca por nombre, SKU o número de parte"
            emptyText={`No hay ${type === 'refaccion' ? 'refacciones' : 'consumibles'} con ese dato.`} />
        )}
        {(type === 'externo' || type === 'otro') && (
          <Field label={type === 'externo' ? 'Servicio externo (qué se manda a hacer y con quién)' : 'Concepto del cargo'} error={tried ? errors.desc : ''}>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} aria-invalid={tried && !!errors.desc} placeholder={type === 'externo' ? 'Ej. Rectificado de cabeza — Torno Pérez' : 'Ej. Gestión de trámite, flete…'} />
          </Field>
        )}

        {(!needsCatalog || picked) && (
          <>
            <div className="ord-form-grid">
              <Field label={`Cantidad${prod ? ` (${prod.unit})` : ''}`} error={tried ? errors.qty : ''}><NumInput value={qty} onChange={setQty} invalid={tried && !!errors.qty} /></Field>
              <Field label={`Precio unitario ${s.pricesIncludeTax ? '(incluye IVA)' : '(sin IVA)'}`} error={tried ? errors.price : ''} hint={warranty ? 'En garantía el precio es $0.' : undefined}>
                <MoneyInput cents={warranty ? 0 : price} onChange={setPrice} invalid={tried && !!errors.price} disabled={warranty} />
              </Field>
              <Field label="Descuento (importe)" error={tried ? errors.disc : ''} hint="Se resta del importe de la partida, no es porcentaje."><MoneyInput cents={warranty ? 0 : disc} onChange={setDisc} invalid={tried && !!errors.disc} disabled={warranty} /></Field>
              {type === 'externo' && (
                <Field label="Costo estimado del proveedor (total)" hint="El costo real se captura al marcar la partida como ejecutada."><MoneyInput cents={estCost} onChange={setEstCost} /></Field>
              )}
            </div>

            {prod && (
              <div className="stack-sm">
                <div className="small">Existencias: <b>{formatQty(stock)} {prod.unit}</b>{prod.location && <> · Ubicación {prod.location}</>}</div>
                {stock <= 0 && <div className="banner">No hay existencias de esta pieza. Puedes agregarla a la orden; para consumirla necesitas recibir compra o ajustar inventario, y mientras tanto pasar la orden a «Esperando refacciones».</div>}
                {stock > 0 && q > stock && <div className="banner">Pides {formatQty(q)} y solo hay {formatQty(stock)} {prod.unit}: no alcanza el inventario para consumirla completa.</div>}
                {costs && (
                  <div className="small muted">
                    {unitCost > 0
                      ? <>Costo promedio: {formatMXN(Math.round(unitCost))} por {prod.unit} · Utilidad por {prod.unit}: {formatMXN(Math.round(profitCents(alert?.netPriceCents ?? 0, unitCost)))} · Margen: <b>{formatPct(alert?.marginPct ?? null)}</b> <span>(utilidad ÷ venta neta)</span></>
                      : 'Sin costo registrado para esta pieza: el margen no se puede calcular hasta registrar una compra.'}
                  </div>
                )}
                {costs && alert && alert.kind && alert.kind !== 'sin_costo' && <div className="banner bad" role="alert">{PRICE_ALERT_TEXT[alert.kind]}{alert.kind === 'margen_bajo' && ` (${formatPct(alert.marginPct)} contra mínimo de ${formatPct(alert.minMarginPct)})`}. Revisa el precio o el descuento.</div>}
              </div>
            )}
            {type === 'servicio' && svc && (
              <div className="small muted">Tiempo estándar: {svc.stdHours} h. {costs && 'El costo de mano de obra se calcula con el tiempo real que registre el mecánico.'}{!costs && ''}</div>
            )}
            {type === 'externo' && costs && estCost !== undefined && (
              <div className="small muted">Con el costo estimado el margen sería <b>{formatPct(marginPct(amounts.netCents, estCost))}</b>.{unitPrice > 0 && estCost > amounts.netCents && ' El costo estimado supera la venta neta.'}</div>
            )}

            <div className="card flat ord-totals" aria-live="polite">
              <div><span>Importe neto (antes de IVA)</span><b className="num">{formatMXN(amounts.netCents)}</b></div>
              <div><span>IVA ({taxRate} %)</span><span className="num">{formatMXN(amounts.taxCents)}</span></div>
              <div className="big"><span>Total de la partida</span><span className="num">{formatMXN(amounts.totalCents)}</span></div>
            </div>
            <div className="small muted">{ITEM_TYPE_LABEL[type]} · Quedará como <b>{autoAuth ? 'Autorizado' : 'Sugerido'}</b>{autoAuth ? (warranty ? ' (garantía).' : ' porque el taller no exige autorización previa.') : ': no se cobra hasta que el cliente la autorice.'}</div>
          </>
        )}
      </div>
    </Sheet>
  )
}
