# 04 — Miniaturas, visor backend y descargas

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `docs/API.md`
- `docs/DATA.md`

## Trabajo requerido
1. Implementa cola SQLite de derivadas, un worker, jobs recuperados al reiniciar y reintentos limitados. Sharp para fotos; FFmpeg con spawn y timeout para portadas. No transcodifiques videos enteros.
2. Sirve originales y miniaturas mediante autorización, no estático abierto. Implementa GET/HEAD y Range con 206/416, validación de rangos y streaming.
3. Tickets temporales por recurso/operación para visor Android: revocación efectiva según diseño y renovación antes de nuevas solicitudes Range. Nunca uses token duradero en URL ni lo registres.
4. Descarga original con Content-Disposition saneado; ZIP por producto streaming, sin precargar en RAM. Define respuesta si faltan archivos y cancelación al desconectar cliente.
5. Comprueba fallback de formatos sin miniatura/codec, sin romper original. Explica soporte HEIC real.

## Criterios de aceptación
- [ ] Hash de original intacto, jobs recuperados, ticket expirado bloqueado, Range correcto y ZIP verificable.
- [ ] Uso de memoria acotado; fallos de derivadas visibles sin fallar subida completada.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
