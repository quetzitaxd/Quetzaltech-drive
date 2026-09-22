# Estado del proyecto

## Base entregada
Scaffold de desarrollo, no aplicación final. Incluye servidor health, inicialización SQLite, pantalla React informativa, contrato de adaptadores, configuración Docker/Capacitor, documentación y prompts.

## Etapas
| Etapa | Estado |
|---|---|
| 01 verificar base | Completada el 2026-09-22 |
| 02 acceso/productos | Completada el 2026-09-22 |
| 03 archivos/subidas | Completada el 2026-09-22 |
| 04 medios/descargas | Completada el 2026-09-22 |
| 05 interfaz | Completada el 2026-09-22 |
| 06 integración web | Completada con limitación de video real el 2026-09-22 |
| 07 Android | En progreso; falta aceptación en dispositivo y firma release |
| 08 despliegue | App desplegada y saludable; HTTPS/Proxy Host pendiente |

## Evidencia al empaquetar
Ver docs/VERIFICATION.md.

## Etapa 08 — app desplegada; publicación HTTPS habilitada
- `scripts/backup-vps.sh` detiene/reinicia solo `app` del Compose de este proyecto, respalda `data/`, `.env` y Compose en `/srv/backups/quetzaltech-drive`, con checksum y permisos restrictivos; no borra copias ni datos.
- `scripts/restore-vps.sh` acepta solo backups de esa carpeta, valida miembros/enlaces, restaura únicamente en `/srv/quetzaltech-drive-restore.*` y prueba la copia con la imagen del proyecto sin red. `scripts/verify-restore.mjs` verifica SQLite/FKs, rutas, tamaños y SHA-256 de originales, arranca app por loopback y confirma rutas privadas cerradas.
- `scripts/restore.test.mjs` crea una base/archivo fixture, copia a ubicación aislada, prueba arranque HTTP y comprueba que bytes alterados fallen por hash. `Dockerfile` incluye el verificador; `README.md` y `docs/OPERATIONS.md` describen instalación, contraseña, pairing, actualización, rollback y keystore.
- `npm run verify`: aprobado; typecheck, 23 pruebas de servidor, build web/servidor, prueba HTTP compilada y prueba aislada de restauración. Sintaxis Bash revisada con Git Bash.
- VPS preflight: Debian, Docker 29.5.2/Compose 5.1.4, red externa `proxy`, 59 GB libres, 11 GiB RAM con 2.2 GiB disponibles. La ruta y el nombre de contenedor estaban libres. SSH funciona con usuario `debian` (minúsculas); ninguna clave se modificó o borró.
- Desplegado en `/srv/quetzaltech-drive`; `.env` producción modo 600, sin contraseña ni secretos, con URL pública prevista y origen Android. Imagen `quetzaltech-drive-app`, servicio `quetzaltech-drive`: health healthy; `/api/health` 200, `/api/products` 401, `/data` 404; Docker confirma `80/tcp` sin puertos host. Force-recreate mantuvo el volumen y el servicio saludable.
- Backup real creado en `/srv/backups/quetzaltech-drive` con SHA-256. Restore real validado sin red en `/srv/quetzaltech-drive-restore.CA1iGu`; SQLite íntegro, 0 assets (sin datos previos) y API arrancó aisladamente. La copia de ensayo se conserva.
- El usuario guardó el Proxy Host de `drive.quetzaltech.shop` hacia `http://quetzaltech-drive:80` en NPM; el panel lo mostraba Online con Let's Encrypt. Se valida respuesta HTTPS por separado antes de marcar publicación terminada. Solo se añadió este host de Drive.
- A petición del usuario, el mínimo de contraseña de cuenta personal se cambió de 12 a 8 caracteres; la clave elegida es numérica. `server/src/auth/password.ts`, `server/src/auth/setup.ts`, `server/test/access-products.test.ts`, `SPEC.md` y `docs/API.md` reflejan el nuevo mínimo. Advertencia: es fácil de adivinar.

## Después de cerrar HTTPS — GitHub
- El usuario pidió conectar el checkout local y la copia de producción con `https://github.com/quetzitaxd/Quetzaltech-drive.git` después de completar el despliegue.
- Estado previo: `origin` local ya apunta a esa URL, rama `main`, sin commits; los 135 archivos del proyecto están aún sin seguimiento estándar. Antes del primer push verificar exclusiones de `.env`, `data/`, APKs y firmas; luego publicar el commit y dejar `/srv/quetzaltech-drive` en ese mismo commit sin incluir configuración ni datos locales.
- Aún no se ha hecho push, commit ni cambio de Git en producción.

## Próximo paso
Validar HTTPS, desplegar el cambio de mínimo y configurar la cuenta; luego sincronizar local y producción con GitHub como se solicitó. Android sigue pendiente de aceptación en dispositivo y keystore release persistente antes de declarar la etapa 07 completada.

## Etapa 07 — implementación en curso; criterios aún no cerrados
- Plataforma Capacitor 8.5.2 fijada y generada en `android/`; JDK integrado de Android Studio, SDK API 36 y Gradle 8.14.3. Sin `server.url`; la compilación Android recibe `VITE_API_BASE_URL=https://drive.quetzaltech.shop` y el servidor debe permitir el origen exacto `https://localhost` en `ANDROID_ORIGINS`.
- `NativeDrivePlugin.kt` usa Android SAF para varias URIs `content://`, permisos persistentes cuando el proveedor los permite, SHA-256 y multipart streaming nativos con progreso/cancelación; el token queda cifrado con AES-GCM y clave Android Keystore. Añadidos desvincular con revocación remota, keepScreenOn solo durante transferencias, DownloadManager y FileProvider para compartir. La app conserva la cola y la misma clave lógica tras interrupción; permite volver a seleccionar la URI.
- Cliente web/native integrado en `web/src/adapters/`, pairing por código temporal, Bearer sin cookies, tickets privados y renovación del ticket en error del visor. `docs/API.md` documenta `POST /api/devices/unpair`; `docs/ANDROID.md` describe configuración y builds.
- `npm run verify`: aprobado el 2026-09-22; typecheck, 23 pruebas, build web/servidor y prueba HTTP compilada. `npm run android:sync` y `android/gradlew.bat assembleDebug` aprobados con el JDK Android Studio.
- APK de depuración (no release): `android/app/build/outputs/apk/debug/app-debug.apk`, SHA-256 `7B4BF82955D19C46547F1C9926AB4C71DD046623928BEFE3CA39CA7B626F293A`. No se copió a Git ni se presenta como APK release.
- Pendiente obligatorio: no hay emulador Android instalado ni se pudo acceder a ADB/dispositivo en este host; por ello no se probaron flujos de usuario en hardware. No hay keystore de release ni firma persistente configurada. No declarar etapa 07 completada ni avanzar a APK release hasta cubrir ambas condiciones.

## Etapa 05 — resultado
- `web/src/App.tsx`, `web/src/lib/api.ts`, `web/src/adapters/web.ts` y `web/src/styles.css`: login con sesión/CSRF, catálogo buscable y paginado, detalle de producto, portada/contador, cola XHR de dos tareas con progreso/cancelación/reintento idempotente, visor con tickets, selección y acciones de archivos, ZIP y ajustes de pairing/revocación.
- Adaptador web respeta `PlatformAdapter`; no afirma garantía de pantalla activa. La cola permanece en memoria mientras se renueva la sesión, con mensajes claros si la sesión expira.
- `npm run verify`: aprobado el 2026-09-22: typecheck web/servidor, 22 pruebas, builds y prueba HTTP del servidor compilado. El primer intento aislado de Vite recibió acceso denegado al cargar su configuración; el verify completo pasó con ejecución aprobada fuera del aislamiento.
- Navegador integrado: flujo autenticado validado con servidor/API temporal y archivos PNG reales a 1280 px y 390 px: crear/abrir productos, subir dos archivos con XHR y confirmar finalización, visor con ticket, portada, renombre, orden, selección/movimiento, pairing/revocación y reingreso conservando la cola. No se tocó la cuenta real.
- La revisión encontró y corrigió que el nombre renombrado no se mostraba: tarjetas y visor usan ahora `assignedName` del servidor. El smoke test y sus archivos se eliminaron después de comprobar los datos aislados.
- `npm run verify`: aprobado el 2026-09-22 tras los cambios finales: typecheck, 22 pruebas, builds y prueba HTTP del servidor compilado. El primer intento aislado de Vite recibió acceso denegado al cargar configuración; el verify completo pasó con ejecución aprobada fuera del aislamiento.
- Límite: el video no se validó con un archivo real en navegador; fallback y estados se apoyan en el contrato de medios y las pruebas backend de la etapa 04. No se probó despliegue.

## Etapa 06 — integración web y contrato Android
- `server/test/workflow.test.ts` añade un recorrido HTTP real con cuenta/SQLite temporales: nombres duplicados con IDs aislados; dos subidas del mismo producto; error de disco y reintento con la misma clave; corte de red durante una subida grande y reintento idempotente; orden/movimiento; acceso privado a medios y ZIP; ZIP inspeccionado byte por byte; expiración y reingreso con datos persistentes.
- Cobertura previa complementaria: pairing/revocación y tickets; migración/arranque con carga interrumpida, operación preparada y trabajo de derivada `running`; pruebas HTTP del servidor compilado. Revisión del navegador web de etapa 05 cubrió escritorio y 390 px móvil y el flujo autenticado con archivos temporales; no se guardaron medios de prueba en Git.
- `docs/API.md` congela para etapa 07 el formato de Bearer/pairing, hashing y claves de reintento, tickets, paginación, errores y semántica de `originalName`/`assignedName`.
- `npm test -w server`: 23 pruebas aprobadas, incluidas las nuevas aserciones de recuperación e aislamiento. `npm run verify`: aprobado el 2026-09-22: typecheck, 23 pruebas, builds y prueba HTTP compilada.
- Limitación reproducible: este host no ofrece `ffmpeg`/`ffprobe` y el repositorio no contiene un clip de prueba; no se ejecutó un lote con video real ni su reproducción web. Fallback `download_only`, error de FFmpeg y preservación del original se verifican en pruebas de etapa 04. No se probó APK, SDK/dispositivo, Docker, proxy ni VPS.

## Etapa 04 — resultado
- `server/src/jobs/`: trabajador único SQLite con recuperación de running, tres intentos, miniaturas Sharp y fotogramas FFmpeg con spawn sin shell y timeout; fallos de derivadas no invalidan originales. FFprobe marca `playbackStatus` playable/download_only según códecs confirmados.
- `server/src/media/`: GET/HEAD privados de original, miniatura y descarga; Range 206/416, streaming por descriptor y Content-Disposition seguro. Tickets temporales por archivo/alcance ligados a sesión o dispositivo activo; expiración, logout y revocación cortan acceso nuevo.
- ZIP por producto en streaming: valida originales antes de responder, nombres saneados y cancelación de streams si el cliente se desconecta. Borrado de asset retira miniatura y tickets en cascada, incluso tras reinicio.
- `004_media.sql`, `docs/API.md`, `docs/DATA.md`, `docs/MODULES.md` y `SPEC.md` registran esquema, formatos y fallback; dependencias yazl (runtime) y yauzl (solo pruebas), lockfile actualizado.
- `npm run verify` aprobado: typecheck, 22 pruebas de integración, builds y prueba HTTP del servidor compilado. Incluye original intacto por SHA-256, recuperación de jobs, HEAD/Range, tickets expirados/revocados, ZIP leído y archivos faltantes. `npm audit --omit=dev`: 0 alertas.
- FFmpeg/FFprobe no estaban instalados en este Windows: su error y fallback download_only se probaron; generación de portada y clasificación de video real esperan prueba en entorno con FFmpeg. HEIC real, Docker/VPS, navegador y Android no se probaron.

## Etapa 03 — resultado
- `server/src/assets/` implementa multipart streaming de una parte, límite por ruta, detección por contenido, SHA-256+tamaño verificados, nombres saneados, temporales en data y códigos 413/415/507/interrupción sin exponer paths.
- Idempotencia persistente: reserva transaccional de secuencia/UUID, concurrencia 409, replay del asset confirmado, retry de failed y 410 tras borrado. Los originales se crean sin sobrescritura mediante enlace exclusivo en el mismo volumen.
- `003_assets.sql` amplía el journal y agrega operaciones recuperables. El arranque completa el corte entre archivo final/SQLite, limpia temporales interrumpidos y termina renombres, movimientos o borrados preparados.
- Listado paginado, renombre físico, orden exacto, movimiento entre productos, borrado individual/lote y portadas coherentes están autorizados. Contenido, miniaturas, tickets, Range y ZIP continúan cerrados hasta etapa 04.
- Pruebas: 17 aprobadas; cubren dos uploads concurrentes, replay/conflicto, segundo archivo, traversal, >16 KiB, límite, hash/tipo, ENOSPC/EPIPE, recuperación, hash idéntico tras operaciones, tombstone y reinicio de journal.
- `npm run verify`: aprobado (typecheck, 17 pruebas, builds y servidor compilado por HTTP). `npm audit --omit=dev`: 0 alertas. Dependencias nuevas: @fastify/multipart y file-type; lockfile actualizado.
- No se probaron archivos grandes reales, desconexión de red externa, disco físico lleno, proxy/VPS ni Android; ENOSPC/interrupción se verificaron con streams que devuelven esos errores.

## Etapa 02 — resultado
- Acceso real en `server/src/auth/`: alta/cambio interactivo sin eco (`npm run account:setup`), hash scrypt con sal, sesiones opacas y CSRF hasheados, expiración/logout, cookie HttpOnly/SameSite=Strict/Secure en producción y orígenes exactos.
- Vinculación: código temporal de un uso, consumo transaccional, token aleatorio emitido una vez y almacenado como hash, listado web sin tokens y revocación persistente. Límites de login/pairing persisten en SQLite y no confían en X-Forwarded-For.
- Productos en `server/src/products/`: crear, listar/buscar/paginar, consultar, editar y eliminar vacíos con confirmación; IDs y storage_key estables, nombres iguales permitidos, portada validada por pertenencia. Borrado con assets/intentos devuelve 409 hasta el flujo recuperable.
- Esquema: `002_access.sql`; contrato y datos actualizados en `docs/API.md`, `docs/DATA.md` y `docs/MODULES.md`. Archivos/medios continúan cerrados con 503.
- Pruebas: 9 casos de integración cubren login bueno/malo, falta de configuración, cambio de contraseña, expiración/reinicio/logout, CSRF, cookie/CORS, pairing concurrente/consumido/expirado, revocación, rate limit y CRUD/persistencia/búsqueda de productos.
- `npm run verify`: aprobado (typecheck web/backend, 9 pruebas, builds y servidor compilado por HTTP). `npm audit --omit=dev`: 0 alertas. El runner compila tests a `.test-dist` para evitar el fallo de tsx dentro del aislamiento de Windows.
- No se creó una contraseña real ni se probó navegador, VPS, proxy o Android. PUBLIC_URL debe ser HTTPS en producción; ANDROID_ORIGINS permanece vacío hasta etapa 07.

## Etapa 01 — resultado
- Windows, Node 24.19.0, npm 11.17.0. `npm ci` con lockfile actualizado y `npm run verify` aprobados: typecheck, prueba de migraciones/API, build web/backend y prueba del servidor compilado por HTTP real en loopback.
- HTTP: web y bundle 200, health 200, rutas funcionales pendientes 503; datos, .env y SQL no accesibles (404). `scripts/compiled.test.mjs` forma parte de verify.
- Cambios: cierre explícito de `/data` en `server/src/app.ts`; `web/vite.config.ts` carga .env raíz; `.env.example` documenta URL pública y evita NODE_ENV=development al compilar; `.dockerignore` excluye variantes .env y AAB.
- Se comprobó un build con URL temporal del .env raíz, presente en el bundle; configuración restaurada y build final limpio. `android/README.md` documenta build → web/dist → cap sync; no se ejecutó Capacitor ni se generó APK.
- `docs/MODULES.md` define auth/products/assets/jobs/media y ajustes de esquema futuros; se conserva 001, sin implementación simulada. `docs/API.md` aclara qué endpoints serán públicos.
- Dependencias: @fastify/static 10.1.4 y sharp 0.35.4 corrigen alertas altas, conservando Fastify 5 y Node 24; package-lock actualizado. `npm audit --omit=dev`: 0 alertas. Auditoría completa: 3 moderadas en @capacitor/cli → xcode → uuid; `npm audit fix` no las resuelve, revisar en etapa 07 antes de distribuir herramientas/APK.
- `git ls-remote` confirmó remoto sin referencias; Git local iniciado en main, origin vinculado al repositorio indicado. Sin commit ni push. Se verificó exclusión de .env, data, dependencias, dist y APK.
- Limitaciones del entorno resueltas: instalación inicial sin red y tsx con error uv_os_get_passwd dentro del aislamiento; instalación y verify aprobados al ejecutar fuera del aislamiento. Docker/VPS/TLS, revisión visual y Android no probados.
- MANIFEST.sha256 corresponde al ZIP original; no es un manifiesto actualizado de estos cambios.

## Formato de actualización
Por etapa: estado; archivos relevantes; comandos y resultado; pruebas manuales con entorno; pendientes/bloqueos; siguiente prompt. Mantén resumen breve, no diario de cada comando.
