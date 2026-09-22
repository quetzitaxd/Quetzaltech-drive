# 08 — Docker, operación y entrega

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `deploy/Vps-reference.md`
- `deploy/nginx-proxy-manager.conf.example`
- `docs/OPERATIONS.md`

## Trabajo requerido
1. Ignora el stack prescriptivo del archivo VPS. Completa Docker/Compose del proyecto existente: red proxy externa, sin puertos host, data persistente, recursos limitados, healthcheck. Revisa dependencias nativas y runtime FFmpeg.
2. Prepara .env.example final y preflight de disco/RAM, DNS/proxy y colisiones. No incluyas secretos. Valida Docker localmente si disponible.
3. Implementa backup consistente y restauración aislada; ensaya con fixture. README con instalación, contraseña, pairing, actualizar, rollback y keystore.
4. Con acceso y autorización aplicables despliega /srv/quetzaltech-drive; configura solo su Proxy Host propuesto drive.quetzaltech.shop a http://quetzaltech-drive:80. TLS en NPM, tamaños coherentes, no caché pública. No modifiques otros servicios ni DNS sin autorización.
5. Valida HTTPS, auth, video/Range, ZIP, subida tamaño real y persistencia al recrear. Si no tienes SSH/DNS/SDK, deja pendientes y comandos exactos en lugar de afirmar despliegue.
6. Entrega reporte final con URL real si existe, APK firmada si existe, rutas de datos/backup, pruebas ejecutadas y limitaciones.

## Criterios de aceptación
- [ ] Build y operación reproducibles, restore probado en aislamiento, datos persisten y medios requieren acceso.
- [ ] STATUS distingue local/Android/VPS y refleja todos los pendientes reales.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
