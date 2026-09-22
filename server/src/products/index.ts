import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, objectBody, textField } from '../http.js';

const selectProduct = `SELECT p.id, p.name, p.code, p.cover_asset_id AS coverAssetId,
 p.created_at AS createdAt, p.updated_at AS updatedAt,
 (SELECT COUNT(*) FROM assets a WHERE a.product_id = p.id) AS assetCount FROM products p`;
function optionalCode(value: unknown): string | null {
  return value === null ? null : textField(value, 100, false) || null;
}
function pageNumber(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw new HttpError(400, 'VALIDATION', 'Paginación no válida.');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > max) throw new HttpError(400, 'VALIDATION', 'Paginación no válida.');
  return number;
}
export function registerProducts(app: FastifyInstance, db: Database.Database, authenticate: (request: FastifyRequest) => Promise<void>) {
  const access = { onRequest: authenticate };
  function get(id: string) {
    const product = db.prepare(`${selectProduct} WHERE p.id = ?`).get(id);
    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
    return product;
  }
  app.get('/api/products', access, async request => {
    const query = objectBody(request.query, ['q', 'page', 'pageSize']);
    const page = pageNumber(query.page, 1, 1_000_000);
    const pageSize = pageNumber(query.pageSize, 24, 100);
    const q = query.q === undefined ? '' : textField(query.q, 200, false);
    const search = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const where = " WHERE (p.name LIKE ? ESCAPE '\\' OR COALESCE(p.code, '') LIKE ? ESCAPE '\\')";
    return db.transaction(() => ({
      items: db.prepare(`${selectProduct}${where} ORDER BY p.created_at DESC, p.id LIMIT ? OFFSET ?`).all(search, search, pageSize, (page - 1) * pageSize),
      total: (db.prepare(`SELECT COUNT(*) AS n FROM products p${where}`).get(search, search) as { n: number }).n,
      page, pageSize,
    }))();
  });
  app.get<{ Params: { id: string } }>('/api/products/:id', access, async request => get(request.params.id));
  app.post('/api/products', access, async (request, reply) => {
    const body = objectBody(request.body, ['name', 'code']);
    const name = textField(body.name, 200);
    const code = body.code === undefined ? null : optionalCode(body.code);
    const id = randomUUID();
    const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'producto';
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO products(id, name, code, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, name, code, `${id}-${slug}`, timestamp, timestamp);
    reply.code(201).header('Location', `/api/products/${id}`);
    return get(id);
  });
  app.patch<{ Params: { id: string } }>('/api/products/:id', access, async request => {
    const body = objectBody(request.body, ['name', 'code', 'coverAssetId']);
    if (!Object.keys(body).length) throw new HttpError(400, 'VALIDATION', 'Indica al menos un cambio.');
    const name = body.name === undefined ? undefined : textField(body.name, 200);
    const code = body.code === undefined ? undefined : optionalCode(body.code);
    const cover = body.coverAssetId === undefined ? undefined : body.coverAssetId === null ? null : textField(body.coverAssetId, 100);
    return db.transaction(() => {
      get(request.params.id);
      if (cover && !db.prepare('SELECT 1 FROM assets WHERE id = ? AND product_id = ?').get(cover, request.params.id)) {
        throw new HttpError(400, 'COVER_INVALID', 'La portada debe pertenecer a este producto.');
      }
      if (name !== undefined) db.prepare('UPDATE products SET name = ? WHERE id = ?').run(name, request.params.id);
      if (code !== undefined) db.prepare('UPDATE products SET code = ? WHERE id = ?').run(code, request.params.id);
      if (cover !== undefined) db.prepare('UPDATE products SET cover_asset_id = ? WHERE id = ?').run(cover, request.params.id);
      db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), request.params.id);
      return get(request.params.id);
    })();
  });
  app.delete<{ Params: { id: string } }>('/api/products/:id', access, async (request, reply) => {
    const body = objectBody(request.body, ['confirm']);
    if (body.confirm !== request.params.id) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Confirma el identificador del producto.');
    db.transaction(() => {
      get(request.params.id);
      if (db.prepare("SELECT 1 FROM assets WHERE product_id = ? UNION ALL SELECT 1 FROM upload_attempts WHERE product_id = ? AND (state = 'receiving' OR (state = 'complete' AND tombstoned_at IS NULL)) LIMIT 1").get(request.params.id, request.params.id)) {
        throw new HttpError(409, 'PRODUCT_NOT_EMPTY', 'El borrado de productos con archivos o intentos de subida está pendiente de implementación.');
      }
      db.prepare('DELETE FROM products WHERE id = ?').run(request.params.id);
    })();
    reply.code(204).send();
  });
}
