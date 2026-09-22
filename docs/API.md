# Contrato objetivo v0 — implementar por etapas
Solo GET /api/health, POST /api/auth/login y POST /api/devices/pair son públicos (los dos últimos con límites persistentes de intentos). Generar códigos de vinculación exige sesión web autenticada y CSRF; consultar sesión, cerrar sesión y administrar dispositivos exige una sesión web. Productos, metadatos de archivos y medios aceptan sesión web o token de dispositivo; GET/HEAD de medios aceptan además ticket temporal limitado. Las rutas de la tabla están implementadas.
JSON de error: {error:{code,message}}. No incluir rutas internas ni secretos. Fechas UTC ISO8601. IDs opacos. Paginación page>=1, pageSize 1..100; respuesta {items,total,page,pageSize}.

| Método y ruta | Entrada / resultado |
|---|---|
| GET /api/health | {status,phase}; no detalles sensibles |
| POST /api/auth/login | **Implementado.** {password} → cookie sesión + {csrfToken} |
| GET /api/auth/session | **Implementado.** {authenticated,csrfToken} con sesión web válida |
| POST /api/auth/logout | **Implementado.** revoca sesión, borra cookie; CSRF |
| POST /api/devices/pairing | **Implementado.** sesión web + CSRF → {code,expiresAt}; código temporal, un uso |
| POST /api/devices/pair | **Implementado.** {code,name} → {deviceId,token}; rate limit |
| GET /api/devices | **Implementado.** sesión web; lista sin tokens |
| DELETE /api/devices/:id | **Implementado.** sesión web + CSRF; revocar token |
| POST /api/devices/unpair | **Implementado.** Bearer actual revoca únicamente el dispositivo que lo presenta; responde 204 |
| GET /api/products | **Implementado.** q,page,pageSize → página productos |
| GET /api/products/:id | **Implementado.** detalle de producto |
| POST /api/products | **Implementado.** {name,code?} → producto |
| PATCH /api/products/:id | **Implementado.** {name?,code?,coverAssetId?} |
| DELETE /api/products/:id | **Implementado para productos vacíos.** body {confirm:id}; con archivos/intentos devuelve 409 hasta implementar borrado recuperable |
| GET /api/products/:id/assets | **Implementado.** page,pageSize → página de archivos ordenados |
| POST /api/products/:id/assets | **Implementado.** multipart con un archivo y cabeceras de identidad; → metadatos del asset |
| PATCH /api/assets/:id | **Implementado.** {name}; renombra metadato y archivo, conserva extensión |
| POST /api/assets/move | **Implementado.** {assetIds,targetProductId}; operación recuperable |
| POST /api/products/:id/order | **Implementado.** {assetIds}; exige el conjunto exacto del producto |
| DELETE /api/assets/:id | **Implementado.** elimina de forma recuperable y repara portada |
| POST /api/assets/batch-delete | **Implementado.** {assetIds}; devuelve deletedIds/pendingIds y error explícito si queda trabajo pendiente |
| GET/HEAD /api/assets/:id/content | **Implementado.** original; sesión, Bearer o ticket de contenido; Range |
| GET/HEAD /api/assets/:id/thumbnail | **Implementado.** miniatura; sesión, Bearer o ticket de miniatura; Range |
| GET/HEAD /api/assets/:id/download | **Implementado.** original como attachment; sesión, Bearer o ticket de descarga; Range |
| POST /api/assets/:id/ticket | **Implementado.** {scope: content/thumbnail/download} → {url,expiresAt}; token duradero nunca en URL |
| GET /api/products/:id/download.zip | **Implementado.** ZIP en streaming con autorización; 409 si falta un archivo antes de responder |

Cookie auth: CSRF en escrituras. Bearer nativo: validar token y revocación. CORS solo orígenes conocidos. Tickets distinguen recurso/operación, TTL limitado y sin acceso por traversal.
La cookie es `qtd_session` en desarrollo y `__Host-qtd_session` en producción; HttpOnly, SameSite=Strict, Path=/ y Secure en producción. Sesión y CSRF se guardan como SHA-256, nunca en claro. `npm run account:setup` solicita dos veces una contraseña de 8–256 caracteres sin eco, guarda un hash scrypt con sal en SQLite y revoca sesiones, dispositivos y códigos anteriores. No acepta la contraseña en argumentos.

`PUBLIC_URL` define el único origen web. `ANDROID_ORIGINS` es una lista opcional, separada por comas, de orígenes exactos para CORS; no se admiten comodines con credenciales. El servidor no confía en `X-Forwarded-For` hasta configurar explícitamente proxies confiables. Login, consumo y generación de pairing limitan intentos por IP observada y globalmente durante cinco minutos.
POST assets: misma clave y fingerprint completado devuelve mismo assetId; clave con contenido/producto distintos 409; solicitud en curso 409 con código UPLOAD_IN_PROGRESS; fallida permite reintento coordinado. Un idempotency key no debe resucitar un archivo borrado; conservar tombstone o devolver 410.
La subida requiere `Idempotency-Key` (16–128 caracteres `[A-Za-z0-9._:-]`),
`X-File-SHA256` (hexadecimal minúscula) y `X-File-Size`. El fingerprint es
producto+tamaño+SHA-256; el servidor vuelve a calcular tamaño y hash mientras escribe
el multipart a disco. Se admite exactamente una parte de archivo y ninguna parte de
formulario. Formatos detectados por contenido: JPEG, PNG, WebP, GIF, AVIF, HEIC/HEIF,
MP4, QuickTime y WebM. No se confía en extensión ni Content-Type del cliente.

Una repetición completada puede responder 200 sin retransmitir el contenido; una
creación responde 201. Un intento interrumpido queda `failed` y la misma clave/huella
puede reiniciarlo desde cero. Tras eliminar el resultado devuelve 410. El límite de
la ruta multipart es `MAX_FILE_BYTES` más margen de encapsulado; el límite JSON global
permanece pequeño. ENOSPC/EDQUOT devuelve 507 y una interrupción devuelve 400.
Status: 400 validación, 401 acceso, 403 permiso/CSRF, 404 inexistente, 409 conflicto, 413 tamaño, 415 formato, 429 límite, 507 disco. HTTP Range: 206 válido, 416 inválido, Content-Range y Accept-Ranges.
Los tickets duran cinco minutos, se guardan como hash y quedan vinculados a una sesión o
dispositivo activo. Logout, expiración o revocación los invalidan; para otra solicitud
Range se emite uno nuevo antes de caducar. Respuestas de medios usan `Cache-Control:
private, no-store`, `Referrer-Policy: no-referrer` y no incluyen secretos en logs.
`thumbnailStatus` puede ser pending/ready/unsupported/failed. `playbackStatus` es
pending/playable/download_only para video; los demás usan not_applicable. La interfaz
debe ofrecer descarga si no hay miniatura o el estado es download_only.

## Contrato móvil congelado para etapa 07

- El cliente guarda un `base URL` HTTPS configurado. El pairing (`POST /api/devices/pair`)
  emite `deviceId` y un token opaco una sola vez; enviar el token en `Authorization: Bearer`
  y guardarlo solo en almacenamiento seguro del dispositivo. El token no se incluye en URLs.
- El token Bearer autoriza catálogo, productos, subidas, operaciones de archivos, medios y ZIP;
  administración de dispositivos y sesión permanecen exclusivas de cookie web. CSRF aplica a
  escrituras web con cookie; el cliente nativo usa Bearer.
- Una petición de subida contiene un único archivo multipart. Antes de enviar, declarar el
  tamaño y SHA-256 del archivo completo en `X-File-Size` y `X-File-SHA256`, y enviar una clave
  estable por intento lógico en `Idempotency-Key`. Tras corte o timeout, reintentar los mismos
  bytes con la misma clave; `200` representa replay confirmado, `201` archivo nuevo. No recrear
  claves para reintentos ni volver a subir elementos ya confirmados.
- Para contenido autenticado, solicitar ticket con Bearer y alcance exacto antes de abrir cada
  medio; usar su `url` para solicitudes `GET`/`HEAD` y Range. Renovarlo tras expiración o rechazo.
  El ticket es temporal, no sustituye al token del dispositivo y tampoco debe registrarse.
- Respuestas de listas usan `{items,total,page,pageSize}` (máximo 100); el orden exige el conjunto
  completo de IDs actuales. `originalName` conserva el nombre recibido; `assignedName` es el
  nombre actual en almacenamiento y puede cambiar al renombrar o mover. IDs de asset y producto
  permanecen estables durante esas operaciones.
- Los fallos son respuestas HTTP con `{error:{code,message}}`; una respuesta ausente o una
  interrupción nunca confirma el archivo. Reproducir `download_only` con descarga del original.

Este contrato es la base de integración de etapa 07. No contempla segundo plano, nube, colas
externas ni garantía de pantalla activa del cliente web.
