import { useState } from 'react'
import '../css/stock.css'
import { netPrice, taxRateOf } from '../../domain/alerts'
import { formatMXN, formatPct } from '../../domain/money'
import { marginPct, markupPct } from '../../domain/pricing'
import type { Product, ProductType } from '../../domain/types'
import { removeProduct, saveProduct } from '../../services/catalog'
import { unitCostOf } from '../alerts'
import type { Data } from '../data'
import { useCtx } from '../session'
import { Pct } from '../stock/parts'
import { Badge, Field, MoneyInput, NumInput, Sheet, useBusy, useUi } from '../ui'

export function ProductForm({ data: d, product, onClose }: { data: Data; product?: Product; onClose: () => void }) {
  const ctx = useCtx(), ui = useUi()
  const [busy, guard] = useBusy()
  const s = d.settings, canCost = d.can('costos.ver')
  const [f, setF] = useState({
    sku: product?.sku ?? '', barcode: product?.barcode ?? '', name: product?.name ?? '', description: product?.description ?? '',
    category: product?.category ?? s.productCategories[0] ?? '', brand: product?.brand ?? '', partNo: product?.partNo ?? '', type: (product?.type ?? 'refaccion') as ProductType,
    unit: product?.unit ?? s.units[0] ?? 'pza', supplierId: product?.supplierId ?? '', priceCents: product?.priceCents as number | undefined, taxId: product?.taxId ?? s.defaultTaxId,
    minStock: product?.minStock ?? s.lowStockDefault as number | undefined, location: product?.location ?? '', compat: product?.compat ?? '', minMarginPct: product?.minMarginPct as number | undefined, active: product?.active ?? true,
  })
  const [tried, setTried] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  const sku = f.sku.trim().toUpperCase()
  const err = {
    sku: !sku ? 'El SKU es obligatorio.' : d.products.some((p) => p.id !== product?.id && p.sku === sku) ? `Ya existe un producto con el SKU ${sku}.` : undefined,
    name: !f.name.trim() ? 'El nombre es obligatorio.' : undefined,
    barcode: f.barcode.trim() && d.products.some((p) => p.id !== product?.id && p.barcode === f.barcode.trim()) ? 'Ya existe un producto con ese código de barras.' : undefined,
    price: f.priceCents === undefined ? 'Captura el precio de venta.' : undefined,
    minStock: f.minStock !== undefined && f.minStock < 0 ? 'No puede ser negativo.' : undefined,
    minMargin: f.minMarginPct !== undefined && !(f.minMarginPct >= 0 && f.minMarginPct < 100) ? 'Debe estar entre 0 y 99.9.' : undefined,
  }
  const hasErr = Object.values(err).some(Boolean)
  const show = (k: keyof typeof err) => (tried || (k === 'sku' && !!sku) || (k === 'barcode')) ? err[k] : undefined

  const rate = taxRateOf(s, f.taxId), price = f.priceCents ?? 0
  const net = netPrice(price, rate, s.pricesIncludeTax), total = s.pricesIncludeTax ? price : Math.round(price * (1 + rate / 100))
  const cost = product ? unitCostOf(d, product.id) : 0
  const margin = cost > 0 ? marginPct(net, cost) : null, markup = cost > 0 ? markupPct(net, cost) : null
  const minM = f.minMarginPct ?? s.minMarginPct
  const priceLocked = !!product && !d.can('precios.editar')

  const save = () => guard(async () => {
    setTried(true)
    if (hasErr) { ui.toast('Revisa los campos marcados en rojo.', true); return }
    const p = await ui.run(() => saveProduct(ctx, { id: product?.id, sku, barcode: f.barcode, name: f.name, description: f.description, category: f.category, brand: f.brand, partNo: f.partNo, type: f.type, unit: f.unit, supplierId: f.supplierId || undefined, priceCents: f.priceCents, taxId: f.taxId, minStock: f.minStock, location: f.location, compat: f.compat, minMarginPct: f.minMarginPct, active: f.active }), product ? 'Producto actualizado' : 'Producto creado')
    if (p) onClose()
  })
  const del = () => guard(async () => {
    if (!product || !(await ui.confirm(`«${product.name}»: si ya tiene movimientos de inventario se desactivará (conserva su historial); si no, se eliminará definitivamente.`, 'Eliminar o desactivar', true))) return
    const r = await ui.run(() => removeProduct(ctx, product.id))
    if (r) { ui.toast(r === 'borrado' ? 'Producto eliminado' : 'El producto tiene historial: quedó desactivado'); onClose() }
  })

  return (
    <Sheet title={product ? 'Editar producto' : 'Nuevo producto'} wide onClose={onClose} footer={<>
      {product && d.can('inventario.editar') && <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy} onClick={del}>Eliminar</button>}
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" disabled={busy} onClick={save}>{product ? 'Guardar cambios' : 'Crear producto'}</button>
    </>}>
      <div className="stack-lg">
        <section className="stack"><h3>Identificación</h3>
          <div className="grid">
            <Field label="SKU *" error={show('sku')}><input value={f.sku} onChange={(e) => set('sku', e.target.value)} aria-invalid={!!show('sku') || undefined} autoCapitalize="characters" autoComplete="off" /></Field>
            <Field label="Código de barras" error={show('barcode')}><input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} inputMode="numeric" autoComplete="off" /></Field>
            <Field label="Número de parte"><input value={f.partNo} onChange={(e) => set('partNo', e.target.value)} autoComplete="off" /></Field>
          </div>
          <Field label="Nombre *" error={show('name')}><input value={f.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!show('name') || undefined} autoComplete="off" /></Field>
          <Field label="Descripción"><textarea value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} /></Field>
        </section>

        <section className="stack"><h3>Clasificación</h3>
          <div className="grid">
            <Field label="Categoría"><input list="stk-cats" value={f.category} onChange={(e) => set('category', e.target.value)} autoComplete="off" /></Field>
            <datalist id="stk-cats">{s.productCategories.map((c) => <option key={c} value={c} />)}</datalist>
            <Field label="Marca"><input value={f.brand} onChange={(e) => set('brand', e.target.value)} autoComplete="off" /></Field>
            <Field label="Tipo"><select value={f.type} onChange={(e) => set('type', e.target.value as ProductType)}><option value="refaccion">Refacción</option><option value="consumible">Consumible</option></select></Field>
            <Field label="Unidad de medida"><select value={f.unit} onChange={(e) => set('unit', e.target.value)}>{[...new Set([...s.units, f.unit])].map((u) => <option key={u} value={u}>{u}</option>)}</select></Field>
            <Field label="Proveedor principal"><select value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}><option value="">Sin proveedor</option>{d.suppliers.filter((x) => x.active || x.id === f.supplierId).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          </div>
        </section>

        <section className="stack"><h3>Precio de venta</h3>
          <div className="grid">
            <Field label={`Precio de venta (${s.pricesIncludeTax ? 'incluye IVA' : 'antes de IVA'}) *`} error={show('price')} hint={priceLocked ? 'No tienes permiso para cambiar precios.' : s.pricesIncludeTax ? `Sin IVA: ${formatMXN(net)}` : `Con IVA: ${formatMXN(total)}`}>
              <MoneyInput cents={f.priceCents} onChange={(c) => set('priceCents', c)} invalid={!!show('price')} disabled={priceLocked} />
            </Field>
            <Field label="Impuesto"><select value={f.taxId} onChange={(e) => set('taxId', e.target.value)}>{s.taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rate} %)</option>)}</select></Field>
            <Field label="Margen mínimo propio (%)" error={show('minMargin')} hint={`Vacío = el global (${formatPct(s.minMarginPct)})`}><NumInput value={f.minMarginPct} onChange={(v) => set('minMarginPct', v)} invalid={!!show('minMargin')} /></Field>
          </div>
          <div className="small muted">{s.pricesIncludeTax ? 'Tus precios se capturan con IVA incluido.' : 'Tus precios se capturan antes de IVA; el impuesto se suma al vender.'} (Se cambia en Ajustes.)</div>
          {canCost && (
            <div className="card flat stack" aria-live="polite">
              <b>Vista previa de rentabilidad</b>
              {cost > 0 ? (
                <>
                  <div className="row wrap" style={{ gap: 18 }}>
                    <span>Costo vigente <b className="num">{formatMXN(Math.round(cost))}</b></span>
                    <span>Precio neto <b className="num">{formatMXN(net)}</b></span>
                    <span>Margen <b><Pct v={margin} /></b></span>
                    <span>Markup <b><Pct v={markup} /></b></span>
                  </div>
                  {net < cost ? <Badge tone="bad">El precio queda por debajo del costo</Badge> : margin !== null && margin < minM ? <Badge tone="warn">Margen menor al mínimo ({formatPct(minM)})</Badge> : <Badge tone="ok">Cumple el margen mínimo</Badge>}
                </>
              ) : <div className="small muted">{product ? 'Este producto aún no tiene costo (sin compras ni existencias).' : 'Producto nuevo: el costo se registrará con la primera compra o entrada, y entonces verás el margen.'}</div>}
              <div className="small muted">Margen = utilidad ÷ precio neto; markup = utilidad ÷ costo.</div>
            </div>
          )}
        </section>

        <section className="stack"><h3>Inventario</h3>
          <div className="grid">
            <Field label="Stock mínimo" error={show('minStock')}><NumInput value={f.minStock} onChange={(v) => set('minStock', v)} invalid={!!show('minStock')} /></Field>
            <Field label="Ubicación en almacén"><input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Pasillo, estante…" autoComplete="off" /></Field>
          </div>
          <Field label="Compatibilidad con vehículos"><textarea value={f.compat} onChange={(e) => set('compat', e.target.value)} rows={2} placeholder="Marcas, modelos y años compatibles" /></Field>
          {!product && <div className="small muted">Las existencias iniciales se registran con una compra recibida o un ajuste de entrada.</div>}
          {product && <label className="chk"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} />Producto activo (disponible para vender y comprar)</label>}
        </section>
      </div>
    </Sheet>
  )
}
