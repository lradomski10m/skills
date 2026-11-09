// `review`: rebuild media-work/<campaign>/review/<locale>/ from a finished run — numbered per-shot
// folders (inputs used + frames around the flash), the end-card frame + its
// entrance strip, the latest video and a README. Copies only; files are
// overwritten in place, nothing is deleted.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { FILE } from './constants.mjs';
import { CONFIG } from './config.mjs';
import { UserError } from './errors.mjs';
import { createInputs } from './inputs.mjs';
import { ffmpeg } from './media/ffmpeg.mjs';
import { runNameFor } from './runs.mjs';

const THUMB_W = 360;
/** Frames around the flash, relative to the flash / the cut to the result still / the stamp. */
const FLASH_OFFSETS = Object.freeze({ beforeFlash: [-0.4, -0.15], afterFlash: [0, 0.1], afterCut: [0.05], afterStamp: [0.4] });
/** End-card entrance strip, seconds after the card starts; plus the last frame. */
const ENDCARD_OFFSETS = Object.freeze([0.05, 0.15, 0.3, 0.6, 2.0]);

/** "<n> - <name>" — the review folder convention (numbered in play order). Pure. */
export const reviewFolderName = (n, name) => `${n} - ${name}`;

/** Global times (s) of the frames-around-flash strip for one shot segment. Pure. */
export function flashFrameTimes(segment) {
  const ev = segment.plan.events;
  const t0 = segment.startSec;
  const end = t0 + segment.plan.durationSec;
  const flash = ev.shutterAt ?? ev.cutAt ?? ev.stampAt;
  const at = [
    ...[...FLASH_OFFSETS.beforeFlash, ...FLASH_OFFSETS.afterFlash].map((d) => flash + d),
    ...(ev.resultAt != null ? FLASH_OFFSETS.afterCut.map((d) => ev.resultAt + d) : []),
    ...(ev.stampAt != null ? FLASH_OFFSETS.afterStamp.map((d) => ev.stampAt + d) : []),
  ];
  const lastFrame = 1 / CONFIG.render.fps;
  return [...new Set(at.map((d) => Math.min(Math.max(t0 + d, t0), end - lastFrame)).map((t) => Math.round(t * 1000) / 1000))].sort((a, b) => a - b);
}

/** README text for a review folder. Pure. */
export function reviewReadme({ spec, runName, totalSec, folders }) {
  return [
    `${spec.title ?? spec.id} — review folder (copies; safe to delete)`,
    `Run: ${runName}   Video: video.mp4 (${totalSec.toFixed(2)} s)`,
    `Rebuilt by: <engine>/cli.mjs review <spec> [--inputs | --offline]`,
    '',
    ...folders.map((f) => `${f.name.padEnd(22)}: ${f.files.join(', ')}`),
    '',
    'Say what to fix per numbered folder (e.g. "3 - cow: flash too early").',
    '',
  ].join('\n');
}

async function frameStrip(video, times, out, tmpRoot) {
  const tmp = path.join(tmpRoot, `strip-${process.pid}-${Date.now()}`);
  await fs.mkdir(tmp, { recursive: true });
  const frames = [];
  for (const [k, t] of times.entries()) {
    const f = path.join(tmp, `f${k}.png`);
    await ffmpeg(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', `scale=${THUMB_W}:-1`, f]);
    frames.push(f);
  }
  const inputs = frames.flatMap((f) => ['-i', f]);
  await ffmpeg([...inputs, '-filter_complex', frames.length > 1 ? `hstack=inputs=${frames.length}` : 'null', out]);
}

export async function buildReview({ spec, paths, inputs: useInputs = false, offline = false, log = console.log }) {
  const runName = runNameFor(spec.id, { inputs: useInputs, offline });
  const video = path.join(paths.rendersDir, `${runName}.mp4`);
  const timelineFile = path.join(paths.runsDir, runName, FILE.TIMELINE);
  if (!fsSync.existsSync(video) || !fsSync.existsSync(timelineFile)) throw new UserError(`review: no finished run ${runName} — render it first (cli.mjs run …)`);
  const tl = JSON.parse(await fs.readFile(timelineFile, 'utf8'));
  const inputs = createInputs(useInputs ? paths : null);
  const dir = paths.reviewDir;
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(video, path.join(dir, 'video.mp4'));

  const folders = [];
  const shots = tl.segments.filter((s) => s.kind === 'shot');
  for (const [i, seg] of shots.entries()) {
    const name = reviewFolderName(i + 1, seg.shotId);
    const sub = path.join(dir, name);
    await fs.mkdir(sub, { recursive: true });
    const files = [];
    const copy = async (src, as) => {
      if (!src) return;
      await fs.copyFile(src, path.join(sub, as));
      files.push(as);
    };
    await copy(inputs.still(seg.shotId), 'still.png');
    await copy(inputs.resultStill(seg.shotId), 'result.png');
    await copy(inputs.perfectPhoto(seg.shotId), 'perfect.png');
    await copy(inputs.vo(seg.shotId, 'line'), 'line.mp3');
    await copy(inputs.vo(seg.shotId, 'quip'), 'quip.mp3');
    await frameStrip(video, flashFrameTimes(seg), path.join(sub, 'frames-around-flash.png'), paths.tmpDir);
    files.push('frames-around-flash.png');
    folders.push({ name, files });
  }
  const card = tl.segments.find((s) => s.kind === 'endcard');
  if (card) {
    const name = reviewFolderName(shots.length + 1, 'end card');
    const sub = path.join(dir, name);
    await fs.mkdir(sub, { recursive: true });
    await ffmpeg(['-sseof', '-0.05', '-i', video, '-frames:v', '1', path.join(sub, 'end-card-frame.png')]);
    const end = card.startSec + card.durationSec - 0.05;
    await frameStrip(video, [...ENDCARD_OFFSETS.map((d) => Math.min(card.startSec + d, end)), end], path.join(sub, 'end-card-animation-strip.png'), paths.tmpDir);
    folders.push({ name, files: ['end-card-frame.png', 'end-card-animation-strip.png'] });
  }
  await fs.writeFile(path.join(dir, 'README.txt'), reviewReadme({ spec, runName, totalSec: tl.totalSec, folders }));
  log(`→ ${dir}`);
  return { dir, folders };
}
