import { config } from './config.js';
import { openDatabase } from './db/index.js';
import { buildApp } from './app.js';
const db = openDatabase(config.dataDir, config.migrationsDir);
const app = await buildApp(db, config.webDir);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
try { await app.listen({ host: config.host, port: config.port }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
