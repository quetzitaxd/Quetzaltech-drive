# Especificación canónica

Desarrolla QuetzalTech Drive, proyecto quetzaltech-drive: catálogo privado de fotos y videos de producto en mi VPS, con web y APK Android personal. Implementa las etapas que te indique; no replantees el stack.

STACK: React + Vite + TypeScript + Tailwind; Node.js LTS + Fastify; SQLite con better-sqlite3 y migraciones SQL; disco local para archivos; Sharp para miniaturas y FFmpeg para portadas; Capacitor para Android. Una sola app backend sirve API y web compilada. Docker Compose. Usa versiones estables compatibles y lockfile.

VPS: según Vps.md tiene 11 GB RAM, Docker Compose y Nginx Proxy Manager existente (proxy-app-1) en red externa proxy. Ignora las recomendaciones de stack de ese archivo. Proyecto /srv/quetzaltech-drive; contenedor quetzaltech-drive; puerto interno 80 sin publicar puertos al host; restart unless-stopped. HTTPS mediante el proxy existente, sin Caddy. Dominio previsto configurable: drive.quetzaltech.shop. Verifica recursos y configuración reales antes del despliegue; el espacio libre no se conoce.

DATOS: bind mount ./data:/app/data para SQLite, originales, miniaturas y temporales. Carpetas físicas por producto usando ID estable + slug inicial; renombrar el producto no debe romper sus archivos. Nombre visible y código opcional editables. Guardar nombre original, nombre asignado, tipo, tamaño, orden y ruta relativa por archivo. Nombre asignado tipo blusa-calada-001.jpg; secuencia transaccional sin sobrescribir ni colisionar bajo concurrencia. Originales intactos. Datos, secretos y APK fuera de Git.

FLUJO: varios productos, un producto por lote. Crear/abrir producto, seleccionar múltiples fotos/videos, subir, visualizar y descargar. Dos archivos simultáneos; progreso individual y global; reintento solo de fallidos, desde cero por archivo. Clave idempotente por intento lógico para no duplicar archivos si se pierde la respuesta. Confirmar archivo solo tras escritura completa; limpiar temporales fallidos.

WEB: interfaz en español, responsive, azul marino oscuro con superficies en capas, azul brillante, aqua y blanco. Aplicar el logotipo vectorial QD de QuetzalTech Drive en el acceso y navegación. Buscador por nombre/código, paginación, tarjetas con portada y contador; visor con zoom/navegación y video; seleccionar múltiples, ordenar, renombrar, mover, eliminar con confirmación, descargar originales y ZIP por producto. El nombre de producto es obligatorio; código opcional. No incluir tienda, precios, IA, roles ni sincronización automática.

ACCESO: una cuenta personal. Web con contraseña de 8–256 caracteres hasheada con scrypt y cookie de sesión HttpOnly, Secure en producción; protección de operaciones mutables frente a CSRF. APK vinculada una vez con código temporal de un solo uso generado desde web autenticada; luego token revocable por dispositivo almacenado mediante Android Keystore. Sin contraseña maestra embebida en APK. Proteger originales, miniaturas, ZIP y video; no publicar el directorio data como estático abierto. Autenticación simple, sin OAuth, registro ni emails.

ANDROID: misma interfaz empaquetada localmente con Capacitor y API HTTPS configurable; shop.quetzaltech.drive; QuetzalTech Drive; quetzaltech-drive.apk. Selector de archivos múltiple y transferencias desde URI nativa sin base64 de videos completos. Mantener pantalla encendida durante subidas con app visible y restaurar al terminar/cancelar. No se requiere subir en segundo plano. Si se interrumpe, informar y permitir reintentar fallidos sin duplicar completados. Descarga y compartir mediante mecanismo Android adecuado. Resolver reproducción autenticada en web y APK explícitamente; un elemento video no añade automáticamente cabeceras Bearer.

LÍMITES: tamaño máximo configurable y coherente con proxy; streaming a disco; validación de tipos/rutas, límites de login y errores legibles de disco lleno. Miniaturas en cola persistente sencilla SQLite, un trabajo simultáneo, sin Redis. Fallo de miniatura no invalida el original. Videos compatibles se reproducen; formatos no compatibles ofrecen descarga, sin transcodificación completa inicial. Para imágenes sin soporte de vista previa conservar original y mostrar alternativa explícita.

TRABAJO: guarda estas decisiones en SPEC.md y progreso breve en STATUS.md. Al retomar lee ambos y solo archivos pertinentes. Evita logs enormes, repetir archivos completos, refactorizaciones ajenas y dependencias redundantes. No delegues salvo que se solicite. Implementa código real. Verifica los riesgos relevantes y reporta qué se ejecutó, qué falló y bloqueos reales. No declares pruebas de Android/VPS hechas si no tienes acceso. Fin de etapa: resumen breve, comandos ejecutados y siguiente paso.


## Aclaraciones de esta base

- Node 24; npm workspaces con un lockfile raíz. Vite 7 por compatibilidad conocida. Las versiones exactas quedan en el lockfile generado.
- Puerto interno 80; dev 3000 API y 5173 web.
- Valores de recursos y límite 512 MiB son propuestas configurables, no mediciones de la VPS.
- Salud pública; las rutas funcionales están cerradas hasta implementar autenticación.
- Media tickets de alcance por archivo, expiran y soportan solicitudes Range; tokens de dispositivo nunca en URLs.
- Un archivo se vuelve visible solo después de escritura final completa. Diseñar recuperación entre filesystem y SQLite; no existe transacción atómica compartida entre ambos.
- Continúa usando instrucciones de esta carpeta como fuente de verdad. El documento de VPS original es contexto histórico, no stack prescriptivo.
- Etapa 04: tickets SHA-256 de cinco minutos y alcance exacto, ligados a sesión/dispositivo revocable; HEAD/Range privados. Un trabajador SQLite procesa derivadas con tres intentos. `playbackStatus` permite descarga explícita cuando FFprobe no confirma códec compatible; HEIC sin decodificación conserva original y marca vista previa unsupported. ZIP usa streaming y valida originales antes de empezar.
