import multipart from '@fastify/multipart';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromFile } from 'file-type';
import { HttpError, objectBody, textField } from '../http.js';
import { absoluteDataPath, exists, moveNoReplace, storageError, unlinkIfExists, verifyFile } from './storage.js';

export type AssetOptions = {
  dataDir: string;
  maxFileBytes: number;
  createWriteStream?: (file: string) => NodeJS.WritableStream;
  onAssetCreated?: () => void;
};
type Attempt = {
  id: string; product_id: string; idempotency_key: string; state: 'receiving'|'complete'|'failed';
  request_fingerprint: string; asset_id: string|null; temp_path: string|null; original_name: string|null;
  expected_size: number|null; expected_sha256: string|null; reserved_sequence: number|null;
  pending_asset_id: string|null; assigned_name: string|null; detected_mime_type: string|null;
  final_relative_path: string|null; sort_order: number|null; tombstoned_at: string|null;
};
type Operation = {
  id: string; kind: 'rename'|'move'|'delete'; asset_id: string; source_relative_path: string;
  target_relative_path: string; target_product_id: string|null; target_assigned_name: string|null;
  target_sort_order: number|null; thumbnail_relative_path: string|null; state: 'prepared'|'fs_done'|'db_done';
};
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
  ['image/avif', 'avif'], ['image/heic', 'heic'], ['image/heif', 'heif'],
  ['video/mp4', 'mp4'], ['video/quicktime', 'mov'], ['video/webm', 'webm'],
]);
const selectAsset = `SELECT id, product_id AS productId, original_name AS originalName,
 assigned_name AS assignedName, mime_type AS mimeType, size_bytes AS sizeBytes,
 sort_order AS sortOrder, thumbnail_status AS thumbnailStatus, created_at AS createdAt,
 sha256, playback_status AS playbackStatus FROM assets`;
const getAttempt = (db: Database.Database, key: string) => db.prepare('SELECT * FROM upload_attempts WHERE idempotency_key = ?').get(key) as Attempt | undefined;

function safeOriginalName(value: string | undefined) {
  if (!value) throw new HttpError(400, 'VALIDATION', 'El archivo necesita un nombre.');
  const base = path.win32.basename(path.posix.basename(value)).normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  const result = Array.from(base).slice(0, 200).join('');
  if (!result || result === '.' || result === '..') throw new HttpError(400, 'VALIDATION', 'Nombre de archivo no válido.');
  return result;
}
function slug(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'archivo';
}
function requestedName(value: unknown, current: string) {
  const name = textField(value, 200);
  if (name !== path.posix.basename(name) || name !== path.win32.basename(name) || /[<>:"|?*]/u.test(name)) throw new HttpError(400, 'VALIDATION', 'Nombre de archivo no válido.');
  if (path.extname(name).toLowerCase() !== path.extname(current).toLowerCase()) throw new HttpError(400, 'VALIDATION', 'La extensión no puede cambiar.');
  return name;
}
function idempotencyKey(request: FastifyRequest) {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{16,128}$/u.test(value)) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key debe tener entre 16 y 128 caracteres seguros.');
  return value;
}
function uploadClaim(request: FastifyRequest, productId: string, maximum: number) {
  const hash = request.headers['x-file-sha256'];
  const sizeText = request.headers['x-file-size'];
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/u.test(hash) || typeof sizeText !== 'string' || !/^[1-9][0-9]*$/u.test(sizeText)) {
    throw new HttpError(400, 'FINGERPRINT_REQUIRED', 'Indica X-File-SHA256 y X-File-Size válidos.');
  }
  const size = Number(sizeText);
  if (!Number.isSafeInteger(size)) throw new HttpError(400, 'FINGERPRINT_REQUIRED', 'Tamaño no válido.');
  if (size > maximum) throw new HttpError(413, 'FILE_TOO_LARGE', 'El archivo supera el límite configurado.');
  return { hash, size, fingerprint: `${productId}:${size}:${hash}` };
}
function asset(db: Database.Database, id: string) {
  const row = db.prepare(`${selectAsset} WHERE id = ?`).get(id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Archivo inexistente.');
  return row;
}
function activeOperation(db: Database.Database, id: string) {
  if (db.prepare("SELECT 1 FROM asset_operations WHERE asset_id = ? AND state != 'db_done'").get(id)) throw new HttpError(409, 'ASSET_BUSY', 'El archivo tiene una operación pendiente.');
}
function pageValue(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) throw new HttpError(400, 'VALIDATION', 'Paginación no válida.');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > maximum) throw new HttpError(400, 'VALIDATION', 'Paginación no válida.');
  return result;
}

async function completeOperation(db: Database.Database, dataDir: string, operationId: string) {
  let operation = db.prepare('SELECT * FROM asset_operations WHERE id = ?').get(operationId) as Operation | undefined;
  if (!operation) return;
  const source = absoluteDataPath(dataDir, operation.source_relative_path);
  const target = absoluteDataPath(dataDir, operation.target_relative_path);
  if (operation.state === 'prepared') {
    await moveNoReplace(source, target);
    db.prepare("UPDATE asset_operations SET state = 'fs_done', updated_at = ? WHERE id = ?").run(new Date().toISOString(), operation.id);
    operation = { ...operation, state: 'fs_done' };
  }
  if (operation.state === 'fs_done') {
    db.transaction(() => {
      if (operation!.kind === 'delete') {
        db.prepare('UPDATE products SET cover_asset_id = NULL, updated_at = ? WHERE cover_asset_id = ?').run(new Date().toISOString(), operation!.asset_id);
        db.prepare('UPDATE upload_attempts SET tombstoned_at = ?, updated_at = ? WHERE asset_id = ?').run(new Date().toISOString(), new Date().toISOString(), operation!.asset_id);
        db.prepare('DELETE FROM assets WHERE id = ?').run(operation!.asset_id);
      } else {
        const before = db.prepare('SELECT product_id FROM assets WHERE id = ?').get(operation!.asset_id) as { product_id: string } | undefined;
        if (before) {
          db.prepare('UPDATE assets SET product_id = ?, assigned_name = ?, relative_path = ?, sort_order = ? WHERE id = ?').run(operation!.target_product_id, operation!.target_assigned_name, operation!.target_relative_path, operation!.target_sort_order, operation!.asset_id);
          if (operation!.kind === 'move') db.prepare('UPDATE products SET cover_asset_id = NULL, updated_at = ? WHERE id = ? AND cover_asset_id = ?').run(new Date().toISOString(), before.product_id, operation!.asset_id);
        }
      }
      db.prepare("UPDATE asset_operations SET state = 'db_done', updated_at = ? WHERE id = ?").run(new Date().toISOString(), operation!.id);
    })();
  }
  if (operation.kind === 'delete') {
    await unlinkIfExists(target);
    if (operation.thumbnail_relative_path) await unlinkIfExists(absoluteDataPath(dataDir, operation.thumbnail_relative_path));
  }
  db.prepare('DELETE FROM asset_operations WHERE id = ?').run(operation.id);
}

async function recoverUploads(db: Database.Database, options: AssetOptions) {
  const attempts = db.prepare("SELECT * FROM upload_attempts WHERE state = 'receiving'").all() as Attempt[];
  for (const attempt of attempts) {
    const temp = attempt.temp_path ? absoluteDataPath(options.dataDir, attempt.temp_path) : null;
    const final = attempt.final_relative_path ? absoluteDataPath(options.dataDir, attempt.final_relative_path) : null;
    try {
      if (final && attempt.expected_size && attempt.expected_sha256 && await exists(final) && await verifyFile(final, attempt.expected_size, attempt.expected_sha256) && attempt.pending_asset_id && attempt.assigned_name && attempt.detected_mime_type && attempt.original_name && attempt.sort_order !== null) {
        db.transaction(() => {
          db.prepare('INSERT OR IGNORE INTO assets(id, product_id, original_name, assigned_name, relative_path, mime_type, size_bytes, sort_order, sha256, playback_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(attempt.pending_asset_id, attempt.product_id, attempt.original_name, attempt.assigned_name, attempt.final_relative_path, attempt.detected_mime_type, attempt.expected_size, attempt.sort_order, attempt.expected_sha256, attempt.detected_mime_type!.startsWith('video/') ? 'pending' : 'not_applicable', new Date().toISOString());
          db.prepare("UPDATE upload_attempts SET state = 'complete', asset_id = pending_asset_id, completed_at = ?, temp_path = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), new Date().toISOString(), attempt.id);
          const kind = attempt.detected_mime_type!.startsWith('video/') ? 'poster' : 'thumbnail';
          db.prepare("INSERT OR IGNORE INTO jobs(id, asset_id, kind, state, updated_at) VALUES (?, ?, ?, 'pending', ?)").run(randomUUID(), attempt.pending_asset_id, kind, new Date().toISOString());
        })();
        if (temp) await unlinkIfExists(temp);
      } else {
        if (temp) await unlinkIfExists(temp);
        db.prepare("UPDATE upload_attempts SET state = 'failed', last_error_code = 'INTERRUPTED', temp_path = NULL, final_relative_path = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), attempt.id);
      }
    } catch (error) { throw storageError(error); }
  }
}

export async function recoverAssetStorage(db: Database.Database, options: AssetOptions) {
  await mkdir(path.join(options.dataDir, 'tmp', 'trash'), { recursive: true });
  const operations = db.prepare('SELECT id FROM asset_operations ORDER BY created_at, id').all() as { id: string }[];
  for (const operation of operations) await completeOperation(db, options.dataDir, operation.id);
  await recoverUploads(db, options);
}

export async function registerAssets(app: FastifyInstance, db: Database.Database, authenticate: (request: FastifyRequest) => Promise<void>, options: AssetOptions) {
  await recoverAssetStorage(db, options);
  await app.register(multipart, { limits: { files: 1, fields: 0, fileSize: options.maxFileBytes, parts: 1 } });
  const access = { onRequest: authenticate };
  const uploadAccess = { onRequest: authenticate, bodyLimit: Math.min(Number.MAX_SAFE_INTEGER, options.maxFileBytes + 1024 * 1024) };

  app.get<{ Params: { id: string } }>('/api/products/:id/assets', access, async request => {
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(request.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
    const query = objectBody(request.query, ['page', 'pageSize']);
    const page = pageValue(query.page, 1, 1_000_000); const pageSize = pageValue(query.pageSize, 100, 100);
    return {
      items: db.prepare(`${selectAsset} WHERE product_id = ? ORDER BY sort_order, id LIMIT ? OFFSET ?`).all(request.params.id, pageSize, (page - 1) * pageSize),
      total: (db.prepare('SELECT COUNT(*) AS n FROM assets WHERE product_id = ?').get(request.params.id) as {n:number}).n,
      page, pageSize,
    };
  });

  app.post<{ Params: { id: string } }>('/api/products/:id/assets', uploadAccess, async (request, reply) => {
    const key = idempotencyKey(request);
    const claim = uploadClaim(request, request.params.id, options.maxFileBytes);
    const tempRelative = `tmp/${randomUUID()}.upload`;
    const reservation = db.transaction(() => {
      const existing = getAttempt(db, key);
      if (existing) {
        if (existing.request_fingerprint !== claim.fingerprint) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'La clave ya pertenece a otro archivo o producto.');
        if (existing.tombstoned_at) throw new HttpError(410, 'UPLOAD_RESULT_DELETED', 'El archivo de este intento fue eliminado.');
        if (existing.state === 'complete' && existing.asset_id) return { replay: asset(db, existing.asset_id), attempt: existing };
        if (existing.state === 'receiving') throw new HttpError(409, 'UPLOAD_IN_PROGRESS', 'La subida ya está en curso.');
        db.prepare("UPDATE upload_attempts SET state = 'receiving', temp_path = ?, final_relative_path = NULL, assigned_name = NULL, detected_mime_type = NULL, original_name = NULL, last_error_code = NULL, updated_at = ? WHERE id = ?").run(tempRelative, new Date().toISOString(), existing.id);
        return { attempt: { ...existing, state: 'receiving' as const, temp_path: tempRelative } };
      }
      const product = db.prepare('SELECT id, next_sequence FROM products WHERE id = ?').get(request.params.id) as { id: string; next_sequence: number } | undefined;
      if (!product) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
      const attempt: Attempt = {
        id: randomUUID(), product_id: product.id, idempotency_key: key, state: 'receiving', request_fingerprint: claim.fingerprint,
        asset_id: null, temp_path: tempRelative, original_name: null, expected_size: claim.size, expected_sha256: claim.hash,
        reserved_sequence: product.next_sequence, pending_asset_id: randomUUID(), assigned_name: null, detected_mime_type: null,
        final_relative_path: null, sort_order: product.next_sequence, tombstoned_at: null,
      };
      db.prepare('UPDATE products SET next_sequence = next_sequence + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), product.id);
      db.prepare(`INSERT INTO upload_attempts(id, product_id, idempotency_key, state, request_fingerprint, temp_path, updated_at,
        expected_size, expected_sha256, reserved_sequence, pending_asset_id, sort_order) VALUES (?, ?, ?, 'receiving', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        attempt.id, attempt.product_id, key, claim.fingerprint, tempRelative, new Date().toISOString(), claim.size, claim.hash, attempt.reserved_sequence, attempt.pending_asset_id, attempt.sort_order);
      return { attempt };
    })();
    if ('replay' in reservation) { request.raw.resume(); return reservation.replay; }
    const attempt = reservation.attempt;
    const temp = absoluteDataPath(options.dataDir, tempRelative);
    await mkdir(path.dirname(temp), { recursive: true });
    let linked = false;
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.raw.once('aborted', onAbort);
    try {
      let count = 0;
      let originalName = '';
      const hash = createHash('sha256');
      for await (const part of request.parts({ limits: { files: 1, fields: 0, fileSize: options.maxFileBytes, parts: 1 } })) {
        if (part.type !== 'file' || count++) throw new HttpError(400, 'ONE_FILE_REQUIRED', 'Envía exactamente un archivo.');
        originalName = safeOriginalName(part.filename);
        let bytes = 0;
        const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { bytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
        const writer = options.createWriteStream ? options.createWriteStream(temp) : createWriteStream(temp, { flags: 'wx' });
        await pipeline(part.file, meter, writer, { signal: abort.signal });
        if (part.file.truncated || bytes > options.maxFileBytes) throw new HttpError(413, 'FILE_TOO_LARGE', 'El archivo supera el límite configurado.');
        if (bytes !== claim.size || hash.digest('hex') !== claim.hash) throw new HttpError(409, 'FINGERPRINT_MISMATCH', 'El tamaño o hash no coincide con lo declarado.');
      }
      if (count !== 1) throw new HttpError(400, 'ONE_FILE_REQUIRED', 'Envía exactamente un archivo.');
      const detected = await fileTypeFromFile(temp);
      const extension = detected && allowedTypes.get(detected.mime);
      if (!detected || !extension) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'El formato del archivo no está permitido.');
      const product = db.prepare('SELECT name, storage_key FROM products WHERE id = ?').get(attempt.product_id) as { name: string; storage_key: string } | undefined;
      if (!product) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
      const assignedName = `${slug(product.name)}-${String(attempt.reserved_sequence).padStart(3, '0')}.${extension}`;
      const finalRelative = `originals/${product.storage_key}/${assignedName}`;
      db.prepare('UPDATE upload_attempts SET original_name = ?, assigned_name = ?, detected_mime_type = ?, final_relative_path = ?, updated_at = ? WHERE id = ?').run(originalName, assignedName, detected.mime, finalRelative, new Date().toISOString(), attempt.id);
      await moveNoReplace(temp, absoluteDataPath(options.dataDir, finalRelative));
      linked = true;
      db.transaction(() => {
        db.prepare('INSERT INTO assets(id, product_id, original_name, assigned_name, relative_path, mime_type, size_bytes, sort_order, sha256, playback_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(attempt.pending_asset_id, attempt.product_id, originalName, assignedName, finalRelative, detected.mime, claim.size, attempt.sort_order, claim.hash, detected.mime.startsWith('video/') ? 'pending' : 'not_applicable', new Date().toISOString());
        db.prepare("UPDATE upload_attempts SET state = 'complete', asset_id = pending_asset_id, temp_path = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND state = 'receiving'").run(new Date().toISOString(), new Date().toISOString(), attempt.id);
        db.prepare("INSERT INTO jobs(id, asset_id, kind, state, updated_at) VALUES (?, ?, ?, 'pending', ?)").run(randomUUID(), attempt.pending_asset_id, detected.mime.startsWith('video/') ? 'poster' : 'thumbnail', new Date().toISOString());
      })();
      reply.code(201).header('Location', `/api/assets/${attempt.pending_asset_id}`);
      options.onAssetCreated?.();
      return asset(db, attempt.pending_asset_id!);
    } catch (error) {
      if (!linked) {
        await unlinkIfExists(temp).catch(() => undefined);
        db.prepare("UPDATE upload_attempts SET state = 'failed', temp_path = NULL, final_relative_path = NULL, last_error_code = ?, updated_at = ? WHERE id = ? AND state = 'receiving'").run((error as NodeJS.ErrnoException)?.code ?? (error instanceof HttpError ? error.code : 'STORAGE_ERROR'), new Date().toISOString(), attempt.id);
      }
      const multipartCode = (error as { code?: string })?.code;
      if (multipartCode === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'FILE_TOO_LARGE', 'El archivo supera el límite configurado.');
      if (multipartCode?.includes('LIMIT')) throw new HttpError(400, 'ONE_FILE_REQUIRED', 'Envía exactamente un archivo.');
      if (multipartCode?.startsWith('FST_')) throw new HttpError(400, 'MULTIPART_INVALID', 'La solicitud multipart no es válida.');
      throw storageError(error);
    } finally { request.raw.off('aborted', onAbort); }
  });

  app.patch<{ Params: { id: string } }>('/api/assets/:id', access, async request => {
    const body = objectBody(request.body, ['name']);
    const current = db.prepare('SELECT id, product_id, assigned_name, relative_path, sort_order FROM assets WHERE id = ?').get(request.params.id) as { id:string; product_id:string; assigned_name:string; relative_path:string; sort_order:number } | undefined;
    if (!current) throw new HttpError(404, 'NOT_FOUND', 'Archivo inexistente.');
    activeOperation(db, current.id);
    const name = requestedName(body.name, current.assigned_name);
    if (name === current.assigned_name) return asset(db, current.id);
    const target = path.posix.join(path.posix.dirname(current.relative_path), name);
    if (db.prepare('SELECT 1 FROM assets WHERE relative_path = ? OR (product_id = ? AND assigned_name = ?)').get(target, current.product_id, name)) throw new HttpError(409, 'FILE_NAME_CONFLICT', 'Ya existe un archivo con ese nombre.');
    const id = randomUUID(); const timestamp = new Date().toISOString();
    db.prepare("INSERT INTO asset_operations(id, kind, asset_id, source_relative_path, target_relative_path, target_product_id, target_assigned_name, target_sort_order, created_at, updated_at) VALUES (?, 'rename', ?, ?, ?, ?, ?, ?, ?, ?)").run(id, current.id, current.relative_path, target, current.product_id, name, current.sort_order, timestamp, timestamp);
    await completeOperation(db, options.dataDir, id).catch(error => { throw storageError(error); });
    return asset(db, current.id);
  });

  app.post<{ Params: { id: string } }>('/api/products/:id/order', access, async request => {
    const body = objectBody(request.body, ['assetIds']);
    if (!Array.isArray(body.assetIds) || body.assetIds.some(id => typeof id !== 'string') || new Set(body.assetIds).size !== body.assetIds.length) throw new HttpError(400, 'VALIDATION', 'Lista de archivos no válida.');
    if (!db.prepare('SELECT 1 FROM products WHERE id = ?').get(request.params.id)) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
    const current = db.prepare('SELECT id FROM assets WHERE product_id = ? ORDER BY id').all(request.params.id) as { id: string }[];
    const expected = new Set(current.map(row => row.id));
    if (body.assetIds.length !== expected.size || body.assetIds.some(id => !expected.has(id as string))) throw new HttpError(400, 'ORDER_SET_MISMATCH', 'El orden debe incluir exactamente los archivos del producto.');
    db.transaction(() => (body.assetIds as string[]).forEach((id, index) => db.prepare('UPDATE assets SET sort_order = ? WHERE id = ?').run(index, id)))();
    return { items: db.prepare(`${selectAsset} WHERE product_id = ? ORDER BY sort_order, id`).all(request.params.id) };
  });

  app.post('/api/assets/move', access, async request => {
    const body = objectBody(request.body, ['assetIds', 'targetProductId']);
    const targetId = textField(body.targetProductId, 100);
    if (!Array.isArray(body.assetIds) || !body.assetIds.length || body.assetIds.length > 100 || body.assetIds.some(id => typeof id !== 'string') || new Set(body.assetIds).size !== body.assetIds.length) throw new HttpError(400, 'VALIDATION', 'Lista de archivos no válida.');
    const operations = db.transaction(() => {
      const target = db.prepare('SELECT name, storage_key, next_sequence FROM products WHERE id = ?').get(targetId) as { name:string; storage_key:string; next_sequence:number } | undefined;
      if (!target) throw new HttpError(404, 'NOT_FOUND', 'Producto destino inexistente.');
      const created: string[] = [];
      for (const assetId of body.assetIds as string[]) {
        const current = db.prepare('SELECT id, product_id, assigned_name, relative_path FROM assets WHERE id = ?').get(assetId) as { id:string; product_id:string; assigned_name:string; relative_path:string } | undefined;
        if (!current) throw new HttpError(404, 'NOT_FOUND', 'Archivo inexistente.');
        if (current.product_id === targetId) throw new HttpError(400, 'SAME_PRODUCT', 'El archivo ya pertenece al producto destino.');
        activeOperation(db, current.id);
        const sequence = target.next_sequence + created.length;
        const name = `${slug(target.name)}-${String(sequence).padStart(3, '0')}${path.extname(current.assigned_name).toLowerCase()}`;
        const relative = `originals/${target.storage_key}/${name}`;
        const operationId = randomUUID(); const timestamp = new Date().toISOString();
        db.prepare("INSERT INTO asset_operations(id, kind, asset_id, source_relative_path, target_relative_path, target_product_id, target_assigned_name, target_sort_order, created_at, updated_at) VALUES (?, 'move', ?, ?, ?, ?, ?, ?, ?, ?)").run(operationId, current.id, current.relative_path, relative, targetId, name, sequence, timestamp, timestamp);
        created.push(operationId);
      }
      db.prepare('UPDATE products SET next_sequence = next_sequence + ?, updated_at = ? WHERE id = ?').run(created.length, new Date().toISOString(), targetId);
      return created;
    })();
    for (const id of operations) await completeOperation(db, options.dataDir, id).catch(error => { throw storageError(error); });
    return { items: (body.assetIds as string[]).map(id => asset(db, id)) };
  });

  async function deleteAssets(ids: string[]) {
    const operations = db.transaction(() => ids.map(assetId => {
      const current = db.prepare('SELECT id, relative_path, thumbnail_path FROM assets WHERE id = ?').get(assetId) as { id:string; relative_path:string; thumbnail_path:string|null } | undefined;
      if (!current) throw new HttpError(404, 'NOT_FOUND', 'Archivo inexistente.');
      activeOperation(db, current.id);
      const operationId = randomUUID(); const timestamp = new Date().toISOString();
      const trash = `tmp/trash/${operationId}-${path.posix.basename(current.relative_path)}`;
      db.prepare("INSERT INTO asset_operations(id, kind, asset_id, source_relative_path, target_relative_path, thumbnail_relative_path, created_at, updated_at) VALUES (?, 'delete', ?, ?, ?, ?, ?, ?)").run(operationId, current.id, current.relative_path, trash, current.thumbnail_path, timestamp, timestamp);
      return { operationId, assetId };
    }))();
    const deletedIds: string[] = []; const pendingIds: string[] = [];
    let firstError: HttpError | undefined;
    for (const operation of operations) {
      try { await completeOperation(db, options.dataDir, operation.operationId); deletedIds.push(operation.assetId); }
      catch (error) { pendingIds.push(operation.assetId); firstError ??= storageError(error); }
    }
    return { deletedIds, pendingIds, firstError };
  }
  app.delete<{ Params: { id: string } }>('/api/assets/:id', access, async (request, reply) => {
    const result = await deleteAssets([request.params.id]);
    if (result.firstError) throw result.firstError;
    reply.code(204).send();
  });
  app.post('/api/assets/batch-delete', access, async (request, reply) => {
    const body = objectBody(request.body, ['assetIds']);
    if (!Array.isArray(body.assetIds) || !body.assetIds.length || body.assetIds.length > 100 || body.assetIds.some(id => typeof id !== 'string') || new Set(body.assetIds).size !== body.assetIds.length) throw new HttpError(400, 'VALIDATION', 'Lista de archivos no válida.');
    const result = await deleteAssets(body.assetIds as string[]);
    if (result.firstError) return reply.code(500).send({ error: { code: 'PARTIAL_DELETE', message: 'Algunos archivos quedan pendientes de recuperación.' }, deletedIds: result.deletedIds, pendingIds: result.pendingIds });
    return { deletedIds: result.deletedIds, pendingIds: [] };
  });
}
