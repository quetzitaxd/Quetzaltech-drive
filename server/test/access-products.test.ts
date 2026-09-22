import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { configurePassword, hashPassword, verifyPassword } from '../src/auth/password.js';
import { digest, type AuthOptions } from '../src/auth/index.js';

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
const password = 'Contraseña de prueba 2026!';
const passwordHash = await hashPassword(password);
async function fixture(overrides: Partial<AuthOptions> = {}, provision = true) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-access-'));
  let clock = Date.now();
  const options: AuthOptions = { production: false, publicOrigin: 'http://localhost:5173', androidOrigins: ['https://localhost'], sessionTtlSeconds: 3600, pairingTtlSeconds: 300, now: () => clock, ...overrides };
  let db = openDatabase(dir, migrations);
  if (provision) db.prepare('INSERT INTO personal_account VALUES (1, ?, ?)').run(passwordHash, new Date().toISOString());
  let app = await buildApp(db, path.join(dir, 'missing'), options, { dataDir: dir, maxFileBytes: 1024 * 1024 });
  app.log.level = 'silent';
  return {
    get app() { return app; }, get db() { return db; },
    advance(ms: number) { clock += ms; },
    async restart() { await app.close(); db = openDatabase(dir, migrations); app = await buildApp(db, path.join(dir, 'missing'), options, { dataDir: dir, maxFileBytes: 1024 * 1024 }); app.log.level = 'silent'; },
    async close() { await app.close(); rmSync(dir, { recursive: true, force: true }); },
    async login() {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
      assert.equal(response.statusCode, 200, response.body);
      const cookie = String(response.headers['set-cookie']).split(';')[0];
      return { cookie, 'x-csrf-token': response.json().csrfToken as string };
    },
  };
}

test('hash con sal, configuración transaccional y revocación al cambiar contraseña', async () => {
  assert.equal(await verifyPassword(password, passwordHash), true);
  assert.equal(await verifyPassword('equivocada', passwordHash), false);
  assert.notEqual(await hashPassword(password), passwordHash);
  await assert.rejects(hashPassword('corta'));
  const eightCharPassword = '12211221';
  assert.equal(await verifyPassword(eightCharPassword, await hashPassword(eightCharPassword)), true);
  const f = await fixture();
  try {
    const headers = await f.login();
    const code = (await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers })).json().code;
    const paired = await f.app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code, name: 'Prueba' } });
    assert.equal(paired.statusCode, 201);
    await configurePassword(f.db, 'Otra contraseña segura 2026!');
    assert.equal((await f.app.inject({ url: '/api/products', headers })).statusCode, 401);
    assert.equal((await f.app.inject({ url: '/api/products', headers: { authorization: `Bearer ${paired.json().token}` } })).statusCode, 401);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM pairing_codes').get() as { n: number }).n, 0);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } })).statusCode, 401);
  } finally { await f.close(); }
});

test('sin configurar no existe acceso por contraseña predeterminada', async () => {
  const f = await fixture({}, false);
  try {
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } })).statusCode, 503);
    assert.equal((await f.app.inject('/api/health')).statusCode, 200);
    assert.equal((await f.app.inject('/api/products')).statusCode, 401);
  } finally { await f.close(); }
});

test('sesiones: login malo/bueno, hash en DB, CSRF estable, expiración y logout', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'incorrecta' } })).statusCode, 401);
    const headers = await f.login();
    const token = headers.cookie.split('=')[1];
    const stored = f.db.prepare('SELECT * FROM sessions').get() as { token_hash: string; csrf_hash: string };
    assert.equal(stored.token_hash, digest(token));
    assert.equal(stored.csrf_hash, digest(headers['x-csrf-token']));
    const session = await f.app.inject({ url: '/api/auth/session', headers });
    assert.equal(session.json().csrfToken, headers['x-csrf-token']);
    assert.equal(session.headers['cache-control'], 'no-store');
    for (const csrf of [undefined, 'incorrecto']) {
      const requestHeaders = { cookie: headers.cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) };
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/products', headers: requestHeaders, payload: { name: 'Bloqueado' } })).statusCode, 403);
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: requestHeaders })).statusCode, 403);
    }
    await f.restart();
    assert.equal((await f.app.inject({ url: '/api/auth/session', headers })).json().csrfToken, headers['x-csrf-token']);
    f.advance(3600_000);
    assert.equal((await f.app.inject({ url: '/api/auth/session', headers })).statusCode, 401);
    const fresh = await f.login();
    const logout = await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: fresh });
    assert.equal(logout.statusCode, 204);
    assert.match(String(logout.headers['set-cookie']), /Expires=Thu, 01 Jan 1970/);
    assert.equal((await f.app.inject({ url: '/api/products', headers: fresh })).statusCode, 401);
  } finally { await f.close(); }
});

test('cookie de producción, orígenes exactos, login CSRF y preflight Android', async () => {
  const f = await fixture({ production: true, publicOrigin: 'https://drive.example.test' });
  try {
    const login = await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
    const cookie = String(login.headers['set-cookie']);
    for (const flag of ['__Host-qtd_session=', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(flag));
    assert.ok(!cookie.includes('Domain='));
    for (const origin of ['https://evil.example', 'null', 'https://drive.example.test.evil', 'https://localhost']) {
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: { origin }, payload: { password } })).statusCode, 403);
    }
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'sec-fetch-site': 'cross-site' }, payload: { password } })).statusCode, 403);
    const preflight = await f.app.inject({ method: 'OPTIONS', url: '/api/products', headers: { origin: 'https://localhost', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'https://localhost');
    const rejected = await f.app.inject({ method: 'OPTIONS', url: '/api/products', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(rejected.statusCode, 403);
    assert.equal(rejected.headers['access-control-allow-origin'], undefined);
  } finally { await f.close(); }
});

test('pairing concurrente, expiración, solo web administra, revocación persistente', async () => {
  const f = await fixture();
  try {
    const headers = await f.login();
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers: { cookie: headers.cookie } })).statusCode, 403);
    const code = (await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers })).json().code;
    assert.equal((f.db.prepare('SELECT code_hash FROM pairing_codes').get() as { code_hash: string }).code_hash, digest(code));
    const results = await Promise.all([1, 2].map(() => f.app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code, name: 'Mi Android' } })));
    assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 401]);
    const paired = results.find(r => r.statusCode === 201)!.json();
    assert.equal((f.db.prepare('SELECT token_hash FROM devices').get() as { token_hash: string }).token_hash, digest(paired.token));
    const bearer = { authorization: `Bearer ${paired.token}`, origin: 'https://localhost' };
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/products', headers: bearer, payload: { name: 'Desde Android' } })).statusCode, 201);
    assert.equal((await f.app.inject({ url: '/api/products', headers: { ...headers, authorization: 'Bearer invalido' } })).statusCode, 401);
    for (const url of ['/api/devices', '/api/auth/session']) assert.equal((await f.app.inject({ url, headers: bearer })).statusCode, 403);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers: bearer })).statusCode, 403);
    const listed = (await f.app.inject({ url: '/api/devices', headers })).json();
    assert.deepEqual(Object.keys(listed.items[0]).sort(), ['createdAt', 'id', 'name', 'revokedAt']);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/devices/${paired.deviceId}`, headers })).statusCode, 204);
    await f.restart();
    assert.equal((await f.app.inject({ url: '/api/products', headers: bearer })).statusCode, 401);
    const selfCode = (await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers })).json().code;
    const selfDevice = (await f.app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code: selfCode, name: 'Android propio' } })).json();
    const selfBearer = { authorization: `Bearer ${selfDevice.token}`, origin: 'https://localhost' };
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/devices/unpair', headers: selfBearer })).statusCode, 204);
    assert.equal((await f.app.inject({ url: '/api/products', headers: selfBearer })).statusCode, 401);
    const expired = (await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers })).json().code;
    f.advance(300_000);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code: expired, name: 'Tarde' } })).statusCode, 401);
  } finally { await f.close(); }
});

test('rate limits sobreviven reinicio y no confían en X-Forwarded-For', async () => {
  const f = await fixture();
  try {
    for (const url of ['/api/auth/login', '/api/devices/pair']) {
      for (let attempt = 0; attempt < 10; attempt++) {
        assert.equal((await f.app.inject({ method: 'POST', url, headers: { 'x-forwarded-for': `192.0.2.${attempt}` }, payload: {} })).statusCode, 400);
      }
      await f.restart();
      const blocked = await f.app.inject({ method: 'POST', url, payload: {} });
      assert.equal(blocked.statusCode, 429);
      assert.equal(blocked.headers['retry-after'], '300');
    }
    f.advance(300_000);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })).statusCode, 400);
  } finally { await f.close(); }
});

test('productos: acceso, validación, duplicados, búsqueda literal, paginación y reinicio', async () => {
  const f = await fixture();
  try {
    for (const [method, url] of [['GET', '/api/products'], ['POST', '/api/products'], ['GET', '/api/products/id'], ['PATCH', '/api/products/id'], ['DELETE', '/api/products/id']] as const) {
      assert.equal((await f.app.inject({ method, url })).statusCode, 401);
    }
    const headers = await f.login();
    for (const payload of [{ name: '' }, { name: '   ' }, { name: 1 }, { name: 'x', role: 'admin' }, { name: 'x', code: 2 }]) {
      assert.equal((await f.app.inject({ method: 'POST', url: '/api/products', headers, payload })).statusCode, 400);
    }
    const created = await Promise.all([1, 2].map(() => f.app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'Blusa calada', code: 'SKU-100%' } })));
    assert.ok(created.every(r => r.statusCode === 201));
    const [first, second] = created.map(r => r.json());
    assert.notEqual(first.id, second.id);
    const keys = f.db.prepare('SELECT storage_key FROM products').all() as { storage_key: string }[];
    assert.notEqual(keys[0].storage_key, keys[1].storage_key);
    const key = (f.db.prepare('SELECT storage_key FROM products WHERE id = ?').get(first.id) as { storage_key: string }).storage_key;
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/products/${first.id}`, headers, payload: { name: '../../Renombrado', code: null } })).statusCode, 200);
    await f.restart();
    const saved = await f.app.inject({ url: `/api/products/${first.id}`, headers });
    assert.equal(saved.json().name, '../../Renombrado');
    assert.equal(saved.json().code, null);
    assert.equal((f.db.prepare('SELECT storage_key FROM products WHERE id = ?').get(first.id) as { storage_key: string }).storage_key, key);
    assert.equal((await f.app.inject({ url: '/api/products?q=calada', headers })).json().total, 1);
    assert.equal((await f.app.inject({ url: '/api/products?q=%25', headers })).json().total, 1);
    assert.equal((await f.app.inject({ url: '/api/products?q=%27%20OR%201%3D1--', headers })).json().total, 0);
    const page1 = (await f.app.inject({ url: '/api/products?page=1&pageSize=1', headers })).json();
    const page2 = (await f.app.inject({ url: '/api/products?page=2&pageSize=1', headers })).json();
    assert.equal(page1.total, 2); assert.notEqual(page1.items[0].id, page2.items[0].id);
    for (const query of ['page=0', 'pageSize=101', 'page=1.1', 'page=1&page=2', 'q=x&q=y']) assert.equal((await f.app.inject({ url: `/api/products?${query}`, headers })).statusCode, 400);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/products/${first.id}`, headers, payload: { confirm: second.id } })).statusCode, 400);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/products/${first.id}`, headers, payload: { confirm: first.id } })).statusCode, 204);
    assert.equal((await f.app.inject({ url: `/api/products/${first.id}`, headers })).statusCode, 404);
  } finally { await f.close(); }
});

test('portada de otro producto rechazada; borrado con archivos permanece deshabilitado', async () => {
  const f = await fixture();
  try {
    const headers = await f.login();
    const create = async (name: string) => (await f.app.inject({ method: 'POST', url: '/api/products', headers, payload: { name } })).json();
    const a = await create('A'); const b = await create('B');
    f.db.prepare('INSERT INTO assets(id, product_id, original_name, assigned_name, relative_path, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('asset-test', a.id, 'test.jpg', 'test-001.jpg', 'test/test-001.jpg', 'image/jpeg', 1, new Date().toISOString());
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/products/${b.id}`, headers, payload: { name: 'No persistir', coverAssetId: 'asset-test' } })).statusCode, 400);
    assert.equal((await f.app.inject({ url: `/api/products/${b.id}`, headers })).json().name, 'B');
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/products/${a.id}`, headers, payload: { coverAssetId: 'asset-test' } })).statusCode, 200);
    assert.equal((await f.app.inject({ url: `/api/products/${a.id}`, headers })).json().assetCount, 1);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/products/${a.id}`, headers, payload: { confirm: a.id } })).statusCode, 409);
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/products/${a.id}`, headers, payload: { coverAssetId: null } })).statusCode, 200);
    assert.equal((await f.app.inject('/api/assets/asset-test/content')).statusCode, 401);
  } finally { await f.close(); }
});
