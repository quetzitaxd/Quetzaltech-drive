# Empieza aquí

Este ZIP contiene una base ejecutable y un plan de implementación, no la aplicación terminada.

## Para el usuario
1. Descomprime quetzaltech-drive y ábrelo en el agente de programación.
2. Pega: `Lee AGENTS.md, START_HERE.md y STATUS.md. Ejecuta prompts/01-verificar-base.md. No avances a otra etapa; al terminar actualiza STATUS.md.`
3. Cuando termine correctamente, pega el comando de la etapa siguiente en prompts/INDEX.md.
4. Si cambias de chat, usa prompts/CONTINUAR.md. El contexto queda en archivos.

## Incluido y pendiente
Incluido: npm workspaces, React/Tailwind inicial, Fastify /api/health, SQLite y migración inicial, configuración Capacitor, Compose/Dockerfile, contratos y prompts detallados.
Pendiente: acceso real, CRUD, subidas, miniaturas, visor funcional, APK y despliegue real. No subir esta base a producción como si estuviera terminada.

## Arranque local
Requiere Node 24 y npm. FFmpeg se requiere a partir de etapa 04 (Docker lo instala).
```bash
cp .env.example .env
npm ci
npm run verify
npm run dev
```
Web http://localhost:5173; API http://127.0.0.1:3000/api/health.
En Windows copia .env.example como .env desde el explorador o PowerShell.

## Orden
01 verificar base → 02 acceso/productos → 03 archivos/subidas → 04 medios/descargas → 05 interfaz → 06 integración web → 07 Android → 08 despliegue.
Consulta docs/VERIFICATION.md para conocer qué se comprobó al generar este paquete.
