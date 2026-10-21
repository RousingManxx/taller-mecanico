# Torque — arquitectura y convenciones de la interfaz

Torque es una PWA **local-first** (React 19 + TypeScript + Vite + Dexie/IndexedDB), en español de México (MXN).
Código en `app/src`. Tres capas, de adentro hacia afuera:

| Capa | Carpeta | Regla |
|---|---|---|
| **Dominio** | `src/domain` | Funciones puras (sin UI ni base de datos): márgenes, impuestos, inventario, estado de resultados, reportes, permisos. Cubierta por pruebas. |
| **Servicios** | `src/services` | **Toda escritura pasa por aquí.** Cada función verifica permisos (`need`), valida, abre UNA transacción (`tx`) sobre todas las tablas, audita y lanza `UserError` (mensaje en español) si algo no es válido. La UI nunca escribe directo en `ctx.db.<tabla>`. |
| **Interfaz** | `src/ui`, `src/pages` | Pantallas y formularios. Leen datos vivos con el prop `data` y escriben llamando servicios. |

## Reglas de dinero y cálculo (no negociables)
- **Todo importe es entero en centavos** (`*Cents`). Para mostrar: `formatMXN(cents)`. Para capturar pesos: `<MoneyInput cents onChange>` (guarda centavos).
- **Margen = utilidad ÷ venta neta**; **markup = utilidad ÷ costo**. Siempre con `marginPct()/markupPct()` de `domain/pricing.ts`; devuelven `null` cuando no es calculable → mostrar `n/c` con `formatPct(null)`. Nunca un % engañoso.
- **Venta ≠ cobro ≠ utilidad ≠ flujo de efectivo.** Ventas netas = antes de impuestos. Cobros = `ledger`. No mezclar.
- Costos y márgenes son **datos internos**: ocultarlos si `!data.can('costos.ver')` y nunca en documentos del cliente.
- Nunca inventes cifras ni series de relleno. Sin datos → estado vacío honesto (`<Empty>`), o `—`/`n/c`.
- Los servicios devuelven los importes ya calculados y congelados (ventas, recepciones). La UI puede mostrar previsualizaciones con las funciones de dominio (`lineAmounts`, `sumLines`, `orderTotals`, `quoteSummary`) pero el servidor-de-negocio es la fuente.

## Cómo llamar un servicio desde un componente
```tsx
const ctx = useCtx()            // ui/session: contexto del taller y usuario
const ui = useUi()              // ui/ui: toast, confirm, askReason, run
const opKey = useOpKey()        // llave idempotente: una por formulario abierto (pagos, ventas, recepciones, consumos, gastos)
const [busy, guard] = useBusy()  // evita doble envío
const save = () => guard(async () => {
  const r = await ui.run(() => registerPayment(ctx, { saleId, amountCents, methodId }, opKey), 'Cobro registrado')
  if (r) onClose()              // ui.run muestra el UserError como aviso rojo y devuelve undefined si falló
})
```
- Confirmaciones destructivas: `await ui.confirm('texto', 'Etiqueta', true)`. Motivos obligatorios (cancelar, devolver, ajustar): `const why = await ui.askReason('Cancelar orden')` (null si el usuario cancela).
- Los servicios que aceptan `opKey` son: `adjustStock`, `receivePurchase`, `paySupplier`, `createCounterSale`, `issueSaleFromOrder`, `registerPayment`, `consumeItem`, `saveExpense`, `payExpense`, `addCashMovement`. Si el usuario reintenta con la misma llave NO se duplica el efecto.
- El contexto `ctx.user` ya está autenticado. **Los permisos reales se verifican en los servicios**; en la UI usa `data.can('perm')` solo para mostrar/ocultar acciones (no sustituye la verificación).

## Datos
`data` (tipo `Data`, `ui/data.ts`) es reactivo (Dexie `useLiveQuery`): `data.customers`, `vehicles`, `orders`, `sales`, `ledger`, `products`, `stock` (Map productId → {qty, valueCents}), `custMap/vehMap/prodMap/svcMap/empMap/supMap/orderMap`, `settings`, `today` (fecha local del taller, `YYYY-MM-DD`), etc. No hay paginación en servidor: filtra/ordena en memoria y pagina en pantalla (`DataTable` ya pagina de 50 en 50).
Fechas de negocio son `YYYY-MM-DD`; marcas de tiempo son ISO. Formato: `fmtDate`, `fmtDateTime`, `fmtHours`, `plateOf(vehicle)` en `ui/data.ts`.
Funciones de dominio para pantallas financieras: `domain/finance.ts` (`saleBalance`, `salePaid`, `payStatus`, `receivables`, `payables`, `incomeStatement`, `cashFlow`, `series`, `profitBy`, `agingTotals`…), `domain/orders.ts` (`STATUS_LABEL`, `nextStatuses`, `canTransition`, `orderTotals`, `orderEconomics`, `timeSummary`, `estimatedLabor`), `domain/alerts.ts` (`priceAlert`, `productAlertFor`), `domain/quotes.ts`, `domain/dates.ts` (`periodRange`, `previousRange`, `PERIOD_LABEL`).

## Diseño y componentes (mobile-first)
- **No edites `src/index.css`** (archivo compartido). Usa sus clases: `card`, `stack`, `stack-lg`, `row`, `between`, `wrap`, `grow`, `grid`, `grid2`, `grid3`, `cols2`, `cols-main`, `item` (fila clicable), `stat`, `badge ok|warn|bad|info`, `banner [bad|ok|info]`, `btn [primary|danger|ghost|small|block]`, `seg`, `chips/chip`, `tablewrap/table`, `cards/rcard`, `kanban/kcol`, `tl` (línea de tiempo), `steps`, `bar`, `track/fill`, `muted`, `small`, `num`, `pos`, `neg`, `page-head`. Si necesitas CSS extra, crea `src/ui/css/<area>.css` e impórtalo desde tu página (prefija las clases con tu área).
- `ui/ui.tsx`: `Icon`, `Sheet` (hoja inferior en móvil / diálogo en escritorio; `wide` para formularios grandes), `Field`, `NumInput`, `MoneyInput`, `Seg`, `Chips`, `Badge`, `Stat` (con `delta`, `to`), `Empty`, `DataTable` (tabla en ≥700 px, tarjetas en móvil; define `primary` y `hideMobile` en columnas), `deltaText`, `useMedia`.
- `ui/charts.tsx`: `TrendChart`, `MarginChart`, `SeriesBars`, `Donut`/`toSlices`, `HBars`, `Legend`, `compactMXN`.
- **Formularios largos** → secciones (`<h3>` + `.stack`) dentro de `Sheet wide`; en móvil una columna. Tablas extensas **siempre** con alternativa de tarjetas (usa `DataTable`).
- Abre formularios desde cualquier pantalla con `const open = useOpen()` → `open({ k: 'payment', saleId })` (tipos en `ui/create.tsx`).
- Accesibilidad: cada campo con `<Field label>`; botones con texto o `aria-label`; foco visible (ya en CSS); filas clicables ya soportan Enter/Espacio en `DataTable`; no comunicar estados solo con color (usa `Badge` con texto). Tamaños táctiles ≥ 44 px (clases ya lo cumplen).
- Textos en español de México, tono claro y directo. Los errores de validación deben ser comprensibles y decir qué hacer.

## Contratos de rutas y parámetros (HashRouter, `#/ruta?param`)
`/ordenes?estado=<OrderStatus|abiertas>&q=` · `/ordenes/:id` · `/clientes?q=` · `/clientes/:id` · `/vehiculos?q=` · `/vehiculos/:id` · `/cotizaciones?estado=` · `/cotizaciones/:id` · `/ventas?f=pendientes|hoy` · `/ventas/:id` · `/inventario?f=productos|servicios|movimientos|alertas|margen|propuesta&q=` · `/compras?t=ordenes|proveedores|recepciones|comparar` · `/caja` · `/gastos?t=gastos|recurrentes` · `/cobranza?t=cobrar|pagar` · `/agenda` · `/rentabilidad` · `/reportes/:id`.
Documentos imprimibles (los construye otra persona; solo enlázalos con `<a className="btn" href={`#/imprimir/orden/${id}`} target="_blank" rel="noopener">Imprimir</a>`): `/imprimir/orden/:orderId`, `/imprimir/recepcion/:orderId`, `/imprimir/autorizacion/:orderId?auth=<authId>`, `/imprimir/entrega/:orderId`, `/imprimir/garantia/:orderId`, `/imprimir/cotizacion/:quoteId`, `/imprimir/venta/:saleId`, `/imprimir/comprobante/:ledgerId`, `/imprimir/compra/:poId`.

## Calidad y verificación
- `npx tsc -b` debe pasar sin errores **en tus archivos** (puede haber errores transitorios en archivos de otros agentes que trabajan en paralelo: ignóralos). `npx oxlint` sin errores en tus archivos. `npx vitest run` debe seguir pasando (no modifiques `domain/` ni `services/`: si encuentras un error o falta algo, repórtalo con detalle al final en lugar de editarlo).
- Verifica en navegador real con Playwright + Edge (ya instalado): `e2e/helpers.mjs` exporta `launch({mobile})`, `startDemo(page, base)` (crea el taller de demostración y entra como propietario en ~3 s), `login(...)`, `hash(page, base, '/ruta')`. Levanta SOLO tu servidor de desarrollo en el puerto que se te asignó (`npx vite --port <P> --strictPort &`). **No ejecutes `npm run build`** (usa la carpeta `dist` compartida). Toma capturas en 390×800 (móvil) y 1280×800 (escritorio) en la carpeta de scratchpad y revísalas; corrige lo que se vea mal. Comprueba que no haya errores de consola.
- Prueba los flujos con datos reales de la demostración (hay ~75 órdenes, ventas, compras, pagos y gastos) y también el caso vacío (taller nuevo: `Crear mi taller`).
- Cada botón principal debe ejecutar una acción real; nada de botones decorativos.
