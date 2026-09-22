import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
const migrations = fileURLToPath(new URL('../../migrations', import.meta.url));
test('migraciones repetibles; health y API pendiente cerrada', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'qtd-'));
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    let db = openDatabase(dir, migrations); db.close();
    db = openDatabase(dir, migrations);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as {n:number}).n, 4);
    app = await buildApp(db, path.join(dir, 'missing'), undefined, { dataDir: dir, maxFileBytes: 1024 * 1024 });
    assert.equal((await app.inject('/api/health')).statusCode, 200);
    assert.equal((await app.inject('/api/products')).statusCode, 401);
    assert.equal((await app.inject('/api/assets/any/content')).statusCode, 401);
    assert.equal((await app.inject('/data/drive.sqlite')).statusCode, 404);
  } finally { if (app) await app.close(); rmSync(dir, {recursive:true,force:true}); }
});
