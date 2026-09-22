# Operación
Compose vive en `/srv/quetzaltech-drive`, usa la red externa `proxy` y no publica puertos al host. El preflight `bash scripts/check-vps.sh` es de solo lectura. No incorpora claves SSH ni administra DNS.

Backup consistente: `sudo bash scripts/backup-vps.sh` detiene solo el servicio `app` de este proyecto si estaba activo, archiva `data/` (incluidos SQLite/WAL/SHM), `.env` y Compose en `/srv/backups/quetzaltech-drive`, genera SHA-256 y lo reinicia. El backup conserva el `.env` dentro de un archivo modo 600: protege y copia el archivo sin mostrar sus valores. No se borran copias anteriores.

Restore de ensayo: `sudo bash scripts/restore-vps.sh /srv/backups/quetzaltech-drive/ARCHIVO.tar.gz` verifica checksum y contenido, extrae únicamente `data/` a `/srv/quetzaltech-drive-restore.*` y usa una imagen de este proyecto sin red para probar SQLite, hashes de originales, arranque HTTP y cierre de endpoints protegidos en loopback. La carpeta aislada se conserva para inspección y limpieza manual; no sustituye datos activos. Revisar y borrar esa carpeta manualmente después de decidir que ya no se necesita. Nunca usar `down -v`.

Actualización: hacer backup antes de migrar; fijar el commit/tag y conservarlo; ejecutar `docker compose up -d --build app` desde el proyecto. Rollback binario solo es seguro si el esquema actual es compatible; una restauración de datos debe ensayarse primero en otra carpeta y planearse explícitamente. Nunca ejecutar `docker compose down -v`.

Cuenta: `docker compose exec app node scripts/account-setup.mjs` configura/cambia contraseña de forma interactiva. No guardar esa contraseña en variables, scripts ni logs. El pairing Android se genera desde Ajustes de la web autenticada y se consume una vez.

Keystore Android: mantener el archivo y `android/keystore.properties` (si existe) cifrados y respaldados por separado del repo/VPS; no reemplazar la firma de una instalación existente. No se crea ni rota ningún keystore mediante los scripts de operación.

Asignación inicial propuesta: 1 GiB RAM / 1 CPU y 512 MiB archivo, revisar carga real y disco. Miniaturas secuenciales; conservar originales; ZIP streaming. Ajustar proxy solo de este proyecto. Dominio propuesto no confirma DNS configurado.
