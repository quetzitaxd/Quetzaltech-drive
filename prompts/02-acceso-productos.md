# 02 — Acceso personal y productos

## Instrucción para el agente
Lee AGENTS.md y STATUS.md. Ejecuta únicamente esta etapa. Respeta SPEC.md. Si un prerrequisito falla, resuélvelo dentro del alcance o reporta el bloqueo.

## Leer además
- `SPEC.md`
- `docs/API.md`
- `docs/DATA.md`

## Trabajo requerido
1. Implementa hashing de contraseña y comando interactivo de alta/configuración que no exponga el secreto en argumentos/logs; sesión opaca aleatoria hasheada en DB, expiración y logout.
2. Cookie HttpOnly, SameSite y Secure en producción; defensa CSRF para cookie en mutaciones. CORS explícito reservado para Android. Health sigue público. Rate limit login y pairing.
3. Implementa código de vinculación temporal de un solo uso, consumo transaccional, token de dispositivo aleatorio hasheado y revocable. Emite token solo en pairing. Web administra dispositivos sin revelar tokens.
4. Implementa productos CRUD, nombre requerido, código opcional, IDs/storage_key estables, búsqueda/paginación. Renombrar no cambia rutas. Define confirmación de eliminación y coherencia de portada.
5. Retira fallback 503 únicamente para rutas realmente implementadas. Añade pruebas de acceso y productos de TEST-PLAN.

## Criterios de aceptación
- [ ] Sin acceso no se leen ni modifican productos. Login/logout, CSRF, pairing consumido/expirado y revocación verificados.
- [ ] Productos guardados sobreviven al reinicio; nombres iguales no colisionan; contrato actualizado.

## Cierre obligatorio
Ejecuta las comprobaciones pertinentes y npm run verify. Actualiza STATUS.md con comandos/resultados, archivos clave, limitaciones y próxima etapa. No marques completada si fallan criterios. No avances a la siguiente etapa. Reporta en máximo 12 líneas, sin volcar archivos completos.
