import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type Database from 'better-sqlite3';
import { absoluteDataPath, moveNoReplace, unlinkIfExists } from '../assets/storage.js';

type Job = { id: string; asset_id: string; kind: 'thumbnail'|'poster'; attempts: number };
type Asset = { id: string; relative_path: string; mime_type: string };
export type JobOptions = { dataDir: string; ffmpegPath?: string; ffprobePath?: string; ffmpegTimeoutMs?: number; maxAttempts?: number };

async function poster(input: string, output: string, ffmpegPath: string, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const args = ['-hide_banner','-loglevel','error','-nostdin','-i',input,'-frames:v','1','-vf','scale=640:-2','-q:v','4','-y',output];
    const child = spawn(ffmpegPath, args, { shell: false, stdio: ['ignore','ignore','ignore'], windowsHide: true });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('FFMPEG_TIMEOUT')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('FFMPEG_FAILED')); });
  });
}

async function playable(input: string, mime: string, ffprobePath: string, timeoutMs: number): Promise<boolean> {
  if (mime === 'video/quicktime') return false;
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn(ffprobePath, ['-v','error','-show_entries','stream=codec_type,codec_name','-of','json',input],
      { shell: false, stdio: ['ignore','pipe','ignore'], windowsHide: true });
    let output = '';
    child.stdout?.on('data', chunk => { output += String(chunk); if (output.length > 8192) child.kill('SIGKILL'); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('FFPROBE_TIMEOUT')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || output.length > 8192) return reject(new Error('FFPROBE_FAILED'));
      try {
        const streams = (JSON.parse(output) as { streams?: Array<{codec_type:string; codec_name:string}> }).streams ?? [];
        const video = streams.find(stream => stream.codec_type === 'video');
        const audio = streams.filter(stream => stream.codec_type === 'audio');
        const videoOk = mime === 'video/mp4' ? video?.codec_name === 'h264' : mime === 'video/webm' && ['vp8','vp9','av1'].includes(video?.codec_name ?? '');
        const audioOk = audio.every(stream => mime === 'video/mp4' ? stream.codec_name === 'aac' : ['opus','vorbis'].includes(stream.codec_name));
        resolve(Boolean(videoOk && audioOk));
      } catch (error) { reject(error); }
    });
  });
}

export class DerivativeWorker {
  private running = false;
  private closed = false;
  private timer: NodeJS.Timeout | undefined;
  private idleWaiters: Array<() => void> = [];
  private current: Promise<void> | undefined;
  private readonly maxAttempts: number;
  constructor(private db: Database.Database, private options: JobOptions) {
    this.maxAttempts = options.maxAttempts ?? 3;
    db.transaction(() => {
      db.prepare("UPDATE jobs SET state = 'pending', updated_at = ? WHERE state = 'running' AND attempts < ?").run(new Date().toISOString(), this.maxAttempts);
      db.prepare("UPDATE jobs SET state = 'failed', last_error = 'RETRY_LIMIT', updated_at = ? WHERE state IN ('running','pending') AND attempts >= ?").run(new Date().toISOString(), this.maxAttempts);
      db.prepare("UPDATE assets SET thumbnail_status = 'failed' WHERE id IN (SELECT asset_id FROM jobs WHERE state = 'failed' AND last_error = 'RETRY_LIMIT')").run();
      db.prepare("UPDATE assets SET playback_status = 'download_only' WHERE id IN (SELECT asset_id FROM jobs WHERE state = 'failed' AND kind = 'poster')").run();
    })();
    this.wake();
  }
  wake() {
    if (this.closed || this.running || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.current = this.drain(); }, 0);
    this.timer.unref();
  }
  private claim(): Job | undefined {
    return this.db.transaction(() => {
      const job = this.db.prepare("SELECT id, asset_id, kind, attempts FROM jobs WHERE state = 'pending' AND attempts < ? ORDER BY updated_at, id LIMIT 1").get(this.maxAttempts) as Job | undefined;
      if (job) this.db.prepare("UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
      return job;
    })();
  }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      for (let job = this.claim(); job; job = this.claim()) {
        await this.run(job);
        if (this.closed) break;
      }
    } finally {
      this.running = false;
      this.idleWaiters.splice(0).forEach(resolve => resolve());
    }
  }
  private async run(job: Job) {
    const asset = this.db.prepare('SELECT id, relative_path, mime_type FROM assets WHERE id = ?').get(job.asset_id) as Asset | undefined;
    if (!asset) { this.db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id); return; }
    const finalRelative = `thumbnails/${asset.id}.jpg`;
    const output = absoluteDataPath(this.options.dataDir, finalRelative);
    const temporary = absoluteDataPath(this.options.dataDir, `tmp/${randomUUID()}.jpg`);
    try {
      await mkdir(path.dirname(temporary), { recursive: true });
      const input = absoluteDataPath(this.options.dataDir, asset.relative_path);
      let playbackStatus: 'playable'|'download_only' | undefined;
      if (job.kind === 'poster') {
        await poster(input, temporary, this.options.ffmpegPath ?? 'ffmpeg', this.options.ffmpegTimeoutMs ?? 30_000);
        playbackStatus = await playable(input, asset.mime_type, this.options.ffprobePath ?? 'ffprobe', this.options.ffmpegTimeoutMs ?? 30_000).catch(() => false) ? 'playable' : 'download_only';
      } else {
        const format = sharp.format.heif;
        if (['image/heic','image/heif'].includes(asset.mime_type) && !format?.input?.file) {
          this.db.prepare("UPDATE jobs SET state = 'complete', last_error = 'UNSUPPORTED_HEIC', updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
          this.db.prepare("UPDATE assets SET thumbnail_status = 'unsupported' WHERE id = ?").run(asset.id);
          return;
        }
        await sharp(input, { limitInputPixels: 100_000_000, pages: 1 }).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(temporary);
      }
      const result = await stat(temporary);
      if (!result.isFile() || result.size === 0) throw new Error('EMPTY_DERIVATIVE');
      if (!this.db.prepare('SELECT 1 FROM assets WHERE id = ?').get(asset.id)) return;
      await moveNoReplace(temporary, output);
      const committed = this.db.transaction(() => {
        const result = this.db.prepare("UPDATE assets SET thumbnail_path = ?, thumbnail_status = 'ready', playback_status = COALESCE(?, playback_status) WHERE id = ?").run(finalRelative, playbackStatus ?? null, asset.id);
        if (result.changes) this.db.prepare("UPDATE jobs SET state = 'complete', last_error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
        return result.changes > 0;
      })();
      if (!committed) await unlinkIfExists(output);
    } catch (error) {
      if (job.kind === 'thumbnail' && ['image/heic','image/heif'].includes(asset.mime_type)) {
        this.db.transaction(() => {
          this.db.prepare("UPDATE jobs SET state = 'complete', last_error = 'UNSUPPORTED_HEIC', updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
          this.db.prepare("UPDATE assets SET thumbnail_status = 'unsupported' WHERE id = ?").run(asset.id);
        })();
        return;
      }
      const code = (error as NodeJS.ErrnoException)?.code;
      const lastError = code === 'ENOENT' && job.kind === 'poster' ? 'FFMPEG_UNAVAILABLE' : job.kind === 'poster' ? 'POSTER_FAILED' : 'THUMBNAIL_FAILED';
      const terminal = job.attempts + 1 >= this.maxAttempts;
      this.db.transaction(() => {
        this.db.prepare('UPDATE jobs SET state = ?, last_error = ?, updated_at = ? WHERE id = ?').run(terminal ? 'failed' : 'pending', lastError, new Date().toISOString(), job.id);
        if (terminal) this.db.prepare("UPDATE assets SET thumbnail_status = 'failed' WHERE id = ?").run(asset.id);
        if (terminal && job.kind === 'poster') this.db.prepare("UPDATE assets SET playback_status = 'download_only' WHERE id = ?").run(asset.id);
      })();
    } finally { await unlinkIfExists(temporary).catch(() => undefined); }
  }
  async waitForIdle() {
    if (!this.running && !this.timer) return;
    await new Promise<void>(resolve => this.idleWaiters.push(resolve));
  }
  async close() {
    this.closed = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.current) await this.current;
  }
}
