# 01 — Verificar y fijar la base

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `START_HERE.md`
- `SPEC.md`
- `docs/API.md`
- `docs/DATA.md`

## Trabajo requerido
1. Inspecciona scripts, paquetes, configuración y STATUS.md; conserva el scaffold existente. Usa Node 24 y npm ci; si cambia una dependencia justifica el cambio y actualiza lockfile.
2. Ejecuta npm run verify y prueba servidor compilado con web y health. Comprueba que ninguna ruta data sea pública.
3. Revisa contrato y esquema frente al alcance; documenta ajustes mínimos como migración nueva cuando corresponda. Confirma cómo se propaga VITE_API_BASE_URL a APK.
4. Define módulos para auth, products, assets, jobs y media sin crear implementaciones falsas. Mantén rutas aún no desarrolladas cerradas.

## Criterios de aceptación
- [ ] Instalación reproducible, typecheck, pruebas y build aprobados.
- [ ] Estado real y siguiente etapa registrados; sin desplegar ni generar APK.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
