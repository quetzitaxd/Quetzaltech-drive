# 05 — Interfaz web completa

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `docs/API.md`
- `web/src/adapters/types.ts`

## Trabajo requerido
1. Sustituye pantalla del scaffold por login, catálogo, producto/visor, cola y ajustes de dispositivos. Interfaz en español azul marino/aqua/blanco, responsive y usable con teclado/táctil.
2. Conecta API real, sin mocks de éxito. Buscador con debounce, paginación, portada y contadores. Estados vacío/carga/error, confirmación de borrado.
3. Crear/abrir un producto y seleccionar lote; drag/drop en escritorio. Cola dos concurrentes con XHR u otro transporte con progreso real, cancelación y reintento solo de fallidos. Conserva claves idempotentes y completados.
4. Implementa visor fotos zoom/navegación, video compatible y fallback descarga; selección múltiple, mover, ordenar, renombrar, portada, descarga y ZIP.
5. Usa adaptador web tras interfaz de plataforma; no simules keepAwake web como garantía. Maneja 401 y renovación de sesión sin perder metadatos de cola. Implementa UI de pairing/revocación.

## Criterios de aceptación
- [ ] Flujo completo con archivos reales y API real en viewport móvil y escritorio.
- [ ] Build/typecheck; ninguna función visible que indique éxito sin haber persistido.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
