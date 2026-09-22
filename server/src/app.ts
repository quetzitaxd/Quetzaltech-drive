import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import type Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { registerAuth, type AuthOptions } from './auth/index.js';
import { authConfig } from './config.js';
import { registerProducts } from './products/index.js';
import { HttpError } from './http.js';
import { registerAssets, type AssetOptions } from './assets/index.js';
import { config } from './config.js';
import { DerivativeWorker } from './jobs/index.js';
import { registerMedia } from './media/index.js';
export async function buildApp(db: Database.Database, webDir: string, options: AuthOptions = authConfig, assetOptions: AssetOptions = { dataDir: config.dataDir, maxFileBytes: config.maxFileBytes }) {
  const app = Fastify({ bodyLimit: 16 * 1024, trustProxy: false, logger: { redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.url', 'res.headers["set-cookie"]'] } });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      if (error.statusCode === 429) reply.header('Retry-After', '300');
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const statusCode = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    const status = typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 ? statusCode : 500;
    return reply.code(status).send({ error: { code: status === 500 ? 'INTERNAL_ERROR' : 'VALIDATION', message: status === 500 ? 'No se pudo completar la operación.' : 'Solicitud no válida.' } });
  });
  const auth = await registerAuth(app, db, options);
  registerProducts(app, db, auth.authenticate);
  let worker: DerivativeWorker | undefined;
  await registerAssets(app, db, auth.authenticate, { ...assetOptions, onAssetCreated: () => worker?.wake() });
  registerMedia(app, db, auth.authenticate, { dataDir: assetOptions.dataDir, now: options.now });
  worker = new DerivativeWorker(db, { dataDir: assetOptions.dataDir });
  // Reservar el espacio de datos incluso cuando el fallback de la SPA esté activo.
  app.all('/data', async (_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente' } }));
  app.all('/data/*', async (_req, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente' } }));
  app.get('/api/health', async () => { db.prepare('SELECT 1').get(); return { status: 'ok', phase: 'media' }; });
  // Las rutas de etapas posteriores siguen cerradas.
  app.all('/api/*', async (_req, reply) => reply.code(503).send({ error: { code: 'NOT_IMPLEMENTED', message: 'Completar las etapas del proyecto.' } }));
  if (existsSync(webDir)) {
    await app.register(staticFiles, { root: webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente' } });
      if (req.method === 'GET' && !req.url.includes('.')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta inexistente' } });
    });
  }
  app.addHook('onClose', async () => { await worker?.close(); db.close(); });
  return app;
}
