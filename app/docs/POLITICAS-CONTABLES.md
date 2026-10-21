# Políticas de cálculo gerencial

Vista de gestión, **no** contabilidad ni declaración fiscal.

| Concepto | Definición |
|---|---|
| Venta neta | Importe de ventas emitidas antes de impuestos, menos devoluciones (por fecha de devolución). |
| Cobro | Dinero recibido; vive en el libro `ledger` (`cobro_cliente`/`reembolso_cliente`). Saldo = total − devoluciones − cobros netos. |
| Costo de ventas | Costo congelado de cada partida al emitir: refacciones (costo de salida real), consumibles, externos y mano de obra imputada. |
| Utilidad bruta | Venta neta − costo de ventas. Margen = utilidad ÷ venta neta. Markup = utilidad ÷ costo. |
| Gastos operativos | Gastos devengados (por su fecha) de categorías «operativo». Las compras de inventario no son gasto: son activo hasta consumirse. |
| Utilidad operativa | Utilidad bruta − gastos operativos − capacidad ociosa. |
| Flujo de efectivo | Solo movimientos reales de caja/banco por su fecha. Aportaciones, préstamos y retiros se muestran aparte. |

**Costo promedio ponderado móvil**: una entrada suma cantidad y valor; una salida cuesta valor × cantidad ÷ existencias (si sale todo, sale todo el valor). Un cambio de costo posterior no altera costos ya aplicados.

**Compras**: costo de adquisición = mercancía − descuento + flete prorrateado por valor; en recepciones parciales se asigna flete proporcional y en la última el remanente. El IVA se trata como acreditable (no es costo) y se suma a la cuenta por pagar.

**Mano de obra**: costo por hora productiva = costo mensual × (1 + carga %) ÷ horas productivas. Se imputa por tramos de cronómetro (un mecánico solo puede tener uno abierto). Sin tiempos reales se usa el tiempo estándar y la partida se marca «costo estimado». **Nómina de mecánicos** (categoría `mano_obra_directa`): no se resta íntegra; solo `max(0, nómina − mano de obra imputada)` como capacidad ociosa.

**Indirectos**: fondo = gastos operativos «asignables». Métodos: ninguno, % de ventas, hora productiva, por orden. La suma asignada nunca excede el fondo. Es analítico: el resultado global no lo duplica.

**Punto de equilibrio** = costos fijos ÷ margen de contribución; fijos = gastos operativos + nómina de mecánicos; variables = refacciones, consumibles y externos (y mano de obra solo si no hay nómina registrada). Si el margen de contribución ≤ 0 no existe equilibrio. Es una proyección.

**Impuestos**: tasas configurables; `pricesIncludeTax` indica si los precios capturados ya incluyen IVA. Cada documento conserva sus importes al emitirse.

**Idempotencia**: pagos, ventas, recepciones, consumos, gastos y movimientos de caja aceptan una llave; reintentar con la misma llave devuelve el resultado original sin repetir efectos.
