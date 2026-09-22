import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, parameters, (error, result) => error ? reject(error) : resolve(result));
  });
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8 || password.length > 256) throw new Error('Usa una contraseña de 8 a 256 caracteres.');
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt-v1$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || password.length > 256) return false;
  return timingSafeEqual(await derive(password, Buffer.from(match[1], 'hex')), Buffer.from(match[2], 'hex'));
}
export async function configurePassword(db: Database.Database, password: string) {
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare('INSERT INTO personal_account(id, password_hash, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at').run(hash, new Date().toISOString());
    db.prepare('DELETE FROM sessions').run();
    db.prepare('UPDATE devices SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
    db.prepare('DELETE FROM pairing_codes').run();
  })();
}
