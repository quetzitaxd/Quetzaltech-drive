import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const entry = fileURLToPath(new URL('../server/dist/auth/setup.js', import.meta.url));
if (!existsSync(entry)) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npm, ['run', 'build', '-w', 'server'], { stdio: 'inherit' });
  if (build.error || build.status !== 0) process.exit(build.status ?? 1);
}
await import(pathToFileURL(entry).href);
