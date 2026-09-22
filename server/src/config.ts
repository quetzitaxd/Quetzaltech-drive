import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as dotenv } from 'dotenv';
import type { AuthOptions } from './auth/index.js';
export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
dotenv({ path: path.join(projectRoot, '.env'), quiet: true });
function positiveInteger(value: string | undefined, fallback: number) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Configuración numérica inválida');
  return result;
}
const production = process.env.NODE_ENV === 'production';
function origin(value: string, requireHttps: boolean): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || (requireHttps && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('Configura un origen HTTP(S) válido, HTTPS en producción.');
  return parsed.origin;
}
export const authConfig: AuthOptions = {
  production,
  publicOrigin: origin(process.env.PUBLIC_URL ?? 'http://localhost:5173', production),
  androidOrigins: (process.env.ANDROID_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean).map(value => origin(value, false)),
  sessionTtlSeconds: positiveInteger(process.env.SESSION_TTL_SECONDS, 86400),
  pairingTtlSeconds: positiveInteger(process.env.PAIRING_TTL_SECONDS, 300),
};
export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: positiveInteger(process.env.PORT, 3000),
  dataDir: path.resolve(projectRoot, process.env.DATA_DIR ?? 'data'),
  webDir: path.join(projectRoot, 'web/dist'),
  migrationsDir: path.join(projectRoot, 'server/migrations'),
  maxFileBytes: positiveInteger(process.env.MAX_FILE_BYTES, 536870912),
};
