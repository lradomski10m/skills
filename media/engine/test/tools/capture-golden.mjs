// Dev tool (not part of `npm test`): capture an A5-style golden fixture from a 0.1.x run.
//   node capture-golden.mjs <campaignWorkDir> <locale> <base.json> <out.json>
// Inputs recorded: per-shot clip analysis (same analyser + params 0.1.x used), raw voice
// durations (ffprobe) — exactly what the planners consume. Expected: the 0.1.x
// timeline, normalised (no absolute paths) to segment/audio/overlay timings.
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeFrames } from '../../lib/alignment.mjs';
import { CONFIG } from '../../lib/config.mjs';
import { decodeGrayFrames, durationSec, probeFps } from '../../lib/media/ffmpeg.mjs';

const [workDir, locale, baseFile, outFile] = process.argv.slice(2);
const runName = `${path.basename(workDir)}-${locale}.inputs`;
const tl = JSON.parse(await fs.readFile(path.join(workDir, '.runs', runName, 'timeline.json'), 'utf8'));
const base = JSON.parse(await fs.readFile(baseFile, 'utf8'));
const a = CONFIG.alignment;
const voice = async (name) => {
  const f = path.join(workDir, '1-voice', locale, `${name}.mp3`);
  try { return await durationSec(f); } catch { return null; }
};
const shots = {};
for (const seg of tl.segments.filter((s) => s.kind === 'shot')) {
  const spec = base.shots.find((s) => s.id === seg.shotId);
  const beat = spec.beat ?? 'action';
  const fps = await probeFps(seg.clipFile);
  const frames = await decodeGrayFrames(seg.clipFile, { fps, width: a.analysisWidth, height: a.analysisHeight });
  const analysis = analyzeFrames(frames, fps, { searchFromSec: 0, searchLastSec: CONFIG.result.syntheticFlash.finalBeatSearchSec, beat });
  shots[seg.shotId] = { beat, analysis, lineSec: await voice(`${seg.shotId}.line`), quipSec: await voice(`${seg.shotId}.quip`) };
}
const gainKind = { 0.6: 'shutter', 0.9: 'thud', 0.45: 'ding', 0.35: 'whoosh' };
const expected = {
  totalSec: tl.totalSec,
  segments: tl.segments.map((s) => ({ id: s.shotId ?? 'end', startSec: s.startSec, durationSec: s.kind === 'shot' ? s.plan.durationSec : s.durationSec })),
  audio: tl.audio.map((x) => ({ kind: x.bus === 'voice' ? 'voice' : gainKind[x.gain] ?? `sfx@${x.gain}`, atSec: x.atSec, durSec: x.durSec ?? null })),
  overlays: tl.overlays.map((o) => ({ graphic: o.graphic, fromSec: o.fromSec, toSec: o.toSec })),
};
const fixture = { note: `Captured from a 0.1.x render (${runName}). Planner inputs + expected timeline.`, locale, inputs: { shots, hookSec: await voice('hook'), announcerSec: await voice('endcard.announcer') }, expected };
await fs.writeFile(outFile, `${JSON.stringify(fixture, null, 1)}\n`);
console.log('wrote', outFile, Object.keys(shots).join(','));
