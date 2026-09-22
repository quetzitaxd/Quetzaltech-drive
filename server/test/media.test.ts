import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yauzl from 'yauzl';
import { buildApp } from '../src/app.js';
import { openDatabase } from '../src/db/index.js';
import { absoluteDataPath } from '../src/assets/storage.js';
import { hashPassword } from '../src/auth/password.js';
import { DerivativeWorker } from '../src/jobs/index.js';
import type { AuthOptions } from '../src/auth/index.js';

const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const password = 'Contraseña de medios 2026!';
const passwordHash = await hashPassword(password);

function multipart(file: Buffer, name: string) {
  const boundary = `qtd-${randomUUID()}`;
  return { contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]) };
}
async function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-media-'));
  let now = Date.now();
  const options: AuthOptions = { production: false, publicOrigin: 'http://localhost:5173', androidOrigins: [], sessionTtlSeconds: 3600, pairingTtlSeconds: 300, now: () => now };
  let db = openDatabase(dir, migrations);
  db.prepare('INSERT INTO personal_account VALUES (1, ?, ?)').run(passwordHash, new Date().toISOString());
  let app = await buildApp(db, path.join(dir, 'missing'), options, { dataDir: dir, maxFileBytes: 1024 * 1024 }); app.log.level = 'silent';
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password } });
  const headers = { cookie: String(login.headers['set-cookie']).split(';')[0], 'x-csrf-token': login.json().csrfToken as string };
  const create = await app.inject({ method: 'POST', url: '/api/products', headers, payload: { name: 'Álbum pruebas' } });
  const productId = create.json().id as string;
  async function upload(data = png, name = 'imagen.png') {
    const body = multipart(data, name);
    const response = await app.inject({ method: 'POST', url: `/api/products/${productId}/assets`, headers: {
      ...headers, 'content-type': body.contentType, 'x-file-size': String(data.length), 'x-file-sha256': sha(data), 'idempotency-key': `medio-${randomUUID()}`,
    }, payload: body.payload });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  return { dir, headers, productId, upload, get db() { return db; }, get app() { return app; },
    advance(ms: number) { now += ms; },
    async restart() { await app.close(); db = openDatabase(dir, migrations); app = await buildApp(db, path.join(dir, 'missing'), options, { dataDir: dir, maxFileBytes: 1024 * 1024 }); app.log.level = 'silent'; },
    async close() { await app.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
async function awaitStatus(db: ReturnType<typeof openDatabase>, id: string, status: string) {
  for (let tries = 0; tries < 100; tries++) {
    const row = db.prepare('SELECT thumbnail_status FROM assets WHERE id = ?').get(id) as { thumbnail_status:string } | undefined;
    if (row?.thumbnail_status === status) return;
    await delay(20);
  }
  assert.fail(`la derivada no alcanzó el estado ${status}`);
}
async function zipEntries(buffer: Buffer): Promise<Array<{ name: string; data: Buffer }>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries: Array<{name:string;data:Buffer}> = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', entry => zip.openReadStream(entry, (readError, stream) => {
        if (readError || !stream) return reject(readError);
        const chunks: Buffer[] = [];
        stream.on('data', chunk => chunks.push(chunk as Buffer));
        stream.on('error', reject);
        stream.on('end', () => { entries.push({ name: entry.fileName, data: Buffer.concat(chunks) }); zip.readEntry(); });
      }));
      zip.readEntry();
    });
  });
}

test('original y miniatura privados: bytes intactos, HEAD y rangos 206/416', async () => {
  const f = await fixture();
  try {
    const id = await f.upload();
    await awaitStatus(f.db, id, 'ready');
    for (const route of ['content','thumbnail','download']) assert.equal((await f.app.inject(`/api/assets/${id}/${route}`)).statusCode, 401);
    const content = await f.app.inject({ url: `/api/assets/${id}/content`, headers: f.headers });
    assert.equal(content.statusCode, 200); assert.equal(sha(content.rawPayload), sha(png));
    assert.equal(content.headers['accept-ranges'], 'bytes');
    assert.equal(content.headers['content-type'], 'image/png');
    const head = await f.app.inject({ method: 'HEAD', url: `/api/assets/${id}/content`, headers: f.headers });
    assert.equal(head.statusCode, 200); assert.equal(head.rawPayload.length, 0);
    assert.equal(Number(head.headers['content-length']), png.length);
    const range = await f.app.inject({ url: `/api/assets/${id}/content`, headers: { ...f.headers, range: 'bytes=2-9' } });
    assert.equal(range.statusCode, 206); assert.equal(range.headers['content-range'], `bytes 2-9/${png.length}`);
    assert.deepEqual(range.rawPayload, png.subarray(2, 10));
    const suffix = await f.app.inject({ url: `/api/assets/${id}/content`, headers: { ...f.headers, range: 'bytes=-5' } });
    assert.deepEqual(suffix.rawPayload, png.subarray(-5));
    for (const invalid of ['bytes=999-','bytes=9-2','bytes=0-1,3-4','bytes=-0','garbage']) {
      const response = await f.app.inject({ url: `/api/assets/${id}/content`, headers: { ...f.headers, range: invalid } });
      assert.equal(response.statusCode, 416, invalid); assert.equal(response.headers['content-range'], `bytes */${png.length}`);
    }
    const thumb = await f.app.inject({ url: `/api/assets/${id}/thumbnail`, headers: f.headers });
    assert.equal(thumb.statusCode, 200); assert.equal(thumb.headers['content-type'], 'image/jpeg');
    assert.ok(thumb.rawPayload.length > 0);
    const original = f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(id) as { relative_path:string };
    assert.equal(sha(readFileSync(absoluteDataPath(f.dir, original.relative_path))), sha(png));
    const download = await f.app.inject({ url: `/api/assets/${id}/download`, headers: f.headers });
    assert.equal(sha(download.rawPayload), sha(png)); assert.match(String(download.headers['content-disposition']), /attachment/);
  } finally { await f.close(); }
});

test('tickets se limitan por recurso y operación; expiran y se revocan', async () => {
  const f = await fixture();
  try {
    const first = await f.upload(); const second = await f.upload(png, 'dos.png');
    const ticketResponse = await f.app.inject({ method: 'POST', url: `/api/assets/${first}/ticket`, headers: f.headers, payload: { scope: 'content' } });
    assert.equal(ticketResponse.statusCode, 200, ticketResponse.body);
    const url = ticketResponse.json().url as string;
    assert.equal((await f.app.inject(url)).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'HEAD', url, headers: { range: 'bytes=0-2' } })).statusCode, 206);
    assert.equal((await f.app.inject(url.replace('/content?', '/download?'))).statusCode, 401);
    assert.equal((await f.app.inject(url.replace(first, second))).statusCode, 401);
    f.advance(300_000);
    assert.equal((await f.app.inject(url)).statusCode, 401);
    f.advance(-300_000);
    const renewed = (await f.app.inject({ method: 'POST', url: `/api/assets/${first}/ticket`, headers: f.headers, payload: { scope: 'content' } })).json().url as string;
    assert.equal((await f.app.inject(renewed)).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: f.headers })).statusCode, 204);
    assert.equal((await f.app.inject(renewed)).statusCode, 401);
  } finally { await f.close(); }
});

test('ticket de dispositivo pierde acceso tras revocación y borrado limpia miniatura', async () => {
  const f = await fixture();
  try {
    const id = await f.upload();
    await awaitStatus(f.db, id, 'ready');
    const thumbnail = (f.db.prepare('SELECT thumbnail_path FROM assets WHERE id = ?').get(id) as {thumbnail_path:string}).thumbnail_path;
    assert.equal(existsSync(absoluteDataPath(f.dir, thumbnail)), true);
    const code = (await f.app.inject({ method: 'POST', url: '/api/devices/pairing', headers: f.headers })).json().code as string;
    const device = (await f.app.inject({ method: 'POST', url: '/api/devices/pair', payload: { code, name: 'Dispositivo de prueba' } })).json() as {deviceId:string;token:string};
    const ticket = (await f.app.inject({ method: 'POST', url: `/api/assets/${id}/ticket`, headers: { authorization: `Bearer ${device.token}` }, payload: { scope: 'thumbnail' } })).json().url as string;
    assert.equal((await f.app.inject(ticket)).statusCode, 200);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/devices/${device.deviceId}`, headers: f.headers })).statusCode, 204);
    assert.equal((await f.app.inject(ticket)).statusCode, 401);
    assert.equal((await f.app.inject({ method: 'DELETE', url: `/api/assets/${id}`, headers: f.headers })).statusCode, 204);
    assert.equal(existsSync(absoluteDataPath(f.dir, thumbnail)), false);
    assert.equal((await f.app.inject(ticket)).statusCode, 401);
  } finally { await f.close(); }
});

test('ZIP contiene nombres y bytes reales; falta de archivo cancela antes de responder', async () => {
  const f = await fixture();
  try {
    const first = await f.upload(); const second = await f.upload(png, 'segundo.png');
    const response = await f.app.inject({ url: `/api/products/${f.productId}/download.zip`, headers: f.headers });
    assert.equal(response.statusCode, 200, response.body.slice(0, 200));
    assert.equal(response.headers['content-type'], 'application/zip');
    const entries = await zipEntries(response.rawPayload);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(entry => sha(entry.data) === sha(png)));
    assert.equal(new Set(entries.map(entry => entry.name)).size, 2);
    const relative = (f.db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(first) as {relative_path:string}).relative_path;
    unlinkSync(absoluteDataPath(f.dir, relative));
    const missing = await f.app.inject({ url: `/api/products/${f.productId}/download.zip`, headers: f.headers });
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.json().error.code, 'FILE_MISSING');
    assert.equal((await f.app.inject(`/api/products/${f.productId}/download.zip`)).statusCode, 401);
    assert.ok(second);
  } finally { await f.close(); }
});

test('worker recupera running, marca fallback HEIC y fallo de FFmpeg sin tocar originales', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-jobs-'));
  const db = openDatabase(dir, migrations);
  const now = new Date().toISOString(); const productId = randomUUID();
  db.prepare('INSERT INTO products(id, name, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(productId, 'Medios', `${productId}-medios`, now, now);
  const ids: string[] = [];
  for (const [index, kind, mime] of [[0, 'thumbnail', 'image/png'], [1, 'thumbnail', 'image/heic'], [2, 'poster', 'video/mp4']] as const) {
    const id = randomUUID(); ids.push(id);
    const relative = `originals/${productId}-medios/${id}.bin`;
    const file = absoluteDataPath(dir, relative);
    const data = index === 1 ? Buffer.from('HEIC no compatible en este entorno de prueba') : png;
    const { mkdirSync } = await import('node:fs'); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data);
    db.prepare('INSERT INTO assets(id, product_id, original_name, assigned_name, relative_path, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, productId, 'original.bin', `${id}.bin`, relative, mime, data.length, now);
    db.prepare('INSERT INTO jobs(id, asset_id, kind, state, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), id, kind, index === 0 ? 'running' : 'pending', now);
  }
  const worker = new DerivativeWorker(db, { dataDir: dir, ffmpegPath: 'ffmpeg-no-existe-qtd', maxAttempts: 2 });
  try {
    worker.wake(); await worker.waitForIdle();
    const states = ids.map(id => db.prepare('SELECT thumbnail_status FROM assets WHERE id = ?').get(id) as { thumbnail_status:string });
    assert.deepEqual(states.map(row => row.thumbnail_status), ['ready','unsupported','failed']);
    assert.equal((db.prepare('SELECT playback_status FROM assets WHERE id = ?').get(ids[2]) as {playback_status:string}).playback_status, 'download_only');
    assert.equal((db.prepare("SELECT attempts FROM jobs WHERE asset_id = ?").get(ids[2]) as {attempts:number}).attempts, 2);
    for (const id of ids) {
      const relative = (db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(id) as {relative_path:string}).relative_path;
      assert.equal(sha(readFileSync(absoluteDataPath(dir, relative))), id === ids[1] ? sha(Buffer.from('HEIC no compatible en este entorno de prueba')) : sha(png));
    }
  } finally { await worker.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
