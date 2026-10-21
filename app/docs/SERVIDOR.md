# Modelo de servidor (PostgreSQL) — propuesta probada, no conectada

`app/server/001_schema.sql` + `002_permissions.sql` (generado por `node server/gen-permissions.mjs` desde `src/domain/permissions.ts`) definen el modelo relacional multiempresa que usaría una futura sincronización (p. ej. Supabase).

Lo que garantiza **la base de datos** (probado con PGlite en `src/tests/server-schema.test.ts`):
- Aislamiento por organización con RLS y claves foráneas compuestas `(org_id, id)`: un registro no puede referenciar datos de otro taller.
- Permisos por rol (`has_perm`) en las políticas de escritura; alta de organización solo por `app.create_organization`.
- Historial inmutable (movimientos de inventario, libro de dinero, auditoría, precios).
- Inventario ≥ 0 con funciones `stock_in`/`stock_out` (costo promedio con bloqueo de fila), cobros ≤ saldo de la venta, pagos a proveedor ≤ saldo, idempotencia por `(org_id, op_key)`, sin traslapes de tiempos de un mecánico ni citas dobles.

Pendiente para usarlo: sincronización cliente-servidor (hoy los ids ya son UUID), reglas de fusión por registro, almacenamiento de archivos (las fotos hoy están en IndexedDB) y mover la lógica de emisión de ventas/recepciones a funciones del servidor. **Nada de esto está implementado en la app.**
