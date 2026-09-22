# QuetzalTech Drive
Base para un drive personal de fotos y videos por producto. Web + APK, VPS propia.

Comienza por [START_HERE.md](START_HERE.md). Las decisiones están en [SPEC.md](SPEC.md), el avance en [STATUS.md](STATUS.md) y el orden del agente en [prompts/INDEX.md](prompts/INDEX.md).

## Directorios
- server/src: backend; db: migraciones y conexión; módulos se agregan en su etapa.
- server/migrations: SQL versionado, nunca editar una migración ya desplegada.
- server/test: integración con datos temporales.
- web/src: interfaz, adaptadores de plataforma y cliente API.
- android: instrucciones; plataforma Gradle se genera en etapa 07.
- docs: contrato, datos, validación y operación.
- prompts: instrucciones detalladas por etapa.
- deploy: configuración del proxy y contexto de VPS.
- scripts: comprobaciones auxiliares.
- data: se crea en ejecución, jamás incluir en Git.

## Comandos
`npm ci`, `npm run dev`, `npm run verify`, `npm run build`, `npm start`.
Producción local compilada sirve web y API en puerto 3000 por defecto; Compose usa 80 interno.
Antes del primer acceso ejecuta `npm run account:setup` en una terminal interactiva;
la contraseña se solicita sin eco y solo se guarda su hash en SQLite. Ejecutarlo de
nuevo cambia la contraseña y revoca sesiones, dispositivos y códigos de vinculación.
El mismo comando está incluido en la imagen final y puede ejecutarse con una terminal
interactiva dentro del contenedor; `DATA_DIR` determina qué base se configura.
`npm run android:add`, `npm run android:sync`, `npm run android:open`: etapa 07 únicamente.

## Despliegue previsto
La etapa de despliegue utiliza `/srv/quetzaltech-drive`, la red externa `proxy`, y el host `drive.quetzaltech.shop` hacia `http://quetzaltech-drive:80`. La configuración de Nginx Proxy Manager y DNS queda a cargo del operador; el contenedor no publica puertos al host.

En la VPS, copia el proyecto a `/srv/quetzaltech-drive`, crea `.env` desde `.env.example` y establece `PUBLIC_URL=https://drive.quetzaltech.shop` y `ANDROID_ORIGINS=https://localhost`. Mantén el archivo `.env` fuera de Git. Ejecuta `bash scripts/check-vps.sh` antes de instalar; confirma disco, red `proxy`, Docker y ausencia de colisiones. Construye con `docker compose up -d --build app`; revisa `docker compose ps` y `/api/health` desde el proxy.

Antes de actualizar: `sudo bash scripts/backup-vps.sh`. Ensaya una restauración con `sudo bash scripts/restore-vps.sh /srv/backups/quetzaltech-drive/ARCHIVO.tar.gz`; deja una copia aislada para inspección y no reemplaza `data/`. Para instalar/cambiar la contraseña: `docker compose exec app node scripts/account-setup.mjs` en una terminal interactiva. Empareja Android desde Ajustes en una sesión web autenticada.

Rollback: conserva el commit/tag anterior y reconstruye ese código solo si es compatible con el esquema de base vigente. Nunca borres el volumen bind `data/` ni ejecutes `docker compose down -v`. Keystore de Android y su archivo de propiedades deben mantenerse cifrados y respaldados aparte; no se distribuyen con el proyecto.
