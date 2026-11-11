// Thin ffmpeg/ffprobe wrappers. Every invocation is an argv array — no shell.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG } from '../config.mjs';
import { ENV, FFMPEG_FULL_BIN_DIR } from '../constants.mjs';
import { UserError } from '../errors.mjs';

/**
 * Resolve a binary: explicit env override → Homebrew's keg-only `ffmpeg-full`
 * (the plain `ffmpeg` formula ships without libass, so no `subtitles` filter)
 * → whatever is on PATH.
 */
const resolveBin = (envName, name) => {
  if (process.env[envName]) return process.env[envName];
  const full = join(FFMPEG_FULL_BIN_DIR, name);
  return existsSync(full) ? full : name;
};

export const ffmpegBin = () => resolveBin(ENV.FFMPEG, 'ffmpeg');
export const ffprobeBin = () => resolveBin(ENV.FFPROBE, 'ffprobe');

export const REQUIRED_FILTERS = Object.freeze(['subtitles', 'overlay', 'loudnorm', 'tpad', 'afade', 'hstack']);

/** Fail fast (with the fix) if ffmpeg is missing or lacks a filter we use. */
export function assertFfmpeg() {
  const res = spawnSync(ffmpegBin(), ['-hide_banner', '-filters'], { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    throw new UserError(
      `ffmpeg not found (${ffmpegBin()}). Install it (macOS: brew install ffmpeg-full) ` +
        `or point ${ENV.FFMPEG}/${ENV.FFPROBE} at the binaries.`,
    );
  }
  const missing = REQUIRED_FILTERS.filter((f) => !new RegExp(`\\s${f}\\s`).test(res.stdout));
  if (missing.length) {
    throw new UserError(`ffmpeg lacks filter(s): ${missing.join(', ')} — needs a build with libass (macOS: brew install ffmpeg-full).`);
  }
}

/**
 * Parse ffmpeg `-progress` key=value lines (a chunk may hold several blocks or a
 * partial line; `carry` is the unterminated rest). Returns the last `out_time_us`
 * seen (seconds), whether `progress=end` was seen, and the new carry. Pure.
 */
export function parseProgress(chunk, carry = '') {
  const text = carry + chunk;
  const lines = text.split('\n');
  const rest = lines.pop();
  let outSec = null;
  let end = false;
  for (const line of lines) {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
    if (m) outSec = Number(m[1]) / 1e6; // both keys are microseconds (ffmpeg quirk)
    if (line.trim() === 'progress=end') end = true;
  }
  return { outSec, end, carry: rest };
}

/** "12.3/68.0 s (18%)" — a progress line for a long pass. Pure. */
export function progressLine(label, outSec, totalSec, elapsedSec) {
  const pct = totalSec > 0 ? ` (${Math.min(100, Math.round((100 * outSec) / totalSec))}%)` : '';
  const speed = elapsedSec > 0 ? ` · ${(outSec / elapsedSec).toFixed(2)}× realtime` : '';
  return `  ${label} ${outSec.toFixed(1)}${totalSec > 0 ? `/${totalSec.toFixed(1)}` : ''} s${pct}${speed}`;
}

/**
 * Spawn `bin args`. With `watch` the child's stdout is ffmpeg `-progress` output:
 * it is parsed, `watch.onProgress(outSec)` is called, and the child is killed with a
 * clear error when the output time has not advanced for `watch.stallSec` seconds
 * (a stalled filter graph otherwise runs for hours writing nothing).
 */
export function run(bin, args, { input, cwd, watch = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    let carry = '';
    let lastOut = -1;
    let lastAdvance = Date.now();
    let stalled = null;
    const timer = watch
      ? setInterval(() => {
          const idle = (Date.now() - lastAdvance) / 1000;
          if (idle < watch.stallSec || stalled) return;
          stalled = `output time stuck at ${Math.max(0, lastOut).toFixed(2)} s for ${Math.round(idle)} s (stall limit ${watch.stallSec} s)`;
          child.kill('SIGKILL');
        }, Math.min(1000, Math.max(50, watch.stallSec * 250)))
      : null;
    child.stdout.on('data', (d) => {
      if (!watch) return out.push(d);
      const p = parseProgress(d.toString('utf8'), carry);
      carry = p.carry;
      if (p.outSec !== null && p.outSec > lastOut) {
        lastOut = p.outSec;
        lastAdvance = Date.now();
        watch.onProgress?.(p.outSec);
      }
      return undefined;
    });
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    child.on('error', (e) => {
      if (timer) clearInterval(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (timer) clearInterval(timer);
      if (stalled) reject(new UserError(`${watch.label ?? bin} stalled: ${stalled} — the filter graph stopped producing frames; killed.\n  args: ${args.join(' ')}\n${err.slice(-2000)}`));
      else if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${bin} exited ${code}\n  args: ${args.join(' ')}\n${err.slice(-4000)}`));
    });
    if (input) child.stdin.end(input);
  });
}

const writesStdout = (args) => args.some((a) => a === 'pipe:1' || a === '-' || a === 'pipe:');

/**
 * Run ffmpeg. Every call that does not write to stdout runs under the stall
 * watchdog (`-progress pipe:1`, CONFIG.render.watchdog). `progress: { label,
 * totalSec, log }` also prints a progress line every `progressEverySec`.
 */
export function ffmpeg(args, { progress = null, stallSec = CONFIG.render.watchdog.stallSec, ...opts } = {}) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (writesStdout(args) || !(stallSec > 0)) return run(ffmpegBin(), [...base, ...args], opts);
  const started = Date.now();
  let lastPrint = started;
  const every = CONFIG.render.watchdog.progressEverySec * 1000;
  const watch = {
    stallSec,
    label: progress?.label ?? 'ffmpeg',
    onProgress: progress
      ? (outSec) => {
          const now = Date.now();
          if (now - lastPrint < every) return;
          lastPrint = now;
          progress.log(progressLine(progress.label, outSec, progress.totalSec ?? 0, (now - started) / 1000));
        }
      : null,
  };
  return run(ffmpegBin(), [...base, '-nostats', '-progress', 'pipe:1', ...args], { ...opts, watch });
}

export async function probe(file) {
  const out = await run(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return JSON.parse(out.toString('utf8'));
}

export async function durationSec(file) {
  const info = await probe(file);
  return Number(info.format.duration);
}

/** Integrated loudness (LUFS, EBU R128) of an audio file — the last running value ebur128 reports. */
export async function loudnessLufs(file) {
  const out = await run(ffmpegBin(), ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.I:file=-', '-f', 'null', '-']);
  const values = [...out.toString('utf8').matchAll(/lavfi\.r128\.I=(-?[\d.]+|-inf)/g)].map((m) => Number(m[1]));
  const last = values.filter(Number.isFinite).at(-1);
  if (last === undefined) throw new Error(`no loudness measured for ${file}`);
  return last;
}

/** Decode a video to low-res grayscale frames at a fixed fps (for alignment). */
export async function decodeGrayFrames(file, { fps, width, height }) {
  const buf = await ffmpeg([
    '-i', file,
    '-vf', `fps=${fps},scale=${width}:${height}:flags=area,format=gray`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
  ]);
  const size = width * height;
  const frames = [];
  for (let off = 0; off + size <= buf.length; off += size) frames.push(buf.subarray(off, off + size));
  return frames;
}

/** A video's native frame rate (r_frame_rate, e.g. "24/1" → 24). */
export async function probeFps(file) {
  const out = await run(ffprobeBin(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', file]);
  const [num, den = '1'] = out.toString('utf8').trim().split('/');
  const fps = Number(num) / Number(den);
  if (!(fps > 0)) throw new Error(`cannot read frame rate of ${file}`);
  return fps;
}
