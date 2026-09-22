import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http.js';

export function absoluteDataPath(dataDir: string, relativePath: string) {
  if (!relativePath || relativePath.includes('\\') || path.posix.isAbsolute(relativePath) || relativePath.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Ruta de datos inválida en la base.');
  }
  const root = path.resolve(dataDir);
  const result = path.resolve(root, ...relativePath.split('/'));
  if (!result.startsWith(`${root}${path.sep}`)) throw new Error('Ruta fuera del volumen de datos.');
  return result;
}

export async function exists(file: string) {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

export async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function unlinkIfExists(file: string) {
  try { await unlink(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

// Hard-link + unlink never exposes partial bytes and never overwrites a target.
export async function moveNoReplace(source: string, target: string) {
  await mkdir(path.dirname(target), { recursive: true });
  const resolvedSource = path.resolve(source); const resolvedTarget = path.resolve(target);
  if (resolvedSource === resolvedTarget) return;
  if (process.platform === 'win32' && resolvedSource.toLowerCase() === resolvedTarget.toLowerCase()) {
    await rename(source, target);
    return;
  }
  const sourceExists = await exists(source);
  const targetExists = await exists(target);
  if (sourceExists && targetExists) {
    const [sourceStat, targetStat] = await Promise.all([lstat(source), lstat(target)]);
    if (sourceStat.size !== targetStat.size || await sha256File(source) !== await sha256File(target)) {
      throw new HttpError(409, 'FILE_COLLISION', 'El destino ya existe y no coincide.');
    }
    await unlink(source);
    return;
  }
  if (!sourceExists && targetExists) return;
  if (!sourceExists) throw new Error('No existe el archivo de origen.');
  try { await link(source, target); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new HttpError(409, 'FILE_COLLISION', 'El destino ya existe.');
    throw error;
  }
  await unlink(source);
}

export function storageError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return new HttpError(507, 'INSUFFICIENT_STORAGE', 'No hay espacio suficiente para guardar el archivo.');
  if (code === 'ABORT_ERR' || code === 'ECONNRESET' || code === 'EPIPE' || code === 'ERR_STREAM_PREMATURE_CLOSE') return new HttpError(400, 'UPLOAD_INTERRUPTED', 'La subida se interrumpió.');
  return new HttpError(500, 'STORAGE_ERROR', 'No se pudo completar la operación de almacenamiento.');
}

export async function verifyFile(file: string, expectedSize: number, expectedSha256: string) {
  const stat = await lstat(file);
  return stat.isFile() && stat.size === expectedSize && await sha256File(file) === expectedSha256;
}
