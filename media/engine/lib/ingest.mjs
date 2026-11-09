// `ingest`: drop a downloaded (URL) or local file into media-work/<campaign>/
// by role, converting to the layout's format. A file already at the destination
// is moved to <folder>/_alt/<name>.prev<N><ext> — never deleted.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ALT_DIR, INGEST_KIND, INPUTS } from './constants.mjs';
import { UserError } from './errors.mjs';
import { inputPath } from './inputs.mjs';
import { ffmpeg } from './media/ffmpeg.mjs';

const TARGET_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const URL_RE = /^https?:\/\//i;

/** `--as clip:cow | still:cow | result:cow | perfect:cow | intro:cow | vo:cow.line | vo:hook | music`. Pure. */
export function parseRole(as) {
  const [kind, target = null, ...rest] = String(as ?? '').split(':');
  const kinds = Object.values(INGEST_KIND);
  if (!kinds.includes(kind) || rest.length) throw new UserError(`--as: <kind>:<target>, kind one of ${kinds.join(', ')} (got "${as}")`);
  if (kind === INGEST_KIND.MUSIC) {
    if (target) throw new UserError('--as music takes no target');
    return { kind, target: null };
  }
  if (!target || !TARGET_RE.test(target)) throw new UserError(`--as ${kind}:<target>: lowercase id (e.g. cow, quokka.oneshot, cow.line)`);
  return { kind, target };
}

/**
 * Destination of a role (absolute): VO goes to 1-voice/<locale>/, stills to
 * 2-stills/, clips to 3-clips/, music to 4-music/ (`paths` from workPaths). Pure.
 */
export function ingestTarget({ kind, target }, paths) {
  const at = inputPath(paths);
  return {
    [INGEST_KIND.CLIP]: () => at.clip(target),
    [INGEST_KIND.STILL]: () => at.still(target),
    [INGEST_KIND.RESULT]: () => at.resultStill(target),
    [INGEST_KIND.PERFECT]: () => at.perfectPhoto(target),
    [INGEST_KIND.INTRO]: () => at.introStill(target),
    [INGEST_KIND.VO]: () => {
      const [owner, ...part] = target.split('.');
      return at.vo(owner, part.join('.') || null);
    },
    [INGEST_KIND.MUSIC]: () => at.music(),
  }[kind]();
}

/** Free `_alt/<name>.prev<N><ext>` next to `dest`. Pure given `exists`. */
export function altPath(dest, exists) {
  const ext = path.extname(dest);
  const name = path.basename(dest, ext);
  for (let n = 1; ; n++) {
    const candidate = path.join(path.dirname(dest), ALT_DIR, `${name}.prev${n}${ext}`);
    if (!exists(candidate)) return candidate;
  }
}

async function fetchToFile(url, dir) {
  const res = await fetch(url);
  if (!res.ok) throw new UserError(`ingest: GET ${url} → HTTP ${res.status}`);
  const ext = path.extname(new URL(url).pathname) || '';
  const file = path.join(dir, `download-${Date.now()}${ext}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Copy `src` to `dest`, converting to the destination's format when the extension differs. */
async function placeAs(src, dest) {
  const want = path.extname(dest).toLowerCase();
  const have = path.extname(src).toLowerCase();
  if (have === want) return fs.copyFile(src, dest);
  if (want === INPUTS.STILL_EXT) return sharp(src).png().toFile(dest);
  if (want === INPUTS.VO_EXT) return ffmpeg(['-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', dest]);
  if (want === INPUTS.CLIP_EXT) return ffmpeg(['-i', src, '-c', 'copy', dest]);
  throw new UserError(`ingest: cannot convert ${have} to ${want}`);
}

export async function ingest({ source, paths, as, log = console.log }) {
  const role = parseRole(as);
  const dest = ingestTarget(role, paths);
  await fs.mkdir(paths.tmpDir, { recursive: true });
  const src = URL_RE.test(source) ? await fetchToFile(source, paths.tmpDir) : path.resolve(source);
  if (!fsSync.existsSync(src)) throw new UserError(`ingest: not found: ${src}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let moved = null;
  if (fsSync.existsSync(dest)) {
    moved = altPath(dest, fsSync.existsSync);
    await fs.mkdir(path.dirname(moved), { recursive: true });
    await fs.rename(dest, moved);
    log(`  kept    previous → ${moved}`);
  }
  await placeAs(src, dest);
  log(`  ingest  ${role.kind}${role.target ? `:${role.target}` : ''} → ${dest}`);
  return { dest, moved };
}
