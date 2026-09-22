import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { hashPassword } from '../src/auth/password.js';
import type { AuthOptions } from '../src/auth/index.js';
import type { AssetOptions } from '../src/assets/index.js';
import { absoluteDataPath } from '../src/assets/storage.js';

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
const password = 'Contraseña de archivos 2026!';
const passwordHash = await hashPassword(password);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const png2 = Buffer.from(png); png2[png2.length - 8] ^= 1;
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const authOptions: AuthOptions = { production: false, publicOrigin: 'http://localhost:5173', androidOrigins: [], sessionTtlSeconds: 3600, pairingTtlSeconds: 300 };

function multipart(file: Buffer, filename = 'foto.png', extra = '') {
  const boundary = `qtd-${randomUUID()}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
  const tail = Buffer.from(`\r\n${extra}--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, file, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}
function multipartTwoFiles() {
  const boundary = `qtd-${randomUUID()}`;
  const part = (name: string) => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from('\r\n')]);
  return { payload: Buffer.concat([part('uno.png'), part('dos.png'), Buffer.from(`--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}
function failingWriter(code: string) {
  return new Writable({ write(_chunk, _encoding, callback) { const error = Object.assign(new Error(code), { code }); callback(error); } });
}
async function fixture(overrides: Partial<AssetOptions> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-assets-'));
  let db = openDatabase(dir, migrations);
  db.prepare('INSERT INTO personal_account VALUES (1, ?, ?)').run(passwordHash, new Date().toISOString());
  const storage: AssetOptions = { dataDir: dir, maxFileBytes: 1024 * 1024, ...overrides };
  let app = await buildApp(db, path.join(dir, 'missing'), authOptions, storage); app.log.level = 'silent';
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-csrf-token': login.json().csrfToken as string };
  async function product(name: string) {
    const response = await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name } });
    assert.equal(response.statusCode, 201, response.body); return response.json();
  }
  async function upload(productId: string, key: string, data = png, filename = 'foto.png', claimedHash = sha(data), claimedSize = data.length) {
    const body = multipart(data, filename);
    return app.inject({ method: 'POST', url: `/api/products/${productId}/assets`, headers: { ...headers, 'idempotency-key': key, 'x-file-sha256': claimedHash, 'x-file-size': String(claimedSize), 'content-type': body.contentType }, payload: body.payload });
  }
  return {
    dir, headers, storage, product, upload, get app() { return app; }, get db() { return db; },
    async restart() { await app.close(); db = openDatabase(dir, migrations); app = await buildApp(db, path.join(dir, 'missing'), authOptions, storage); app.log.level = 'silent'; },
    async close() { await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}

test('subidas requieren acceso, fingerprint y exactamente un archivo', async () => {
  const f = await fixture();
  try {
    const product = await f.product('Producto');
    const body = multipart(png);
    assert.equal((await f.app.inject({ method: 'POST', url: `/api/products/${product.id}/assets`, headers: { 'content-type': body.contentType }, payload: body.payload })).statusCode, 401);
    for (const headers of [
      { ...f.headers, 'content-type': body.contentType },
      { ...f.headers, 'content-type': body.contentType, 'idempotency-key': 'clave-segura-1234' },
      { ...f.headers, 'content-type': body.contentType, 'idempotency-key': 'corta', 'x-file-sha256': sha(png), 'x-file-size': String(png.length) },
    ]) assert.equal((await f.app.inject({ method: 'POST', url: `/api/products/${product.id}/assets`, headers, payload: body.payload })).statusCode, 400);
    const emptyBoundary = 'qtd-empty';
    const empty = await f.app.inject({ method: 'POST', url: `/api/products/${product.id}/assets`, headers: { ...f.headers, 'idempotency-key': 'archivo-vacio-1234', 'x-file-sha256': sha(png), 'x-file-size': String(png.length), 'content-type': `multipart/form-data; boundary=${emptyBoundary}` }, payload: `--${emptyBoundary}--\r\n` });
    assert.equal(empty.statusCode, 400);
    const two = multipartTwoFiles();
    const secondFile = await f.app.inject({ method: 'POST', url: `/api/products/${product.id}/assets`, headers: { ...f.headers, 'idempotency-key': 'dos-archivos-rechazo-0001', 'x-file-sha256': sha(png), 'x-file-size': String(png.length), 'content-type': two.contentType }, payload: two.payload });
    assert.equal(secondFile.statusCode, 400);
    const jsonInstead = await f.app.inject({ method: 'POST', url: `/api/products/${product.id}/assets`, headers: { ...f.headers, 'idempotency-key': 'multipart-invalido-0001', 'x-file-sha256': sha(png), 'x-file-size': String(png.length) }, payload: {} });
    assert.equal(jsonInstead.statusCode, 400);
  } finally { await f.close(); }
});

test('dos subidas concurrentes reservan nombres distintos y preservan bytes/hash', async () => {
  const f = await fixture();
  try {
    const product = await f.product('Blusa cálida');
    const responses = await Promise.all([
      f.upload(product.id, 'archivo-concurrente-0001', png, '../../secreto.png'),
      f.upload(product.id, 'archivo-concurrente-0002', png2, '..\\otra.png'),
    ]);
    assert.ok(responses.every(response => response.statusCode === 201), responses.map(response => response.body).join('\n'));
    const rows = f.db.prepare('SELECT * FROM assets ORDER BY assigned_name').all() as Array<{ assigned_name:string; original_name:string; relative_path:string; sha256:string }>;
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].assigned_name, rows[1].assigned_name);
    assert.ok(rows.every(row => !row.relative_path.includes('..') && !row.original_name.includes('/') && !row.original_name.includes('\\')));
    const stored = rows.map(row => readFileSync(absoluteDataPath(f.dir, row.relative_path)));
    assert.deepEqual(new Set(stored.map(sha)), new Set([sha(png), sha(png2)]));
    assert.deepEqual(new Set(rows.map(row => row.sha256)), new Set([sha(png), sha(png2)]));
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n:number }).n, 2);
  } finally { await f.close(); }
});

test('multipart puede superar el límite JSON sin cargar el archivo completo en memoria del servidor', async () => {
  const f = await fixture();
  try {
    const product = await f.product('Archivo mediano');
    const medium = Buffer.concat([png, Buffer.alloc(32 * 1024)]);
    const response = await f.upload(product.id, 'archivo-mayor-json-0001', medium);
    assert.equal(response.statusCode, 201, response.body);
    const row = f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(response.json().id) as {relative_path:string};
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, row.relative_path))), sha(medium));
  } finally { await f.close(); }
});

test('idempotencia devuelve el resultado, coordina concurrencia y no acepta otra huella', async () => {
  const f = await fixture();
  try {
    const product = await f.product('Idempotente');
    const key = 'intento-idempotente-0001';
    const first = await f.upload(product.id, key);
    assert.equal(first.statusCode, 201, first.body);
    const replay = await f.upload(product.id, key);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().id, first.json().id);
    assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM assets').get() as { n:number }).n, 1);
    assert.equal((await f.upload(product.id, key, png2)).statusCode, 409);

    const parallelKey = 'intento-idempotente-0002';
    const simultaneous = await Promise.all([f.upload(product.id, parallelKey), f.upload(product.id, parallelKey)]);
    assert.deepEqual(simultaneous.map(response => response.statusCode).sort(), [201, 409]);
  } finally { await f.close(); }
});

test('límite, hash incorrecto, tipo no admitido y fallo de disco limpian temporales', async () => {
  const limited = await fixture({ maxFileBytes: png.length });
  try {
    const product = await limited.product('Límites');
    assert.equal((await limited.upload(product.id, 'demasiado-grande-0001', Buffer.concat([png, Buffer.from([1])]))).statusCode, 413);
    const mismatchKey = 'huella-incorrecta-0001';
    assert.equal((await limited.upload(product.id, mismatchKey, png2, 'foto.png', sha(png), png.length)).statusCode, 409);
    const retried = await limited.upload(product.id, mismatchKey, png, 'foto.png', sha(png), png.length);
    assert.equal(retried.statusCode, 201, retried.body);
    const text = Buffer.from('esto no es una imagen');
    assert.equal((await limited.upload(product.id, 'tipo-no-permitido-001', text)).statusCode, 415);
    const temporary = limited.db.prepare("SELECT COUNT(*) AS n FROM upload_attempts WHERE state = 'failed' AND temp_path IS NOT NULL").get() as { n:number };
    assert.equal(temporary.n, 0);
  } finally { await limited.close(); }

  for (const [code, expected] of [['ENOSPC', 507], ['EPIPE', 400]] as const) {
    const failed = await fixture({ createWriteStream: () => failingWriter(code) });
    try {
      const product = await failed.product(`Fallo ${code}`);
      const response = await failed.upload(product.id, `fallo-escritura-${code}-0001`);
      assert.equal(response.statusCode, expected, response.body);
      assert.equal((failed.db.prepare("SELECT state FROM upload_attempts").get() as {state:string}).state, 'failed');
      assert.equal((failed.db.prepare('SELECT COUNT(*) AS n FROM assets').get() as {n:number}).n, 0);
    } finally { await failed.close(); }
  }
});

test('reinicio completa un archivo ya enlazado y descarta un temporal interrumpido', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-recovery-'));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const db = openDatabase(dir, migrations);
    const productId = randomUUID(); const storageKey = `${productId}-recuperable`; const now = new Date().toISOString();
    db.prepare('INSERT INTO products(id, name, storage_key, next_sequence, created_at, updated_at) VALUES (?, ?, ?, 3, ?, ?)').run(productId, 'Recuperable', storageKey, now, now);
    const finalRelative = `originals/${storageKey}/recuperable-001.png`;
    const final = absoluteDataPath(dir, finalRelative);
    mkdirSync(path.dirname(final), { recursive: true });
    writeFileSync(final, png);
    const pendingAssetId = randomUUID();
    db.prepare(`INSERT INTO upload_attempts(id, product_id, idempotency_key, state, request_fingerprint, temp_path, updated_at,
      original_name, expected_size, expected_sha256, reserved_sequence, pending_asset_id, assigned_name, detected_mime_type, final_relative_path, sort_order)
      VALUES (?, ?, ?, 'receiving', ?, NULL, ?, ?, ?, ?, 1, ?, ?, 'image/png', ?, 1)`).run(randomUUID(), productId, 'recuperacion-final-0001', `${productId}:${png.length}:${sha(png)}`, now, 'original.png', png.length, sha(png), pendingAssetId, 'recuperable-001.png', finalRelative);
    const interruptedTemp = 'tmp/interrumpido.upload';
    writeFileSync(absoluteDataPath(dir, interruptedTemp), Buffer.from('parcial'));
    db.prepare(`INSERT INTO upload_attempts(id, product_id, idempotency_key, state, request_fingerprint, temp_path, updated_at,
      expected_size, expected_sha256, reserved_sequence, pending_asset_id, sort_order)
      VALUES (?, ?, ?, 'receiving', ?, ?, ?, ?, ?, 2, ?, 2)`).run(randomUUID(), productId, 'recuperacion-temp-0001', `${productId}:${png.length}:${sha(png)}`, interruptedTemp, now, png.length, sha(png), randomUUID());
    db.close();
    const reopened = openDatabase(dir, migrations);
    app = await buildApp(reopened, path.join(dir, 'missing'), authOptions, { dataDir: dir, maxFileBytes: 1024 }); app.log.level = 'silent';
    assert.equal((reopened.prepare('SELECT state FROM upload_attempts WHERE idempotency_key = ?').get('recuperacion-final-0001') as {state:string}).state, 'complete');
    assert.equal((reopened.prepare('SELECT state FROM upload_attempts WHERE idempotency_key = ?').get('recuperacion-temp-0001') as {state:string}).state, 'failed');
    assert.equal((reopened.prepare('SELECT sha256 FROM assets WHERE id = ?').get(pendingAssetId) as {sha256:string}).sha256, sha(png));
    assert.equal(readFileSync(final).compare(png), 0);
    assert.equal((reopened.prepare('SELECT COUNT(*) AS n FROM jobs').get() as {n:number}).n, 1);
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('listar, renombrar, ordenar, mover y eliminar conservan contenido y portadas', async () => {
  const f = await fixture();
  try {
    const source = await f.product('Origen'); const target = await f.product('Destino');
    const first = await f.upload(source.id, 'operaciones-archivo-0001', png, 'uno.png');
    const second = await f.upload(source.id, 'operaciones-archivo-0002', png2, 'dos.png');
    assert.equal(first.statusCode, 201); assert.equal(second.statusCode, 201);
    const firstId = first.json().id as string; const secondId = second.json().id as string;
    assert.equal((await f.app.inject({ url: `/api/products/${source.id}/assets` })).statusCode, 401);
    const listed = await f.app.inject({ url: `/api/products/${source.id}/assets`, headers: f.headers });
    assert.equal(listed.json().items.length, 2);
    assert.deepEqual({ total: listed.json().total, page: listed.json().page, pageSize: listed.json().pageSize }, { total: 2, page: 1, pageSize: 100 });
    assert.equal((await f.app.inject({ url: `/api/products/${source.id}/assets?page=2&pageSize=1`, headers: f.headers })).json().items.length, 1);
    const originalPath = (f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(firstId) as {relative_path:string}).relative_path;
    const originalBytes = readFileSync(absoluteDataPath(f.dir, originalPath));
    const renamed = await f.app.inject({ method: 'PATCH', url: `/api/assets/${firstId}`, headers: f.headers, payload: { name: 'nombre-seguro.png' } });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal(renamed.json().assignedName, 'nombre-seguro.png');
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, (f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(firstId) as {relative_path:string}).relative_path))), sha(originalBytes));
    const caseOnly = await f.app.inject({ method: 'PATCH', url: `/api/assets/${firstId}`, headers: f.headers, payload: { name: 'NOMBRE-SEGURO.png' } });
    assert.equal(caseOnly.statusCode, 200, caseOnly.body);
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, (f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(firstId) as {relative_path:string}).relative_path))), sha(originalBytes));
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/assets/${firstId}`, headers: f.headers, payload: { name: '../escape.png' } })).statusCode, 400);
    assert.equal((await f.app.inject({ method: 'PATCH', url: `/api/assets/${firstId}`, headers: f.headers, payload: { name: 'cambio.jpg' } })).statusCode, 400);

    assert.equal((await f.app.inject({ method: 'POST', url: `/api/products/${source.id}/order`, headers: f.headers, payload: { assetIds: [firstId] } })).statusCode, 400);
    const ordered = await f.app.inject({ method: 'POST', url: `/api/products/${source.id}/order`, headers: f.headers, payload: { assetIds: [secondId, firstId] } });
    assert.deepEqual(ordered.json().items.map((item: {id:string}) => item.id), [secondId, firstId]);
    await f.app.inject({ method: 'PATCH', url: `/api/products/${source.id}`, headers: f.headers, payload: { coverAssetId: firstId } });
    const moved = await f.app.inject({ method: 'POST', url: '/api/assets/move', headers: f.headers, payload: { assetIds: [firstId], targetProductId: target.id } });
    assert.equal(moved.statusCode, 200, moved.body);
    const movedRow = f.db.prepare('SELECT product_id, relative_path, sha256 FROM assets WHERE id = ?').get(firstId) as {product_id:string;relative_path:string;sha256:string};
    assert.equal(movedRow.product_id, target.id);
    assert.equal(movedRow.sha256, sha(png));
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, movedRow.relative_path))), sha(png));
    assert.equal((f.db.prepare('SELECT cover_asset_id FROM products WHERE id = ?').get(source.id) as {cover_asset_id:null}).cover_asset_id, null);

    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/assets/${firstId}`, headers: f.headers })).statusCode, 204);
    assert.equal(f.db.prepare('SELECT 1 FROM assets WHERE id = ?').get(firstId), undefined);
    assert.equal((await f.upload(source.id, 'operaciones-archivo-0001')).statusCode, 410);
    assert.equal((f.db.prepare('SELECT tombstoned_at FROM upload_attempts WHERE idempotency_key = ?').get('operaciones-archivo-0001') as {tombstoned_at:string}).tombstoned_at.length > 0, true);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/assets/batch-delete', headers: f.headers, payload: { assetIds: [secondId] } })).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/products/${source.id}`, headers: f.headers, payload: { confirm: source.id } })).statusCode, 204);
  } finally { await f.close(); }
});

test('operación preparada se completa al reiniciar', async () => {
  const f = await fixture();
  try {
    const source = await f.product('Antes'); const target = await f.product('Después');
    const uploaded = await f.upload(source.id, 'reinicio-operacion-0001');
    const id = uploaded.json().id as string;
    const row = f.db.prepare('SELECT relative_path, assigned_name FROM assets WHERE id = ?').get(id) as {relative_path:string;assigned_name:string};
    const storage = f.db.prepare('SELECT storage_key FROM products WHERE id = ?').get(target.id) as {storage_key:string};
    const targetName = `despues-001${path.extname(row.assigned_name)}`;
    const relative = `originals/${storage.storage_key}/${targetName}`;
    const operationId = randomUUID(); const now = new Date().toISOString();
    f.db.prepare("INSERT INTO asset_operations(id, kind, asset_id, source_relative_path, target_relative_path, target_product_id, target_assigned_name, target_sort_order, created_at, updated_at) VALUES (?, 'move', ?, ?, ?, ?, ?, 1, ?, ?)").run(operationId, id, row.relative_path, relative, target.id, targetName, now, now);
    await f.restart();
    const recovered = f.db.prepare('SELECT product_id, relative_path FROM assets WHERE id = ?').get(id) as {product_id:string;relative_path:string};
    assert.equal(recovered.product_id, target.id); assert.equal(recovered.relative_path, relative);
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, relative))), sha(png));
    assert.equal(f.db.prepare('SELECT 1 FROM asset_operations WHERE id = ?').get(operationId), undefined);
  } finally { await f.close(); }
});
