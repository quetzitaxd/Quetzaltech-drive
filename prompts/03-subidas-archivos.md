# 03 — Subidas y almacenamiento recuperable

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `docs/API.md`
- `docs/DATA.md`

## Trabajo requerido
1. Implementa multipart streaming un archivo por petición; tamaño configurable, tipos permitidos y nombres saneados. Usa temporales en el mismo volumen. Maneja desconexión, límite, ENOSPC y limpieza.
2. Reserva secuencia en transacción corta y conserva nombres originales. No sobrescribas. Asigna clave idempotente por archivo; coordina intentos simultáneos y conserva resultado completo ante pérdida de respuesta.
3. Define fingerprint verificable y semántica de conflictos 409; archivos borrados no reaparecen por reintento. Permite reiniciar intentos fallidos sin duplicar.
4. Diseña recuperación de cortes entre rename y commit; incluye journal/migración si hace falta. No mantengas transacciones durante transferencia. Solo devuelve éxito con original final y metadatos confirmados.
5. Implementa listar, renombrar, ordenar, mover físicamente entre productos y eliminar con recuperación y portadas coherentes. Autoriza todos los accesos.

## Criterios de aceptación
- [ ] Pruebas de dos uploads concurrentes, duplicación, cancelación, traversal, límite, fallo disco y reinicio.
- [ ] Originales idénticos por hash antes/después; sin sobrescrituras ni archivos incompletos visibles.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
