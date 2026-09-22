# 06 — Integración y validación antes de Android

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `docs/TEST-PLAN.md`
- `docs/API.md`
- `STATUS.md`

## Trabajo requerido
1. Recorre todos los criterios web/backend de etapas 02–05. Añade pruebas end-to-end de flujos críticos con herramientas apropiadas, sin suites redundantes.
2. Prueba lote mixto, fallos parciales, agregar archivos al mismo producto, dos productos con nombre igual, cancelación, reintento idempotente, expiración de sesión, mover y ZIP.
3. Prueba reinicio durante carga/derivada y consistencia posterior, aislamiento de datos, acceso directo a medios sin auth rechazado.
4. Comprueba navegador real si disponible, tanto móvil como escritorio; captura evidencia y corrige errores observados. No declares revisión visual sin abrir la interfaz.
5. Documenta limitaciones confirmadas y congela contrato que consumirá Android.

## Criterios de aceptación
- [ ] Flujos críticos y recuperación aprobados o bloqueos reproducibles explícitos.
- [ ] No pasar a APK si hay pérdida de datos o acceso abierto sin resolver.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
