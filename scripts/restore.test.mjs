import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../server/dist/db/index.js';

test('restore verifier starts an isolated app and rejects changed originals', async () => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'qtd-restore-test-'));
  try {
    const source = path.join(temporaryRoot, 'source');
    const restored = path.join(temporaryRoot, 'isolated', 'data');
    mkdirSync(path.join(source, 'originals', 'product-key'), { recursive: true });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const relativePath = 'originals/product-key/photo.png';
    writeFileSync(path.join(source, relativePath), bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const db = openDatabase(source, path.resolve('server/migrations'));
    db.prepare('INSERT INTO products(id,name,code,storage_key,next_sequence,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('product-1', 'Fixture', null, 'product-key', 2, new Date().toISOString(), new Date().toISOString());
    db.prepare('INSERT INTO assets(id,product_id,original_name,assigned_name,relative_path,mime_type,size_bytes,sort_order,sha256,playback_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('asset-1', 'product-1', 'photo.png', 'photo.png', relativePath, 'image/png', bytes.length, 1, hash, 'not_applicable', new Date().toISOString());
    db.close();
    cpSync(source, restored, { recursive: true });

    const verifier = path.resolve('scripts/verify-restore.mjs');
    const run = () => spawnSync(process.execPath, [verifier, restored], { encoding: 'utf8', timeout: 30000 });
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    assert.match(valid.stdout, /1 archivos registrados/);

    writeFileSync(path.join(restored, relativePath), Buffer.alloc(bytes.length, 0x44));
    const tampered = run();
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /Hash incorrecto del original/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
