// Thin ffmpeg/ffprobe wrappers. Every invocation is an argv array — no shell.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

export function run(bin, args, { input, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err += d;
      if (err.length > 200_000) err = err.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${bin} exited ${code}\n  args: ${args.join(' ')}\n${err.slice(-4000)}`));
    });
    if (input) child.stdin.end(input);
  });
}

export const ffmpeg = (args, opts) => run(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);

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
