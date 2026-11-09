// `review`: rebuild media-work/<campaign>/review/<locale>/ from a finished run — one
// numbered folder per shot (the inputs it used + frames at its key moments), the end
// card (last frame + entrance strip), the video and a README. Copies only.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { FILE } from './constants.mjs';
import { CONFIG } from './config.mjs';
import { UserError } from './errors.mjs';
import { ffmpeg } from './media/ffmpeg.mjs';
import { runNameFor } from './runs.mjs';

const THUMB_W = 360;
const END_ID = 'end';

/** "<n> - <name>" — the review folder convention (numbered in play order). Pure. */
export const reviewFolderName = (n, name) => `${n} - ${name}`;

/** Frame times for one shot: its segments' review hints, clamped inside the shot. Pure. */
export function shotFrameTimes(segments, shot) {
  const lastFrame = 1 / CONFIG.render.fps;
  const times = segments.filter((s) => s.id === shot.id).flatMap((s) => s.review ?? []);
  const clamp = (t) => Math.min(Math.max(t, shot.startSec), shot.endSec - lastFrame);
  const base = times.length ? times : [shot.startSec + 0.1, (shot.startSec + shot.endSec) / 2, shot.endSec];
  return [...new Set(base.map((t) => Math.round(clamp(t) * 1000) / 1000))].sort((a, b) => a - b);
}

/** README text for a review folder. Pure. */
export function reviewReadme({ title, runName, totalSec, folders }) {
  return [
    `${title} — review folder (copies; safe to delete)`,
    `Run: ${runName}   Video: video.mp4 (${totalSec.toFixed(2)} s)`,
    'Rebuilt by: <engine>/cli.mjs review <campaign> --locale=<l> [--offline]',
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
  try {
    const frames = [];
    for (const [k, t] of times.entries()) {
      const f = path.join(tmp, `f${k}.png`);
      await ffmpeg(['-ss', t.toFixed(3), '-i', video, '-frames:v', '1', '-vf', `scale=${THUMB_W}:-1`, f]);
      frames.push(f);
    }
    await ffmpeg([...frames.flatMap((f) => ['-i', f]), '-filter_complex', frames.length > 1 ? `hstack=inputs=${frames.length}` : 'null', out]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function buildReview({ sb, paths, offline = false, log = console.log }) {
  const runName = runNameFor(`${sb.front.campaign}-${sb.locale}`, { inputs: !offline, offline });
  const video = path.join(paths.rendersDir, `${runName}.mp4`);
  const timelineFile = path.join(paths.runsDir, runName, FILE.TIMELINE);
  if (!fsSync.existsSync(video) || !fsSync.existsSync(timelineFile)) throw new UserError(`review: no finished run ${runName} — render it first (cli.mjs run …)`);
  const tl = JSON.parse(await fs.readFile(timelineFile, 'utf8'));
  const dir = paths.reviewDir;
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(video, path.join(dir, 'video.mp4'));
  const folders = [];
  for (const [i, shot] of tl.shots.entries()) {
    const isEnd = shot.id === END_ID;
    const name = reviewFolderName(i + 1, isEnd ? 'end card' : shot.id);
    const sub = path.join(dir, name);
    await fs.mkdir(sub, { recursive: true });
    const files = [];
    for (const [k, a] of Object.entries(shot.assets)) {
      if (a.standIn || !fsSync.existsSync(a.file)) continue;
      const as = `${k}${path.extname(a.file)}`;
      await fs.copyFile(a.file, path.join(sub, as));
      files.push(as);
    }
    if (isEnd) {
      await ffmpeg(['-sseof', '-0.05', '-i', video, '-frames:v', '1', path.join(sub, 'end-card-frame.png')]);
      files.push('end-card-frame.png');
    }
    const strip = isEnd ? 'end-card-animation-strip.png' : 'key-frames.png';
    await frameStrip(video, shotFrameTimes(tl.segments, shot), path.join(sub, strip), paths.tmpDir);
    files.push(strip);
    folders.push({ name, files });
  }
  await fs.writeFile(path.join(dir, 'README.txt'), reviewReadme({ title: sb.front.title ?? sb.front.campaign, runName, totalSec: tl.totalSec, folders }));
  log(`→ ${dir}`);
  return { dir, folders };
}
