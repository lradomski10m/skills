// Timeline helpers shared by the composer and the renderer: music duck windows,
// loudness levelling and sanity checks. PURE. (Layout itself is compose/compose.mjs.)

import { CONFIG } from './config.mjs';
import { BUS } from './constants.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Music duck windows: every voice event's [atSec, atSec + durSec], merged when
 * the gap between two is under `mergeGapSec` (the bed stays down between close
 * lines instead of pumping). Pure.
 */
export function duckWindows(audio, { mergeGapSec } = CONFIG.render.music) {
  const spans = audio
    .filter((a) => a.bus === BUS.VOICE && a.durSec > 0)
    .map((a) => [a.atSec, a.atSec + a.durSec])
    .sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const [from, to] of spans) {
    const last = out.at(-1);
    if (last && from - last.toSec < mergeGapSec) last.toSec = r3(Math.max(last.toSec, to));
    else out.push({ fromSec: r3(from), toSec: r3(to) });
  }
  return out;
}

/** Linear gain for a dB value. Pure. */
export const dbToGain = (db) => 10 ** (db / 20);

/** Music gain (dB) that puts the bed `levelDb` relative to the voice reference loudness. Pure. */
export const musicGainDb = ({ bedLufs, voiceLufs, levelDb }) => voiceLufs + levelDb - bedLufs;

/** Energy mean of several loudness values (LUFS) — the voice reference level. Pure. */
export const meanLufs = (values) => 10 * Math.log10(values.reduce((acc, v) => acc + 10 ** (v / 10), 0) / values.length);

/** Sanity checks on a built timeline; returns problems (empty = fine). */
export function checkTimeline(tl) {
  const problems = [];
  for (const a of tl.audio) if (a.atSec < 0 || a.atSec > tl.totalSec) problems.push(`audio ${a.file} at ${a.atSec}s outside 0..${tl.totalSec}s`);
  for (const o of tl.overlays) if (o.toSec <= o.fromSec) problems.push(`overlay ${o.graphic} has empty window ${o.fromSec}..${o.toSec}`);
  for (const e of tl.effects ?? []) if (e.toSec < e.fromSec) problems.push(`effect ${e.name} has a negative window ${e.fromSec}..${e.toSec}`);
  return problems;
}
