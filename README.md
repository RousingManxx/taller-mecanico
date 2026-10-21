# Torque — gestión integral de talleres mecánicos (PWA)

PWA **local-first** en español (MXN): órdenes de trabajo, cotizaciones, clientes y vehículos, agenda, inventario con costo promedio, compras y proveedores, ventas y cobros, caja, gastos, cuentas por cobrar/pagar, personal y **rentabilidad real** por partida, orden, refacción, servicio y periodo. Código en `app/`.

> **Alcance real de esta versión.** Funciona 100 % en el dispositivo (IndexedDB), con o sin conexión. **No hay servidor**: los roles y permisos se verifican en la capa de servicios de la app, no en un backend, así que no son una frontera de seguridad frente a quien controle el dispositivo. Un esquema de servidor (PostgreSQL con RLS) está diseñado y probado en `app/server/`, pero la app **no está conectada a él**. Ver «Limitaciones».

## Ejecutar

```powershell
cd app
npm install
npm run dev            # http://localhost:5173
npm test               # 80 pruebas (Vitest)
npx tsc -b             # tipos
npm run build          # producción en app/dist
```
Guía de uso completa: `app/docs/GUIA-DE-USO.md` (también dentro de la app: menú del perfil → Guía de uso).

Al abrir, elige **Crear mi taller** o **Explorar con datos de demostración** (taller ficticio y separado, PIN de todos los usuarios: `1234`).

## Instalar como app
Publica `app/dist` en un hosting HTTPS estático (el workflow `.github/workflows/deploy.yml` lo hace con GitHub Pages: ejecuta `tsc`, las pruebas y la compilación). Después: Chrome/Edge → «Instalar»; Android → «Instalar app»; iPhone → Safari → Compartir → «Añadir a pantalla de inicio». La instalación en iPhone/Android **no se probó** (no hay dispositivos en este entorno); sí se verificó service worker, manifest y arranque sin conexión en Edge. La app busca versiones nuevas sola y muestra la versión al final de Ajustes. Más en `app/docs/DESPLIEGUE.md`.

## Arquitectura
Tres capas (detalle en `app/docs/ARQUITECTURA-UI.md`): **dominio puro** (`src/domain`: márgenes, impuestos, inventario, estado de resultados, reportes, permisos) → **servicios transaccionales** (`src/services`: toda escritura, con permisos, validación, auditoría e idempotencia, en una sola transacción) → **interfaz** (`src/ui`, `src/pages`). Una base IndexedDB **por taller** (aislamiento entre organizaciones) con `orgId` verificado además en cada registro. Movimientos de inventario, de dinero, auditoría e historial de precios son de **solo anexar** (hooks que impiden editar o borrar; los errores se corrigen con movimientos compensatorios).

## Política de cálculo (resumen; completo en `app/docs/POLITICAS-CONTABLES.md`)
- Dinero en centavos enteros, redondeo explícito. **Margen = utilidad ÷ venta neta; markup = utilidad ÷ costo**; si la base es 0 se muestra «n/c», nunca un % engañoso.
- **Venta ≠ cobro ≠ utilidad ≠ flujo de caja.** Las ventas se reconocen al emitirse; los cobros salen de un único libro de movimientos; aportaciones, préstamos y retiros del propietario no son ventas ni gastos.
- Inventario a **costo promedio ponderado móvil**; cada salida congela su costo en la partida. Compras: mercancía − descuento + flete prorrateado (el IVA acreditable no es costo). Recepciones parciales sin perder ni duplicar flete.
- Mano de obra imputada = horas reales × costo por hora productiva (salario × (1+carga) ÷ horas productivas). La **nómina de mecánicos no se resta dos veces**: solo la parte no absorbida (capacidad ociosa). Sin tiempos reales el costo es estimado y se rotula así.
- Indirectos: asignación analítica (porcentaje de ventas, hora productiva, por orden o ninguna); el resultado global resta el fondo una sola vez.
- Impuestos configurables (IVA 16 %, 0 %, exento son valores iniciales editables; verifícalos con tu contador). **Es una vista gerencial, no contabilidad ni facturación fiscal.**

## Verificación realizada (evidencia real)
- `npm test`: **80 pruebas pasan** — cálculos de dominio (margen, markup, redondeo, IVA, costo promedio, fechas, antigüedad, equilibrio), flujos A–F de punta a punta sobre IndexedDB simulada (orden → cobro → entrega → rentabilidad; venta de mostrador; compra parcial con flete; gastos y nómina sin doble conteo; caja con diferencia; cotización versionada), idempotencia (reintentos de pago, venta, recepción, consumo), integridad (cancelaciones, devoluciones, historial inmutable, saldos), aislamiento entre talleres, permisos en servicios, bloqueo de PIN, respaldo/restauración, exportaciones y protección contra inyección de fórmulas CSV, un taller de demostración cuyos invariantes se verifican (valor de inventario = suma de movimientos, cajas cuadradas, sin sobrepagos, 24 reportes), y el esquema PostgreSQL probado con PGlite (RLS, claves foráneas entre organizaciones, inventario ≥ 0, cobros ≤ saldo, idempotencia, traslapes).
- Navegador real (Edge, escritorio y móvil): recorrido de todas las rutas con datos de demostración y en un taller vacío **sin errores de consola** (`e2e/shot.mjs`, `e2e/empty.mjs`); PWA con service worker y arranque offline (`e2e/pwa.mjs`); los agentes de interfaz recorrieron además crear/autorizar/consumir/entregar/cancelar órdenes y la garantía (capturas), **pero no conservé sus reportes de prueba**, así que esos recorridos no están respaldados por un script reutilizable.

## Funcionalidades
Terminadas: taller y usuarios con PIN y roles (6 roles + permisos personalizables), clientes, vehículos (historial y recurrencias), agenda con choque de mecánicos, órdenes (12 estados con guardas, partidas con autorización, cronómetros sin horas dobles, consumo de refacciones, entrega, cancelación, garantía), cotizaciones con versiones, ventas y cobros parciales, devoluciones, caja con sesiones, gastos y recurrentes, cuentas por cobrar/pagar con antigüedad, inventario (ajustes, mermas, conteo físico, alertas, propuesta de compra), compras con recepción parcial y pagos, personal y productividad, panel de inicio, rentabilidad (orden, refacción, servicio, mano de obra, indirectos, calculadora, propuestas de precio con aprobación, punto de equilibrio), 24 reportes con CSV e impresión/PDF, documentos imprimibles, respaldo/restauración JSON, exportación CSV, demostración separada.

## Limitaciones conocidas
- Sin servidor ni sincronización entre dispositivos (se mueven datos con el respaldo JSON). Los permisos no protegen contra quien controle el dispositivo.
- Un solo almacén y una sola sucursal en la interfaz (el modelo ya incluye almacenes). Sin conversión de unidades de compra/venta. Estados de orden fijos (no configurables).
- PDF vía el diálogo de impresión del navegador (en PWAs de iOS puede ser poco fiable). Sin firma electrónica.
- Rendimiento: los datos se cargan en memoria; probado con la demostración (~80 órdenes), **no** con decenas de miles de registros.
- Sin pruebas automatizadas de interfaz que cubran todos los formularios; sin pruebas en iPhone/Android reales.

## Pendiente (no implementado)
Facturación fiscal (CFDI), notificaciones por WhatsApp/SMS/correo, asistente de IA, integraciones bancarias y con proveedores, sincronización con servidor, múltiples sucursales, devoluciones a proveedor. Ver `app/docs/INTEGRACIONES.md` y `app/docs/SERVIDOR.md`.
