import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/dist/db/index.js';
import { buildApp } from '../server/dist/app.js';
import { config, projectRoot } from '../server/dist/config.js';

test('servidor compilado: web, health y datos cerrados por HTTP real', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  assert.equal(path.resolve(projectRoot), path.resolve(root));
  assert.equal(config.webDir, path.join(root, 'web/dist'));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qtd-compiled-'));
  let app;
  try {
    app = await buildApp(openDatabase(dir, config.migrationsDir), config.webDir);
    app.log.level = 'silent';
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const home = await fetch(base);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    const html = await home.text();
    const script = html.match(/src="([^"]+\.js)"/);
    assert.ok(script, 'la web debe referenciar un bundle JavaScript');
    const bundle = await fetch(new URL(script[1], base));
    assert.equal(bundle.status, 200);
    assert.ok((await bundle.text()).length > 0);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', phase: 'media' });
    assert.equal((await fetch(`${base}/products`)).status, 200);
    for (const route of ['/api/products', '/api/devices']) {
      assert.equal((await fetch(`${base}${route}`)).status, 401);
    }
    for (const route of ['/api/assets/any/content', '/api/products/any/download.zip']) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const response = await fetch(`${base}${route}`, { method });
        if (method === 'GET') assert.equal(response.status, 401, `${method} ${route}`);
        else assert.equal(response.status, 503, `${method} ${route}`);
      }
    }
    for (const route of ['/data', '/data/', '/data/drive.sqlite', '/data/originals/private', '/data/thumbnails/private', '/data/tmp/private', '/data/private?download=1', '/.env', '/server/migrations/001_initial.sql']) {
      for (const method of ['GET', 'HEAD']) {
        assert.equal((await fetch(`${base}${route}`, { method })).status, 404, `${method} ${route}`);
      }
    }
  } finally {
    if (app) await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
