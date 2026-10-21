# Despliegue, respaldos e integraciones

## Despliegue
1. Sube el repositorio a GitHub; en Settings → Pages elige «GitHub Actions». El workflow `.github/workflows/deploy.yml` compila con `BASE_PATH=/<repo>/` y publica `app/dist`. Alternativa: cualquier hosting estático HTTPS (Cloudflare Pages, Netlify) apuntando a `app/dist` (`npm run build`).
2. No hay variables de entorno ni secretos requeridos (`app/.env.example` documenta las opcionales). **No se ha desplegado**: no hay URL pública todavía.
3. Cada publicación nueva se aplica sola en los dispositivos al volver a primer plano.

## Respaldo y recuperación
Los datos viven en IndexedDB del dispositivo. En Ajustes → «Copia de seguridad» descarga el JSON (`torque-backup`, `schemaVersion`) con todo el taller, incluidos los hash de PIN (guárdalo seguro). Restaurar valida estructura, versión (las más nuevas se rechazan; hay tabla de migraciones), ids duplicados, referencias y que la copia sea del mismo taller; permite **combinar** (conserva lo local) o **reemplazar** (con confirmación); es atómico. Para cambiar de dispositivo: en la pantalla de bienvenida usa «Restaurar taller desde una copia de seguridad»; recrea el taller con sus usuarios y PIN. En Ajustes solo se restaura una copia del mismo taller.

## Integraciones (todas pendientes; ninguna simulada)
- **CFDI**: requiere un PAC, certificados y datos fiscales; debe implementarse como módulo independiente. La app solo emite comprobantes de control interno y lo indica en cada documento.
- **WhatsApp/SMS/correo**: la app solo ofrece enlaces `tel:`, `wa.me` y `mailto:` manuales; los envíos automáticos exigen integración configurada y consentimiento.
- **Bancos, proveedores, asistente de IA**: no implementados. Diseño previsto para el asistente: un servicio con herramientas de solo lectura sobre las funciones de dominio (`finance.ts`, `reports.ts`) con los permisos del usuario, que cite periodo, filtros y metodología y nunca invente cifras.
