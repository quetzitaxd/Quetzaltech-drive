import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(dataDir: string, migrationsDir: string) {
  for (const dir of ['', 'originals', 'thumbnails', 'tmp']) mkdirSync(path.join(dataDir, dir), { recursive: true });
  const db = new Database(path.join(dataDir, 'drive.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const apply = db.transaction((name: string, sql: string) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(name);
  });
  try {
    for (const name of readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort()) {
      if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name = ?').get(name)) apply(name, readFileSync(path.join(migrationsDir, name), 'utf8'));
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
