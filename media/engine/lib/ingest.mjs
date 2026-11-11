// `ingest`: drop a downloaded (URL) or local file into media-work/<campaign>/
// by role, converting to the layout's format. Clips are normalised (CFR at the
// render fps, untagged colour, yuv420p, no audio); voice takes can be cut to their
// first reading. A file already at the destination is moved to
// <folder>/_alt/<name>.prev<N><ext> — never deleted.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ALT_DIR, INGEST_KIND, INPUTS } from './constants.mjs';
import { UserError } from './errors.mjs';
import { inputPath } from './inputs.mjs';
import { CONFIG } from './config.mjs';
import { durationSec, ffmpeg, ffmpegBin, probe, run } from './media/ffmpeg.mjs';

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

const R = CONFIG.render;
const I = CONFIG.ingest;
const UNTAGGED = new Set([undefined, null, '', 'unknown', 'unspecified', 'reserved']);
const fpsOf = (rate) => {
  const [num, den = '1'] = String(rate ?? '0/1').split('/');
  const v = Number(num) / Number(den);
  return Number.isFinite(v) ? v : 0;
};
const close = (a, b) => Math.abs(a - b) < 0.01;

/**
 * What `ingest --as=clip:*` must change so a clip concatenates cleanly: constant
 * frame rate at the render fps, no colour tags, yuv420p H.264, no audio. `info` is
 * ffprobe JSON. Empty list = already conformant. Pure.
 */
export function clipChanges(info, fps = R.fps, { keepAudio = false } = {}) {
  const v = info.streams?.find((x) => x.codec_type === 'video');
  if (!v) throw new UserError('ingest: the clip has no video stream');
  const changes = [];
  const rate = fpsOf(v.r_frame_rate);
  const avg = fpsOf(v.avg_frame_rate);
  if (!close(rate, avg) && avg > 0) changes.push(`variable frame rate (avg ${avg.toFixed(2)} fps) → ${fps} fps CFR`);
  else if (!close(rate, fps)) changes.push(`${Number(rate.toFixed(3))} fps → ${fps} fps`);
  const tags = ['color_primaries', 'color_transfer', 'color_space'].filter((k) => !UNTAGGED.has(v[k])).map((k) => v[k]);
  if (tags.length) changes.push(`colour tags ${[...new Set(tags)].join('/')} → unspecified`);
  if (v.pix_fmt !== 'yuv420p') changes.push(`${v.pix_fmt ?? 'unknown pixel format'} → yuv420p`);
  if (v.codec_name !== 'h264') changes.push(`${v.codec_name} → h264`);
  const audio = info.streams.filter((x) => x.codec_type === 'audio').length;
  if (audio && !keepAudio) changes.push(`${audio} audio track${audio > 1 ? 's' : ''} dropped (--keep-audio keeps a lip-synced clip's sound)`);
  return changes;
}

/**
 * Re-encode a clip to the engine's conformant intermediate: CFR first (`fps`, so a
 * later trim/setpts can't drift on VFR timestamps), colour metadata cleared to
 * unspecified, yuv420p, video only (`keepAudio`: plus the first audio track, as AAC —
 * a lip-synced `dialogue` clip plays its own sound). Pure.
 */
export function clipNormaliseArgs(src, dest, fps = R.fps, { keepAudio = false } = {}) {
  const audio = keepAudio ? ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', R.audioBitrate] : ['-an'];
  return [
    '-i', src, '-map', '0:v:0',
    '-vf', `fps=${fps},setparams=color_primaries=unknown:color_trc=unknown:colorspace=unknown:range=unknown,format=yuv420p`,
    ...audio, '-c:v', 'libx264', '-crf', String(I.clipCrf), '-preset', R.preset, '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-movflags', '+faststart', dest,
  ];
}

/** Silence intervals from ffmpeg `silencedetect` + `ametadata=print` output. Pure. */
export function parseSilences(text, durationSec) {
  const out = [];
  let open = null;
  for (const m of String(text).matchAll(/lavfi\.silence_(start|end)=(-?[\d.]+)/g)) {
    const t = Math.max(0, Number(m[2]));
    if (m[1] === 'start') open = t;
    else if (open !== null) {
      out.push({ startSec: open, endSec: t });
      open = null;
    }
  }
  if (open !== null) out.push({ startSec: open, endSec: durationSec });
  return out;
}

/**
 * Where the first utterance of a voice take ends: the first pause (≥ minGapSec, found
 * by silencedetect) that has speech before AND after it — a model that repeats a short
 * line puts a pause between readings. Leading and trailing silence never count.
 * Returns { cutSec, pauses } or null when the take holds one utterance. Pure.
 */
export function firstUtteranceCut(silences, durationSec, { leadingMaxSec = I.utterance.leadingMaxSec, fadeSec = I.voFadeSec } = {}) {
  const inner = silences.filter((s) => s.startSec > leadingMaxSec && s.endSec < durationSec - 0.01);
  if (!inner.length) return null;
  const first = inner[0];
  return { cutSec: Math.min(durationSec, first.startSec + fadeSec), speechEndSec: first.startSec, pauses: inner.length };
}

/** Cut a voice take at `untilSec` with a `fadeSec` fade-out ending on the cut, to MP3. Pure. */
export function voCutArgs(src, dest, untilSec, fadeSec = I.voFadeSec) {
  const f = Math.min(fadeSec, untilSec);
  return ['-i', src, '-vn', '-af', `atrim=end=${untilSec.toFixed(3)},afade=t=out:st=${(untilSec - f).toFixed(3)}:d=${f.toFixed(3)}`, '-c:a', 'libmp3lame', '-q:a', '2', dest];
}

async function detectSilences(file) {
  const U = I.utterance;
  const out = await run(ffmpegBin(), ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', `silencedetect=noise=${U.noiseDb}dB:d=${U.minGapSec},ametadata=mode=print:file=-`, '-f', 'null', '-']);
  return parseSilences(out.toString('utf8'), await durationSec(file));
}

/** Where to cut a voice take (`--until`, `--first-utterance`, or both: the earlier wins), or null. */
async function voCut(src, { until, firstUtterance }, log) {
  if (until == null && !firstUtterance) return null;
  const total = await durationSec(src);
  const cuts = [];
  if (until != null) {
    if (!(until > 0)) throw new UserError(`ingest: --until must be a positive number of seconds (got ${until})`);
    cuts.push({ sec: Math.min(until, total), why: `--until ${until}s` });
  }
  if (firstUtterance) {
    const c = firstUtteranceCut(await detectSilences(src), total);
    if (!c) log(`  voice   one utterance found (no inner pause ≥ ${I.utterance.minGapSec}s) — kept the whole ${total.toFixed(2)}s take`);
    else {
      log(`  voice   first utterance 0.00–${c.speechEndSec.toFixed(2)}s; cut ${c.cutSec.toFixed(2)}–${total.toFixed(2)}s (${c.pauses} later pause${c.pauses > 1 ? 's' : ''}: repeated reading)`);
      cuts.push({ sec: c.cutSec, why: 'first utterance' });
    }
  }
  if (!cuts.length) return null;
  return cuts.reduce((a, b) => (b.sec < a.sec ? b : a));
}

/** Copy `src` to `dest`, converting to the destination's format (clips are normalised). */
async function placeAs(src, dest, role, opts, log) {
  const want = path.extname(dest).toLowerCase();
  const have = path.extname(src).toLowerCase();
  if (role.kind === INGEST_KIND.CLIP) {
    const changes = clipChanges(await probe(src), R.fps, { keepAudio: opts.keepAudio });
    if (!changes.length && have === want) {
      log(`  clip    already conformant (CFR, untagged, yuv420p${opts.keepAudio ? '' : ', no audio'}) — copied`);
      return fs.copyFile(src, dest);
    }
    if (!changes.length) return ffmpeg(['-i', src, '-c', 'copy', dest]);
    log(`  clip    normalised: ${changes.join('; ')}`);
    return ffmpeg(clipNormaliseArgs(src, dest, R.fps, { keepAudio: opts.keepAudio }));
  }
  if (role.kind === INGEST_KIND.VO) {
    const cut = await voCut(src, opts, log);
    if (cut) {
      log(`  voice   cut at ${cut.sec.toFixed(2)}s (${cut.why}), ${I.voFadeSec}s fade`);
      return ffmpeg(voCutArgs(src, dest, cut.sec));
    }
  }
  if (have === want) return fs.copyFile(src, dest);
  if (want === INPUTS.STILL_EXT) return sharp(src).png().toFile(dest);
  if (want === INPUTS.VO_EXT) return ffmpeg(['-i', src, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', dest]);
  if (want === INPUTS.CLIP_EXT) return ffmpeg(['-i', src, '-c', 'copy', dest]);
  throw new UserError(`ingest: cannot convert ${have} to ${want}`);
}

/**
 * Ingest one file. `until` (s) / `firstUtterance` cut a voice take (vo:* only);
 * `keepAudio` keeps a clip's sound (clip:* only, e.g. a lip-synced dialogue clip).
 */
export async function ingest({ source, paths, as, until = null, firstUtterance = false, keepAudio = false, log = console.log }) {
  const role = parseRole(as);
  if (keepAudio && role.kind !== INGEST_KIND.CLIP) throw new UserError('ingest: --keep-audio applies to clips (--as=clip:<id>) only');
  if ((until != null || firstUtterance) && role.kind !== INGEST_KIND.VO) throw new UserError('ingest: --until and --first-utterance apply to voice takes (--as=vo:<key>) only');
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
  await placeAs(src, dest, role, { until, firstUtterance, keepAudio }, log);
  log(`  ingest  ${role.kind}${role.target ? `:${role.target}` : ''} → ${dest}`);
  return { dest, moved };
}
