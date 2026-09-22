import { emitKeypressEvents } from 'node:readline';
import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { configurePassword } from './password.js';

function hiddenInput(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY) throw new Error('Ejecuta este comando en una terminal interactiva.');
  process.stdout.write(prompt);
  emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.removeListener('keypress', keypress);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
      value = '';
    };
    const keypress = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(new Error('Configuración cancelada.'));
      if (key.name === 'return') return finish();
      if (key.name === 'backspace') { value = Array.from(value).slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/u.test(text) && value.length + text.length <= 256) value += text;
    };
    input.on('keypress', keypress);
  });
}

try {
  if (process.argv.length > 2) throw new Error('No se aceptan argumentos. La contraseña se pide sin eco en la terminal.');
  process.stdout.write('Configurar la cuenta personal revoca sesiones, dispositivos y códigos previos.\n');
  let password = await hiddenInput('Nueva contraseña (8–256 caracteres): ');
  let confirmation = await hiddenInput('Repite la contraseña: ');
  if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
  const db = openDatabase(config.dataDir, config.migrationsDir);
  try { await configurePassword(db, password); }
  finally { password = ''; confirmation = ''; db.close(); }
  process.stdout.write('Cuenta personal configurada.\n');
} catch (error) {
  // No imprimir objetos de error que puedan incluir detalles de SQLite o entradas.
  const safe = error instanceof Error && /^(Usa una contraseña|Ejecuta este comando|Configuración cancelada|No se aceptan argumentos|Las contraseñas no coinciden)/.test(error.message);
  process.stderr.write(`${safe ? (error as Error).message : 'No se pudo configurar la cuenta.'}\n`);
  process.exitCode = 1;
}
