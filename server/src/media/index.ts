import { randomBytes, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import type { OutgoingHttpHeaders } from 'node:http';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZipFile } from 'yazl';
import { absoluteDataPath } from '../assets/storage.js';
import { HttpError, objectBody } from '../http.js';

type MediaScope = 'content'|'thumbnail'|'download';
type Asset = { id: string; product_id: string; relative_path: string; assigned_name: string; mime_type: string; thumbnail_path: string|null; thumbnail_status: string };
export type MediaOptions = { dataDir: string; ticketTtlSeconds?: number; now?: () => number };
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const ticketPattern = /^[A-Za-z0-9_-]{43}$/;

function getAsset(db: Database.Database, id: string): Asset {
  const row = db.prepare('SELECT id, product_id, relative_path, assigned_name, mime_type, thumbnail_path, thumbnail_status FROM assets WHERE id = ?').get(id) as Asset | undefined;
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Archivo inexistente.');
  return row;
}

function rangeBounds(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new HttpError(416, 'RANGE_NOT_SATISFIABLE', 'Rango no disponible.');
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ((first !== undefined && !Number.isSafeInteger(first)) || (last !== undefined && !Number.isSafeInteger(last))) throw new HttpError(416, 'RANGE_NOT_SATISFIABLE', 'Rango no disponible.');
  const start = first ?? Math.max(0, size - (last ?? 0));
  const end = first === undefined ? size - 1 : last === undefined ? size - 1 : Math.min(last, size - 1);
  if (start >= size || end < start || (first === undefined && last === 0)) throw new HttpError(416, 'RANGE_NOT_SATISFIABLE', 'Rango no disponible.');
  return { start, end };
}

function attachment(name: string) {
  const cleaned = name.replace(/[\u0000-\u001f\u007f"\\/]/gu, '_');
  const ascii = cleaned.normalize('NFKD').replace(/[^\x20-\x7E]/gu, '_').replace(/[;\\]/gu, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
}

export function registerMedia(app: FastifyInstance, db: Database.Database, authenticate: (request: FastifyRequest) => Promise<void>, options: MediaOptions) {
  const now = options.now ?? Date.now;
  const ttl = options.ticketTtlSeconds ?? 300;
  async function authorize(request: FastifyRequest, assetId: string, scope: MediaScope) {
    const query = objectBody(request.query, ['ticket']);
    if (query.ticket === undefined) { await authenticate(request); return; }
    const token = query.ticket;
    if (typeof token !== 'string' || !ticketPattern.test(token)) throw new HttpError(401, 'TICKET_INVALID', 'Ticket inválido.');
    const ticket = db.prepare(`SELECT t.principal_kind, t.principal_key FROM media_tickets t
      WHERE t.token_hash = ? AND t.asset_id = ? AND t.scope = ? AND t.expires_at > ?`).get(tokenHash(token), assetId, scope, new Date(now()).toISOString()) as { principal_kind: 'session'|'device'; principal_key: string } | undefined;
    if (!ticket) throw new HttpError(401, 'TICKET_INVALID', 'Ticket inválido o expirado.');
    const valid = ticket.principal_kind === 'session'
      ? db.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?').get(ticket.principal_key, new Date(now()).toISOString())
      : db.prepare('SELECT 1 FROM devices WHERE id = ? AND revoked_at IS NULL').get(ticket.principal_key);
    if (!valid) throw new HttpError(401, 'TICKET_REVOKED', 'Ticket revocado.');
  }

  async function serve(request: FastifyRequest, reply: FastifyReply, scope: MediaScope, id: string) {
    await authorize(request, id, scope);
    const asset = getAsset(db, id);
    const relative = scope === 'thumbnail' ? asset.thumbnail_path : asset.relative_path;
    if (scope === 'thumbnail' && (!relative || asset.thumbnail_status !== 'ready')) throw new HttpError(404, 'PREVIEW_UNAVAILABLE', 'Vista previa no disponible.');
    const file = absoluteDataPath(options.dataDir, relative!);
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await handle.stat();
      if (!stat.isFile()) throw new HttpError(409, 'FILE_MISSING', 'Archivo no disponible.');
      const size = stat.size;
      reply.header('Accept-Ranges', 'bytes').header('Content-Type', scope === 'thumbnail' ? 'image/jpeg' : asset.mime_type)
        .header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer').header('X-Content-Type-Options', 'nosniff');
      if (scope === 'download') reply.header('Content-Disposition', attachment(asset.assigned_name));
      let bounds;
      try { bounds = rangeBounds(typeof request.headers.range === 'string' ? request.headers.range : undefined, size); }
      catch (error) {
        reply.header('Content-Range', `bytes */${size}`);
        throw error;
      }
      if (bounds) reply.code(206).header('Content-Range', `bytes ${bounds.start}-${bounds.end}/${size}`)
        .header('Content-Length', String(bounds.end - bounds.start + 1));
      else reply.header('Content-Length', String(size));
      if (request.method === 'HEAD') {
        await handle.close(); handle = undefined;
        reply.hijack();
        reply.raw.writeHead(reply.statusCode, reply.getHeaders() as OutgoingHttpHeaders);
        reply.raw.end();
        return reply;
      }
      const stream = handle.createReadStream(bounds ? { start: bounds.start, end: bounds.end, autoClose: true } : { autoClose: true });
      handle = undefined;
      return reply.send(stream);
    } catch (error) {
      if (handle) await handle.close();
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw new HttpError(409, 'FILE_MISSING', 'Archivo no disponible.');
      throw error;
    }
  }

  for (const scope of ['content','thumbnail','download'] as const) {
    app.get<{ Params: { id: string } }>(`/api/assets/:id/${scope}`, async (request, reply) => serve(request, reply, scope, request.params.id));
  }
  app.post<{ Params: { id: string } }>('/api/assets/:id/ticket', { onRequest: authenticate }, async request => {
    const body = objectBody(request.body, ['scope']);
    if (!['content','thumbnail','download'].includes(String(body.scope))) throw new HttpError(400, 'VALIDATION', 'Alcance de ticket no válido.');
    const scope = body.scope as MediaScope;
    const asset = getAsset(db, request.params.id);
    if (scope === 'thumbnail' && asset.thumbnail_status !== 'ready') throw new HttpError(404, 'PREVIEW_UNAVAILABLE', 'Vista previa no disponible.');
    const principal = request.identity;
    if (!principal) throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión.');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now() + ttl * 1000).toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM media_tickets WHERE expires_at <= ?').run(new Date(now()).toISOString());
      db.prepare('INSERT INTO media_tickets(token_hash, asset_id, scope, principal_kind, principal_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(tokenHash(token), asset.id, scope, principal.kind, principal.kind === 'session' ? principal.tokenHash : principal.id, expiresAt, new Date(now()).toISOString());
    })();
    return { url: `/api/assets/${asset.id}/${scope}?ticket=${token}`, expiresAt };
  });

  app.get<{ Params: { id: string } }>('/api/products/:id/download.zip', { onRequest: authenticate }, async (request, reply) => {
    const product = db.prepare('SELECT name FROM products WHERE id = ?').get(request.params.id) as { name: string } | undefined;
    if (!product) throw new HttpError(404, 'NOT_FOUND', 'Producto inexistente.');
    const rows = db.prepare('SELECT assigned_name, relative_path, size_bytes FROM assets WHERE product_id = ? ORDER BY sort_order, id').all(request.params.id) as { assigned_name:string; relative_path:string; size_bytes:number }[];
    const entries: Array<{ name: string; file: string; size: number }> = [];
    for (const row of rows) {
      const file = absoluteDataPath(options.dataDir, row.relative_path);
      try { const stats = await lstat(file); if (!stats.isFile() || stats.size !== row.size_bytes) throw new Error('MISSING'); }
      catch { throw new HttpError(409, 'FILE_MISSING', 'Hay archivos no disponibles; ZIP cancelado.'); }
      entries.push({ name: row.assigned_name, file, size: row.size_bytes });
    }
    const zip = new ZipFile();
    const active = new Set<Readable>();
    for (const entry of entries) {
      zip.addReadStreamLazy(entry.name, { size: entry.size, compress: false }, callback => {
        void open(entry.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).then(handle => {
          const input = handle.createReadStream({ autoClose: true });
          active.add(input);
          input.once('close', () => active.delete(input));
          callback(null, input);
        }).catch(error => callback(error, null as never));
      });
    }
    const output = zip.outputStream as Readable;
    output.once('error', () => reply.raw.destroy());
    reply.raw.once('close', () => { if (!reply.raw.writableFinished) { output.destroy(); for (const stream of active) stream.destroy(); } });
    zip.end();
    reply.header('Content-Type', 'application/zip').header('Content-Disposition', attachment(`${product.name}.zip`))
      .header('Cache-Control', 'private, no-store').header('Referrer-Policy', 'no-referrer');
    return reply.send(output);
  });
}
