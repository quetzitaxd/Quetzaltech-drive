import { createHash } from 'node:crypto';
import { createReadStream, existsSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDatabase } from '../server/dist/db/index.js';
import { buildApp } from '../server/dist/app.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dataDir = path.resolve(process.argv[2] ?? '');
async function fileSha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
if (dataDir === path.parse(dataDir).root || !existsSync(path.join(dataDir, 'drive.sqlite'))) {
  throw new Error('Se requiere un directorio de datos aislado con drive.sqlite.');
}
const rootReal = realpathSync(dataDir);
const dbPath = path.join(rootReal, 'drive.sqlite');
const readOnly = new Database(dbPath, { readonly: true, fileMustExist: true });
let assetCount = 0;
try {
  const integrity = readOnly.pragma('integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('SQLite no pasó integrity_check.');
  const foreignKeys = readOnly.pragma('foreign_key_check');
  if (foreignKeys.length) throw new Error('SQLite contiene referencias foráneas inválidas.');
  const assets = readOnly.prepare('SELECT id, relative_path, size_bytes, sha256, thumbnail_path FROM assets').all();
  assetCount = assets.length;
  for (const asset of assets) {
    for (const [relativePath, expectedHash, expectedSize] of [
      [asset.relative_path, asset.sha256, asset.size_bytes],
      [asset.thumbnail_path, null, null],
    ]) {
      if (!relativePath) continue;
      const candidate = path.resolve(rootReal, relativePath);
      if (candidate !== rootReal && !candidate.startsWith(`${rootReal}${path.sep}`)) throw new Error(`Ruta de medio fuera de data (${asset.id}).`);
      const stat = lstatSync(candidate);
      const resolved = realpathSync(candidate);
      if (!resolved.startsWith(`${rootReal}${path.sep}`) || !stat.isFile()) throw new Error(`Medio ausente o no regular (${asset.id}).`);
      if (expectedSize !== null && stat.size !== expectedSize) throw new Error(`Tamaño incorrecto del original (${asset.id}).`);
      if (expectedHash && await fileSha256(candidate) !== expectedHash) throw new Error(`Hash incorrecto del original (${asset.id}).`);
    }
  }
} finally { readOnly.close(); }

// Open only the isolated copy and exercise the built app over loopback.
const db = openDatabase(rootReal, path.join(projectRoot, 'server/migrations'));
const app = await buildApp(db, path.join(projectRoot, 'web/dist'), {
  production: false,
  publicOrigin: 'http://127.0.0.1',
  androidOrigins: [],
  sessionTtlSeconds: 3600,
  pairingTtlSeconds: 300,
}, { dataDir: rootReal, maxFileBytes: 536870912 });
try {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const health = await fetch(`${address}/api/health`);
  if (!health.ok || (await health.json()).status !== 'ok') throw new Error('La app no pasó /api/health con la copia aislada.');
  const protectedRoute = await fetch(`${address}/api/products`);
  if (![401, 503].includes(protectedRoute.status)) throw new Error('La ruta privada no mantuvo el acceso cerrado en la copia aislada.');
} finally { await app.close(); }
console.log(`Copia verificada: SQLite íntegro, ${assetCount} archivos registrados y app iniciada aisladamente.`);
