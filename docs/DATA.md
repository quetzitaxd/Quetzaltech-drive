# Datos e invariantes
SQLite guarda metadatos, jamás blobs de originales. data/originals/<storage_key>/; data/thumbnails/; data/tmp/. Todo pertenece al volumen data.

La cuenta personal vive en `personal_account` como hash scrypt con sal. `sessions`,
`devices` y `pairing_codes` guardan únicamente hashes SHA-256 de secretos aleatorios;
el token de dispositivo se devuelve una sola vez al consumir el código. Los límites
de intentos se conservan en `auth_rate_limits`, por lo que reiniciar no los evita.

001_initial.sql es un punto de partida, ya migrado automáticamente. Agrega 002+ para cambios. products.cover_asset_id exige validación de pertenencia en aplicación. IDs UUID con crypto.randomUUID. storage_key estable, derivado de ID y slug inicial, nunca del texto sin sanitizar. DB usa WAL y foreign_keys.
002_access.sql agrega la cuenta personal, límites persistentes e índices de expiración.
Los productos con el mismo nombre se permiten: su UUID y storage_key son distintos.
Renombrar cambia solo el metadato visible; nunca recalcula storage_key. La portada
solo se acepta si el asset pertenece al producto. El borrado de un producto con
assets u operaciones activas se rechaza. Los intentos fallidos y tombstones se eliminan
en cascada al borrar finalmente el producto, cuyo UUID ya no puede reutilizarse.

003_assets.sql agrega SHA-256 al asset, amplía el journal de intentos y crea
`asset_operations`. Un intento reserva secuencia y UUID en una transacción corta;
la transferencia ocurre sin transacción SQLite. El temporal está en `data/tmp`, se
cierra y valida, y luego se enlaza al destino con creación exclusiva dentro del mismo
volumen. El unlink posterior evita sobrescrituras y nunca expone bytes parciales.

## Escritura de archivo
Antes del enlace se guarda la ruta final en el journal. Si el proceso cae después de
crear el original pero antes del commit, el arranque verifica tamaño+SHA-256 y completa
asset, intento y job en una transacción. Un temporal sin original confirmado se limpia
y el intento pasa a failed. Solo `assets` confirmados aparecen en listados. Las reservas
pueden dejar huecos de numeración; es preferible a colisiones.

## Mover, eliminar y reintentar
Renombrar y mover escriben una operación `prepared`, enlazan sin reemplazar, marcan
`fs_done` y después actualizan SQLite. Eliminar mueve primero a `data/tmp/trash`, marca
el intento como tombstone, repara la portada y elimina metadatos antes de quitar trash.
El arranque termina operaciones pendientes en orden. Los paths persistidos son
relativos, se validan contra `data` y nunca se construyen desde nombres originales.
Un fallo parcial de borrado se reporta y mantiene el journal para recuperación.

## Medios
004_media.sql agrega tickets hasheados por archivo y alcance, playback_status y ruta de
miniatura para limpiar borrados interrumpidos. Solo un trabajador reclama jobs SQLite;
recupera running al iniciar, limita intentos a tres y marca failed al agotarlos. Sharp
crea JPEG a partir de fotos; FFmpeg extrae un fotograma de video con spawn sin shell y
timeout de 30 segundos. FFprobe inspecciona el códec: MP4 H.264/AAC y WebM VP8/VP9/AV1
con Opus/Vorbis pueden reproducirse; QuickTime y códecs no confirmados quedan
download_only. No se transcodifica el video completo.

El original no se altera al derivar. Un fallo marca la vista previa failed o unsupported
sin cambiar el asset confirmado. Sharp/libvips puede abrir algunos HEIC según el build y
el archivo; si la decodificación falla, thumbnail_status=unsupported y se conserva el
original para descarga. En Windows local no se encontró FFmpeg/FFprobe; la imagen Docker
los instala, pero su ejecución en VPS queda para la etapa de despliegue.

Las descargas usan descriptores de archivo y streams acotados. ZIP valida la existencia
y tamaño de todos los originales antes de responder, y luego lee uno por vez. Un cierre
prematuro del cliente destruye los streams abiertos. Los tickets expiran y dependen de
la sesión o dispositivo que los emitió; revocar esa credencial corta solicitudes nuevas.
