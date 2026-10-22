# Historial de cambios

Todos los cambios relevantes de Torque se anotan aquí. Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versionado [SemVer](https://semver.org/lang/es/): **MAYOR.MENOR.PARCHE** (MAYOR: cambia el formato de datos o rompe compatibilidad; MENOR: función nueva; PARCHE: corrección).

> Las versiones 1.0.0 a 1.2.1 se asignaron **retroactivamente** a partir del historial de Git (todas del 20–21 de octubre de 2026). `app/package.json` indica la versión vigente; la pantalla de Ajustes muestra además el commit y la fecha de compilación.

**Cómo publicar una versión:** mueve lo de «Sin publicar» a una sección nueva con su número y fecha, sube `version` en `app/package.json` y haz el merge a `main` (el workflow publica en GitHub Pages).

## [Sin publicar]

## [1.3.2] — 2026-10-22

### Corregido
- **Paneles que aparecían al fondo de la página (sobre todo en teléfono).** Al tocar un registro de Inventario (productos y servicios), y también en Agenda, Gastos, Cotizaciones, Vehículos y la revisión de copias en Ajustes, la pantalla se oscurecía pero el panel quedaba al final del contenido y había que bajar para verlo; además la página saltaba al abrirlo. Causa: la animación de entrada de cada página conservaba una transformación al terminar, y eso hacía que el panel (`position: fixed`) se midiera contra la página y no contra la pantalla. Ahora los paneles se dibujan directamente en `body`, la animación ya no deja transformación (`fill-mode: backwards`) y enfocar el panel no desplaza la página.
- La barra de pasos del detalle de una orden conserva su contención (`.page` pasa a ser explícitamente el marco de lo `position: absolute`); sin eso, quitar la transformación habría provocado desbordamiento horizontal.

### Agregado
- Recorrido E2E `app/e2e/sheet.mjs` (17 comprobaciones, teléfono y escritorio): el panel cubre exactamente la pantalla, se ve completo, no desplaza la página y cuelga de `body`.

## [1.3.1] — 2026-10-22

### Agregado
- **Client ID revocado, eliminado o mal configurado:** si Google rechaza la aplicación, el respaldo en Drive se inhabilita con un aviso claro (global y en Ajustes), la app deja de insistir con ventanas de error, los datos locales y las copias manuales siguen funcionando y «Reintentar» vuelve a conectar cuando se corrija. Antes aparecía «Reconectar» una y otra vez sin explicar el motivo. Ver `app/docs/DRIVE.md`.
- Los fallos de Drive llevan un código (`reconnect`, `session`, `offline`, `http`, `blocked`) para que la interfaz sepa qué ofrecer; el aviso de límite de uso (403) orienta sobre una aplicación deshabilitada.
- Recorrido E2E (`app/e2e/drive.mjs`, 24 comprobaciones) con Google y Drive simulados: dos dispositivos, conflicto, aviso de versión más nueva, desconectar, Client ID revocado y renovación con clic. 5 pruebas unitarias nuevas (99 en total).

### Cambiado
- Sin conectar, el botón pasa a «Reintentar» (vuelve a conectar) cuando la aplicación estaba bloqueada.

## [1.3.0] — 2026-10-22

### Agregado
- **Respaldo en Google Drive (opcional).** La copia del taller se sube sola a un archivo de «Mi unidad» con nombre fijo (`torque-<taller>-<id>.json`) y se actualiza siempre el mismo. Se sube un minuto después del último cambio, al salir de la app y al recuperar conexión.
- **Aviso de versión más nueva.** Al abrir la app (y al volver a ella) se compara con Drive consultando solo metadatos. Si hay una copia más nueva se ofrece traerla; si ambos lados cambiaron se ofrece *Combinar*, *Subir la mía* o *Usar la de Drive*. Nunca se sobrescribe sin confirmación y, antes de reemplazar con cambios locales, se descarga una copia de lo local.
- **Renovación del acceso de Google con el siguiente toque.** El acceso dura ~1 h; cuando vence y el navegador bloquea la ventana de renovación automática, la app la renueva con el primer clic o toque del usuario en cualquier parte, o con el aviso «Reconectar».
- Sección **Ajustes → Respaldo en Google Drive** (conectar, estado, sincronizar ahora, desconectar). No aparece si el despliegue no define `VITE_GOOGLE_CLIENT_ID`.
- Documentación: `app/docs/DRIVE.md` (diseño, configuración, límites, solución de problemas).
- 9 pruebas nuevas del servicio con un Drive simulado (94 en total).
- `deploy.yml` pasa `VITE_GOOGLE_CLIENT_ID` (variable de repositorio `GOOGLE_CLIENT_ID`) a la compilación. Sin esa variable la sección de Drive queda oculta.

### Cambiado
- `createBackup` acepta `{ touch: false }` para no registrar «última copia» en las subidas automáticas.
- Las escrituras de datos de negocio avisan a la sincronización (`OrgDB.onChange`); no afecta al resto de la app.

### Limitaciones conocidas
- Sin servidor propio no hay «refresh token»: puede pedirse renovar el acceso cada hora (sobre todo en Safari/iOS, aún sin probar en dispositivos reales).
- *Combinar* solo agrega registros que faltan; no propaga ediciones de registros existentes.
- El archivo en Drive es JSON legible (incluye hash de PIN); el cifrado con contraseña queda para una versión futura.

## [1.2.1] — 2026-10-21
### Agregado
- Página pública de **política de privacidad** (`/privacidad.html`), requisito de Google para publicar la pantalla de consentimiento de OAuth. (PR #1)

## [1.2.0] — 2026-10-20
### Cambiado
- El PDF se genera de verdad en el dispositivo (igual que el recetario): vista previa, descargar y compartir; barra con área segura; sin `target=_blank`.

## [1.1.0] — 2026-10-20
### Agregado
- Guía de uso (`app/docs/GUIA-DE-USO.md`, también dentro de la app).
- PDF con marca.
- Aviso para instalar la app.
### Corregido
- Desbordamiento horizontal en pantallas pequeñas.
- La demostración ya no depende del día ni la hora en que se crea.

## [1.0.1] — 2026-10-20
### Corregido
- Orden de los hooks en la pantalla de bienvenida (error React 310 en producción).

## [1.0.0] — 2026-10-20
### Agregado
- Primera versión: gestión integral de talleres mecánicos (PWA local-first) con órdenes, cotizaciones, clientes y vehículos, agenda, inventario a costo promedio, compras, ventas y cobros, caja, gastos, rentabilidad y reportes, usuarios con roles y permisos, respaldo y restauración manuales, y taller de demostración.
