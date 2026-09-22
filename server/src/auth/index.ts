import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { HttpError, objectBody, textField } from '../http.js';
import { verifyPassword } from './password.js';

export type AuthOptions = {
  production: boolean; publicOrigin: string; androidOrigins: string[];
  sessionTtlSeconds: number; pairingTtlSeconds: number; now?: () => number;
};
type Identity = { kind: 'session'; tokenHash: string; csrf: string } | { kind: 'device'; id: string };
declare module 'fastify' { interface FastifyRequest { identity: Identity | null } }
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const csrfFor = (session: string) => createHmac('sha256', session).update('quetzaltech-drive:csrf:v1').digest('base64url');
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const sameHash = (left: string, right: string) => /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

export async function registerAuth(app: FastifyInstance, db: Database.Database, options: AuthOptions) {
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const cookieName = options.production ? '__Host-qtd_session' : 'qtd_session';
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: options.production };
  const origins = [options.publicOrigin, ...options.androidOrigins];
  app.decorateRequest('identity', null);
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    if (origin && !origins.includes(origin)) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Origen no permitido.');
  });
  await app.register(cors, {
    origin: origins, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-File-SHA256', 'X-File-Size'],
  });

  function webOrigin(request: FastifyRequest) {
    if ((request.headers.origin && request.headers.origin !== options.publicOrigin) || request.headers['sec-fetch-site'] === 'cross-site') {
      throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Usa la web del servicio.');
    }
  }
  async function authenticate(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization);
      const device = match && db.prepare('SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(digest(match[1])) as { id: string } | undefined | false;
      if (!device) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión o vincula el dispositivo.');
      request.identity = { kind: 'device', id: device.id };
      return;
    }
    const token = request.cookies[cookieName];
    const session = token && tokenPattern.test(token) && db.prepare('SELECT csrf_hash FROM sessions WHERE token_hash = ? AND expires_at > ?').get(digest(token), iso()) as { csrf_hash: string } | undefined | false;
    if (!session || !token) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión o vincula el dispositivo.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      webOrigin(request);
      const csrf = request.headers['x-csrf-token'];
      if (typeof csrf !== 'string' || !sameHash(digest(csrf), session.csrf_hash)) throw new HttpError(403, 'CSRF_INVALID', 'Token CSRF no válido.');
    }
    request.identity = { kind: 'session', tokenHash: digest(token), csrf: csrfFor(token) };
  }
  async function requireSession(request: FastifyRequest) {
    await authenticate(request);
    if (request.identity?.kind !== 'session') throw new HttpError(403, 'WEB_SESSION_REQUIRED', 'Se requiere una sesión web.');
  }

  // Contadores persistentes: reiniciar el proceso o falsificar X-Forwarded-For no los evita.
  function limit(request: FastifyRequest, action: string) {
    const timestamp = now();
    const blocked = db.transaction(() => {
      db.prepare('DELETE FROM auth_rate_limits WHERE resets_at <= ?').run(timestamp);
      const keys: [string, number][] = [[`${action}:all`, 50], [`${action}:${digest(request.ip)}`, 10]];
      for (const [key, maximum] of keys) {
        const row = db.prepare('SELECT attempts FROM auth_rate_limits WHERE key = ?').get(key) as { attempts: number } | undefined;
        if (row && row.attempts >= maximum) return true;
      }
      for (const [key] of keys) db.prepare('INSERT INTO auth_rate_limits(key, attempts, resets_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1').run(key, timestamp + 300_000);
      return false;
    })();
    if (blocked) throw new HttpError(429, 'RATE_LIMITED', 'Demasiados intentos. Espera cinco minutos.');
  }

  app.post('/api/auth/login', { onRequest: async request => { webOrigin(request); limit(request, 'login'); } }, async (request, reply) => {
    const body = objectBody(request.body, ['password']);
    if (typeof body.password !== 'string' || !body.password || body.password.length > 256) throw new HttpError(400, 'VALIDATION', 'Contraseña no válida.');
    const account = db.prepare('SELECT password_hash FROM personal_account WHERE id = 1').get() as { password_hash: string } | undefined;
    if (!account) throw new HttpError(503, 'SETUP_REQUIRED', 'Configura la cuenta desde la terminal del servidor.');
    if (!await verifyPassword(body.password, account.password_hash)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Contraseña incorrecta.');
    const token = newToken();
    const csrfToken = csrfFor(token);
    db.transaction(() => {
      // La configuración puede cambiar durante scrypt; no crear una sesión con el hash anterior.
      const current = db.prepare('SELECT password_hash FROM personal_account WHERE id = 1').get() as { password_hash: string };
      if (current.password_hash !== account.password_hash) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Contraseña incorrecta.');
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso());
      const previous = request.cookies[cookieName];
      if (previous) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(previous));
      db.prepare('INSERT INTO sessions(token_hash, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(token), digest(csrfToken), new Date(now() + options.sessionTtlSeconds * 1000).toISOString(), iso());
    })();
    reply.setCookie(cookieName, token, { ...cookieOptions, maxAge: options.sessionTtlSeconds });
    return { csrfToken };
  });
  app.get('/api/auth/session', { onRequest: requireSession }, async request => ({ authenticated: true, csrfToken: request.identity?.kind === 'session' ? request.identity.csrf : undefined }));
  app.post('/api/auth/logout', { onRequest: requireSession }, async (request, reply) => {
    if (request.identity?.kind === 'session') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(request.identity.tokenHash);
    reply.clearCookie(cookieName, cookieOptions).code(204).send();
  });
  app.post('/api/devices/pairing', { onRequest: requireSession }, async request => {
    limit(request, 'pairing-create');
    const code = randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(now() + options.pairingTtlSeconds * 1000).toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM pairing_codes').run();
      db.prepare('INSERT INTO pairing_codes(code_hash, expires_at) VALUES (?, ?)').run(digest(code), expiresAt);
    })();
    return { code, expiresAt };
  });
  app.post('/api/devices/pair', { onRequest: async request => { limit(request, 'pair'); } }, async (request, reply) => {
    const body = objectBody(request.body, ['code', 'name']);
    const code = textField(body.code, 12).toUpperCase();
    const name = textField(body.name, 100);
    if (!/^[A-F0-9]{12}$/.test(code)) throw new HttpError(400, 'VALIDATION', 'Código no válido.');
    const token = newToken();
    const deviceId = randomUUID();
    db.transaction(() => {
      const result = db.prepare('UPDATE pairing_codes SET consumed_at = ? WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?').run(iso(), digest(code), iso());
      if (result.changes !== 1) throw new HttpError(401, 'PAIRING_INVALID', 'Código inválido, consumido o expirado.');
      db.prepare('INSERT INTO devices(id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(deviceId, name, digest(token), iso());
    })();
    reply.code(201);
    return { deviceId, token };
  });
  app.get('/api/devices', { onRequest: requireSession }, async () => ({ items: db.prepare('SELECT id, name, created_at AS createdAt, revoked_at AS revokedAt FROM devices ORDER BY created_at DESC, id').all() }));
  app.post('/api/devices/unpair', { onRequest: authenticate }, async (request, reply) => {
    if (request.identity?.kind !== 'device') throw new HttpError(403, 'DEVICE_TOKEN_REQUIRED', 'Se requiere un dispositivo vinculado.');
    db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(iso(), request.identity.id);
    reply.code(204).send();
  });
  app.delete<{ Params: { id: string } }>('/api/devices/:id', { onRequest: requireSession }, async (request, reply) => {
    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(request.params.id);
    if (!device) throw new HttpError(404, 'NOT_FOUND', 'Dispositivo inexistente.');
    db.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(iso(), request.params.id);
    reply.code(204).send();
  });
  return { authenticate, requireSession };
}
