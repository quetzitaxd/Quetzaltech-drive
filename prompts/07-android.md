# 07 — APK personal y adaptadores nativos

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `docs/API.md`
- `android/README.md`
- `web/src/adapters/types.ts`

## Trabajo requerido
1. Mueve README de android a docs/ANDROID.md y elimina carpeta vacía antes de cap add. Genera plataforma real con Capacitor fijado; verifica JDK/SDK compatibles. No configures server.url remoto en release.
2. Usa VITE_API_BASE_URL HTTPS configurable, orígenes exactos y transporte nativo para selección múltiple y upload content:// con progreso. No serialices videos completos en base64/JS. Plugin mantenido compatible o puente Kotlin mínimo.
3. Vincula mediante código web, guarda token con Android Keystore usando almacenamiento cifrado apropiado; restaura acceso al abrir. Implementa desvincular/revocar, sin password maestra embebida.
4. Mantén pantalla encendida solo al subir y visible; libera al terminar/cancelar/error. Guarda cola/metadatos y permisos URI cuando sea posible; reselección si se pierden. No prometas continuidad en background.
5. Implementa visor con tickets y renovación, Range; descargas y compartir vía APIs Android, progreso y cancelación reales.
6. Compila release firmada con keystore persistente fuera de Git y entrega quetzaltech-drive.apk. Documenta build y actualización. Nunca inventes firma o build si faltan herramientas.

## Criterios de aceptación
- [ ] Prueba real en emulador/dispositivo identificado: pairing, cierre/reapertura, upload mixto, red caída, keepAwake, visor, descargar/compartir.
- [ ] APK y hash si compilada; de lo contrario bloqueo exacto y comandos reproducibles.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
