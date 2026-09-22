# Límites de módulos

Definición para las etapas siguientes; no son implementaciones ni rutas habilitadas.
`server/src/app.ts` compone HTTP, `config.ts` resuelve configuración y `db/` aplica migraciones.

| Módulo previsto en server/src | Responsabilidad | Etapa |
|---|---|---|
| auth/ | Implementado: contraseña personal, sesiones, CSRF, límites de acceso, vinculación y revocación de dispositivos | 02 |
| products/ | Implementado: CRUD, búsqueda, paginación, storage_key estable y pertenencia de portada | 02 |
| assets/ | Implementado: subida streaming, reserva de secuencia, idempotencia y recuperación; listado, renombre, orden, movimiento y eliminación | 03 |
| jobs/ | Implementado: cola SQLite persistente, un trabajador, reintentos y recuperación tras reinicio | 04 |
| media/ | Implementado: originales, miniaturas, tickets por recurso, Range y ZIP autenticados | 04 |

Los módulos usarán la misma conexión SQLite y configuración inyectadas; media y assets
reutilizarán la autorización de auth. Los originales nunca serán un directorio estático.
Hasta implementar cada módulo restante, sus rutas bajo `/api/*` devuelven 503. No hay stubs de éxito.

## Revisión del esquema inicial

Se conserva 001_initial.sql sin modificar. 002_access.sql añade la cuenta personal y
los límites persistentes; `npm run account:setup` aprovisiona el hash en SQLite y
revoca credenciales previas. Products valida la pertenencia de cover_asset_id.
003_assets.sql añade el journal persistente de reservas, destino final, movimientos y
borrados. Los intentos completos borrados conservan tombstone y devuelven 410; asset_id
NULL no autoriza recrearlos. 004_media.sql agrega tickets, playback_status y limpieza
de miniaturas en operaciones de borrado. Toda ampliación usa 002+.
