# Pruebas de aceptación por etapa
01: npm ci; typecheck; health; migración repetible; /data inaccesible; build; web compilada servida por backend.
02: login bueno/malo; expiración/logout; CSRF; vínculo consumido/expirado; revocación; productos duplicados por nombre con IDs distintos; nombre vacío rechazado.
03: dos uploads simultáneos; nombres sin colisión; cancelación; límite; ruta maliciosa; doble respuesta/reintento; reinicio entre filesystem/DB; disco lleno controlado; no productos cruzados.
04: derivadas preservan original; jobs recuperados; formatos no soportados; Range 206/416; ticket expirado; ZIP válido sin fuga; mover/borrar/portada coherentes.
05–06: móvil/escritorio; lote de un producto, agregar después; 2 concurrentes, progreso, reintento/cancelar; sesión expirada; seleccionar/mover/descargar; zoom/video; teclado y estados vacíos.
07: dispositivo/emulador real indicado; vincular, cerrar/abrir, revocar; selección content://, video grande sin base64; red caída; pantalla encendida y liberada; back button; descarga/compartir; HTTPS y tickets renovados.
08: build Docker, persistencia al recrear, backup/restore en carpeta aislada, proxy HTTPS y tamaño, despliegue sin afectar otros servicios, prueba end-to-end. Distinguir local y VPS.

Registra comandos y resultados en STATUS.md. Si no hay dispositivo/SDK/SSH, marca NO EJECUTADO, nunca aprobado por inferencia.
