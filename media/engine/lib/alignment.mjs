// Auto-alignment — the core of the pipeline, and pure (no fs, no ffmpeg).
//
// 1. Detection: from low-res grayscale frames, find the camera flash
//    (brightness spike) and the action beat (onset of the dominant
//    motion-energy peak after the flash).
// 2. Placement: lay out the shot on the output timeline so the rule VO ends
//    just before the beat, the stamp lands just after it, and the quip follows.
//    If the VO is longer than the run-up, slow the pre-action segment (down to
//    minSpeed) and then freeze the opening frame for the rest.

import { CONFIG } from './config.mjs';
import { BEAT_MODE, FLASH_MODE, SHOT_STATUS, VERDICT } from './constants.mjs';

const EPSILON_ENERGY = 0.01;

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The tempo profile by name (spec `tempo`, else config default), with its name. Pure. */
export function activeTempo(name = CONFIG.tempo.profile) {
  const profile = CONFIG.tempo.profiles[name];
  if (!profile) throw new Error(`unknown tempo profile "${name}" (${Object.keys(CONFIG.tempo.profiles).join(', ')})`);
  return { name, ...profile };
}
const isSnappy = (tempo) => tempo?.name === 'snappy';

/**
 * End time of `phrase` within a line, from REAL character timing; null when the
 * alignment is approximate (provided audio) or the phrase is absent. Pure.
 */
export function phraseEndSec(alignment, text, phrase) {
  if (!alignment || alignment.approximate || !phrase) return null;
  const at = text.indexOf(phrase);
  if (at < 0) return null;
  return alignment.character_end_times_seconds[at + phrase.length - 1] ?? null;
}

/** Mean brightness (0–255) per frame. */
export function lumaSeries(frames) {
  return frames.map((f) => {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i];
    return sum / f.length;
  });
}

/** Mean absolute pixel change vs the previous frame; [0] is 0. */
export function diffSeries(frames) {
  return frames.map((f, idx) => {
    if (idx === 0) return 0;
    const prev = frames[idx - 1];
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += Math.abs(f[i] - prev[i]);
    return sum / f.length;
  });
}

function smooth(series, radius) {
  return series.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(series.length - 1, i + radius); j++) {
      sum += series[j];
      n++;
    }
    return sum / n;
  });
}

/**
 * Flash = first run of frames brighter than the clip's median luma by
 * `minDelta`, starting within `searchMaxSec`. Median (not the first frames) is
 * the baseline so a flash on frame 0 is still found.
 */
export function detectFlash(luma, fps, cfg = CONFIG.alignment.flash) {
  const baseline = median(luma);
  const limit = Math.min(luma.length, Math.ceil(cfg.searchMaxSec * fps) + 1);
  let start = -1;
  for (let i = 0; i < limit; i++) {
    if (luma[i] - baseline >= cfg.minDelta) {
      start = i;
      break;
    }
  }
  if (start < 0) return { found: false, reason: `no flash in first ${cfg.searchMaxSec}s (baseline luma ${baseline.toFixed(1)})` };
  let end = start;
  while (end + 1 < luma.length && luma[end + 1] - baseline >= cfg.minDelta / 2) end++;
  let peak = start;
  for (let i = start; i <= end; i++) if (luma[i] > luma[peak]) peak = i;
  return { found: true, startFrame: start, endFrame: end, peakFrame: peak, t: start / fps, endT: end / fps, baseline };
}

/**
 * Action beat = onset of the strongest sustained motion after the flash has
 * settled. Energy is the per-frame mean absolute difference, smoothed over
 * `smoothSec`. "Clear" means the burst after the onset is well above the
 * run-up before it (contrast = burst mean / run-up median), not merely the
 * highest point — real i2v clips have gentle actions (a smile) over idle
 * motion, so a relative test against the clip's own run-up is what separates
 * an action from noise.
 */
export function detectActionBeat(diff, fps, flash, cfg = CONFIG.alignment.action, searchFromSec = 0) {
  const from = Math.max((flash?.found ? flash.endFrame + 1 : 0) + Math.ceil(cfg.settleSec * fps), Math.ceil(searchFromSec * fps));
  const to = diff.length - Math.ceil(cfg.minPostBeatSec * fps);
  if (to - from < 3) return { found: false, reason: 'clip too short after the flash to find an action beat' };
  const s = smooth(diff, Math.max(1, Math.round(cfg.smoothSec * fps)));
  let peak = from;
  for (let i = from; i < to; i++) if (s[i] > s[peak]) peak = i;
  const windowFloor = median(s.slice(from, to));
  const threshold = windowFloor + cfg.onsetFraction * (s[peak] - windowFloor);
  let onset = peak;
  while (onset - 1 >= from && s[onset - 1] > threshold) onset--;

  const minRunUp = Math.ceil(cfg.minRunUpSec * fps);
  const runUp = onset - from >= minRunUp ? diff.slice(from, onset) : diff.slice(from, to);
  const floor = median(runUp);
  const burstSlice = diff.slice(onset, Math.min(diff.length, onset + Math.ceil(cfg.burstSec * fps)));
  const burst = burstSlice.reduce((acc, x) => acc + x, 0) / Math.max(1, burstSlice.length);
  const contrast = burst / Math.max(floor, EPSILON_ENERGY);
  const excess = burst - floor;
  const at = (i) => (i / fps).toFixed(2);
  if (excess < cfg.minPeakExcess || contrast < cfg.minContrast) {
    return {
      found: false,
      reason:
        `no clear action beat (best candidate ${at(onset)}s: burst ${burst.toFixed(2)} vs run-up ${floor.toFixed(2)}, ` +
        `${contrast.toFixed(1)}×; need ≥${cfg.minContrast}× and +${cfg.minPeakExcess})`,
    };
  }
  let end = peak;
  while (end + 1 < diff.length && s[end + 1] > threshold) end++;
  // Start of the motion: the quiet valley just before the rise (walk back while energy keeps falling).
  let start = onset;
  while (start - 1 >= from && s[start - 1] < s[start]) start--;
  return { found: true, frame: onset, t: onset / fps, startT: start / fps, peakFrame: peak, peakT: peak / fps, endT: end / fps, burst, floor, contrast };
}

/**
 * Settle point (beat: "settle"): when the clip's last motion dies down. Pure.
 * Returns an action-shaped result (onset = peak = complete = settle) so the
 * result planners treat it like an instantaneous beat. When the motion is too
 * weak to trust (excess < minExcess), the anchor falls back to just before the end.
 */
export function detectSettle(diff, fps, cfg = CONFIG.settle) {
  const s = smooth(diff, Math.max(1, Math.round(cfg.smoothSec * fps)));
  const n = s.length;
  const tailFrom = Math.max(0, n - Math.round(cfg.tailSec * fps));
  const searchFrom = Math.max(0, n - Math.round(cfg.searchSec * fps));
  const tailFloor = median(s.slice(tailFrom));
  const peak = Math.max(...s.slice(searchFrom, tailFrom));
  const excess = peak - tailFloor;
  const reliable = excess >= cfg.minExcess;
  let t = Math.max(0, (n - 1) / fps - cfg.fallbackBeforeEndSec);
  if (reliable) {
    const level = tailFloor + cfg.fraction * excess;
    let i = tailFrom - 1;
    while (i > searchFrom && s[i] <= level) i--;
    t = (i + 1) / fps;
  }
  const r = (x) => Math.round(x * 1000) / 1000;
  return { found: true, mode: BEAT_MODE.SETTLE, reliable, t: r(t), startT: r(t), peakT: r(t), endT: r(t), excess: r(excess), tailFloor: r(tailFloor) };
}

/**
 * Every frame that is a brightness spike (any flash — i2v models sometimes add
 * a stray second one), plus the frame after it (the return transition). Pure.
 */
export function flashFrames(luma, cfg = CONFIG.alignment.flash) {
  const baseline = median(luma);
  const out = new Set();
  luma.forEach((l, i) => {
    if (l - baseline >= cfg.minDelta) {
      out.add(i);
      if (i + 1 < luma.length) out.add(i + 1);
    }
  });
  return out;
}

/**
 * Every flash in the clip as a run of bright frames (anywhere, not just the
 * opening window) — result-mode shots anchor on a flash late in the clip. Pure.
 */
export function flashRuns(luma, fps, cfg = CONFIG.alignment.flash) {
  const baseline = median(luma);
  const runs = [];
  for (let i = 0; i < luma.length; i++) {
    if (luma[i] - baseline < cfg.minDelta) continue;
    let end = i;
    while (end + 1 < luma.length && luma[end + 1] - baseline >= cfg.minDelta / 2) end++;
    runs.push({ found: true, startFrame: i, endFrame: end, t: i / fps, endT: end / fps, baseline });
    i = end;
  }
  return runs;
}

/**
 * Detection from per-frame series (pure; the fixture-tested entry point).
 * Flash frames are replaced by the clip's median motion so neither the flash
 * nor a stray flash can win as the action.
 */
/** `searchFromSec`: look for the action beat only after this point (e.g. the last part of a multi-part action). */
export function analyzeSeries({ luma, diff }, fps, { searchFromSec = 0, searchLastSec = null, beat = BEAT_MODE.ACTION } = {}) {
  const flash = detectFlash(luma, fps);
  const spikes = flashFrames(luma);
  const typical = median(diff.filter((_, i) => !spikes.has(i)));
  const clean = diff.map((d, i) => (spikes.has(i) ? typical : d));
  const firstRun = flash.found ? new Set(Array.from({ length: flash.endFrame - flash.startFrame + 2 }, (_, k) => flash.startFrame + k)) : new Set();
  const stray = [...spikes].filter((i) => !firstRun.has(i) && !spikes.has(i - 1)).map((i) => Math.round((i / fps) * 1000) / 1000);
  // searchLastSec: the beat is the FINAL burst (single continuous clips) — search only the tail, up to the end.
  const tail = searchLastSec !== null;
  const actionCfg = tail ? { ...CONFIG.alignment.action, minPostBeatSec: 0 } : CONFIG.alignment.action;
  const from = tail ? Math.max(searchFromSec, luma.length / fps - searchLastSec) : searchFromSec;
  const action = beat === BEAT_MODE.SETTLE ? detectSettle(clean, fps) : detectActionBeat(clean, fps, flash, actionCfg, from);
  // Settle shots have no still part before the beat (the stillness comes after it).
  const quiet = !action.found ? null : beat === BEAT_MODE.SETTLE ? action.startT : quietStartSec(clean, fps, action.startT, activeTempo('snappy'));
  return { durationSec: luma.length / fps, frameCount: luma.length, fps, flash, flashes: flashRuns(luma, fps), strayFlashesSec: stray, action, quietStartSec: quiet };
}

/** Full per-clip analysis from decoded frames. */
export const analyzeFrames = (frames, fps, opts) => analyzeSeries({ luma: lumaSeries(frames), diff: diffSeries(frames) }, fps, opts);

const round3 = (x) => Math.round(x * 1000) / 1000;

function finalize(plan) {
  const r = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? round3(v) : v]));
  return { ...r(plan), source: r(plan.source), events: r(plan.events) };
}

/**
 * Rejected shot: flash → VO ends just before the beat → beat → stamp (thud,
 * ✗, sticker) → clerk word → quip. All times are output-local seconds.
 */
export function planRejectedShot({ analysis, voDur, quipDur = 0, clerkDur = 0, introDur = 0 }, p = CONFIG.alignment.placement) {
  if (!analysis.flash.found) return { status: SHOT_STATUS.FAILED, reason: analysis.flash.reason };
  if (!analysis.action.found) return { status: SHOT_STATUS.FAILED, reason: analysis.action.reason };
  const beatSrc = analysis.action.t;
  // With a habitat intro the clip starts exactly ON its flash (the cut); without
  // one it starts just before the flash so the flash reads.
  const hasIntro = introDur > 0;
  const inSrc = hasIntro ? analysis.flash.t : Math.max(0, analysis.flash.t - p.preFlashSec);
  const runUpSrc = beatSrc - inSrc;
  const neededOut = p.leadInSec + voDur + p.preActionGapSec;
  // The rule VO may start during the intro; the clip covers the rest of the run-up.
  const clipNeeded = neededOut - introDur;

  let speed = 1;
  let freezeHeadSec = 0;
  let introSec = introDur;
  if (runUpSrc < clipNeeded) {
    speed = Math.max(p.minSpeed, runUpSrc / clipNeeded);
    const short = Math.max(0, clipNeeded - runUpSrc / speed);
    // Still short: hold the intro longer (never freeze the flash frame), else freeze the opening frame.
    if (hasIntro) introSec += short;
    else freezeHeadSec = short;
  }
  const beatOut = introSec + freezeHeadSec + runUpSrc / speed;
  const voStart = beatOut - p.preActionGapSec - voDur;
  const stampAt = beatOut + p.stampDelaySec;
  // No clerk word (skipped role): the quip follows the thud directly.
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const afterStamp = clerkStart === null ? stampAt + p.quipAfterStampSec : clerkStart + clerkDur + p.quipGapSec;
  const quipStart = quipDur > 0 ? afterStamp : null;
  const lastAudioEnd = quipStart !== null ? quipStart + quipDur : clerkStart !== null ? clerkStart + clerkDur : stampAt;
  const durationSec = Math.max(lastAudioEnd + p.tailPadSec, beatOut + p.minPostBeatSec);

  const postNeededSrc = durationSec - beatOut;
  const postAvailSrc = analysis.durationSec - beatSrc;
  const freezeTailSec = Math.max(0, postNeededSrc - postAvailSrc);

  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.REJECTED,
    source: { inSec: inSrc, beatSec: beatSrc, outSec: beatSrc + Math.min(postNeededSrc, postAvailSrc) },
    speed,
    introSec,
    freezeHeadSec,
    freezeTailSec,
    durationSec,
    beatAtSec: beatOut,
    events: { voStart, quipStart, stampAt, markAt: stampAt, clerkStart, cutAt: hasIntro ? introSec : null },
  });
}

/** Approved payoff shot: no beat; VO from the top (may start over an intro), ✓ near the end of the line. */
export function planApprovedShot({ clipDur, voDur, quipDur = 0, introDur = 0 }, p = CONFIG.alignment.placement) {
  const voStart = p.payoffLeadInSec;
  const voEnd = voStart + voDur;
  const quipStart = quipDur > 0 ? voEnd + p.quipGapSec : null;
  const lastAudioEnd = quipStart === null ? voEnd : quipStart + quipDur;
  const durationSec = Math.max(lastAudioEnd + p.tailPadSec, introDur > 0 ? introDur + p.payoffMinClipSec : 0);
  const clipOut = durationSec - introDur;
  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.APPROVED,
    source: { inSec: 0, beatSec: null, outSec: Math.min(clipOut, clipDur) },
    speed: 1,
    introSec: introDur,
    freezeHeadSec: 0,
    freezeTailSec: Math.max(0, clipOut - clipDur),
    durationSec,
    beatAtSec: null,
    events: {
      voStart,
      quipStart,
      stampAt: null,
      markAt: Math.max(voStart, voEnd - p.payoffMarkLeadSec),
      clerkStart: null,
      cutAt: introDur > 0 ? introDur : null,
    },
  });
}

/**
 * Result shot: the action clip (in the animal's habitat) plays to its end; the
 * camera flash in it is the beat — the rule VO ends just before it, the grin
 * follows it. Then a hard cut to the RESULT still (the "taken" passport photo),
 * where the stamp lands and the quip plays. Times are output-local seconds.
 */
/**
 * Times of an action: 'onset' = motion start (the quiet valley before the
 * rise), 'peak' = motion-energy peak, 'complete' = motion has settled (end of
 * the burst). Pure.
 */
export function actionAnchors(action) {
  const onset = action.startT;
  const peak = Math.max(action.peakT, onset);
  return { onset, peak, complete: Math.max(action.endT ?? peak, peak) };
}

export function resultFlash(analysis, flashMode = FLASH_MODE.AUTO, sf = CONFIG.result.syntheticFlash) {
  const real = analysis.flashes?.[0];
  if (real && flashMode !== FLASH_MODE.SYNTHETIC) return { t: real.t, synthetic: false };
  if (!analysis.action?.found) return null;
  const t = actionAnchors(analysis.action)[sf.anchor];
  if (t === undefined) throw new Error(`unknown syntheticFlash.anchor ${sf.anchor} (onset|peak|complete)`);
  return { t, synthetic: true };
}

export function planResultShot({ analysis, voDur, quipDur = 0, clerkDur = 0, flashMode = FLASH_MODE.AUTO, beatPartStartSec = 0, continuous, minVoStartSec = 0, tempo = activeTempo() }, p = CONFIG.alignment.placement, r = CONFIG.result) {
  const flash = resultFlash(analysis, flashMode, r.syntheticFlash);
  if (flash?.synthetic) return planSyntheticResultShot({ analysis, voDur, quipDur, clerkDur, beatPartStartSec, continuous, minVoStartSec, tempo }, p, r);
  if (!flash) {
    return {
      status: SHOT_STATUS.FAILED,
      reason: `no camera flash and no clear action beat for a synthetic one (${analysis.action?.reason ?? 'no analysis'})`,
    };
  }
  const flashSrc = flash.t;
  // A real flash: the clip plays to its end after it.
  const outSrc = analysis.durationSec;
  const neededOut = p.leadInSec + voDur + p.preActionGapSec;
  // Trim idle footage so the VO starts within maxLeadSec of the clip start.
  const inSrc = Math.max(0, flashSrc - (r.maxLeadSec + voDur + p.preActionGapSec));
  const runUpSrc = flashSrc - inSrc;

  let speed = 1;
  let freezeHeadSec = 0;
  if (runUpSrc < neededOut) {
    speed = Math.max(p.minSpeed, runUpSrc / neededOut);
    freezeHeadSec = Math.max(0, neededOut - runUpSrc / speed);
  }
  const flashOut = freezeHeadSec + runUpSrc / speed;
  const clipOut = flashOut + (outSrc - flashSrc);
  const voStart = flashOut - p.preActionGapSec - voDur;

  const stampAt = clipOut + r.stampAfterCutSec;
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const afterStamp = clerkStart === null ? stampAt + p.quipAfterStampSec : clerkStart + clerkDur + p.quipGapSec;
  const quipStart = quipDur > 0 ? afterStamp : null;
  const lastAudioEnd = quipStart !== null ? quipStart + quipDur : clerkStart !== null ? clerkStart + clerkDur : stampAt;
  const resultSec = Math.max(r.minHoldSec, lastAudioEnd + r.tailSec - clipOut);

  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.REJECTED,
    source: { inSec: inSrc, beatSec: flashSrc, outSec: outSrc },
    syntheticFlashAt: null,
    speed,
    introSec: 0,
    freezeHeadSec,
    freezeTailSec: 0,
    resultSec,
    durationSec: clipOut + resultSec,
    beatAtSec: flashOut,
    events: { voStart, quipStart, stampAt, markAt: stampAt, clerkStart, cutAt: null, resultAt: clipOut, shutterAt: flashOut },
  });
}

/** Stamp, clerk, quip and result-still hold after the cut at `clipOut`. Pure. */
function resultTail({ clipOut, quipDur, clerkDur }, p, r) {
  const stampAt = clipOut + r.stampAfterCutSec;
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const afterStamp = clerkStart === null ? stampAt + p.quipAfterStampSec : clerkStart + clerkDur + p.quipGapSec;
  const quipStart = quipDur > 0 ? afterStamp : null;
  const lastAudioEnd = quipStart !== null ? quipStart + quipDur : clerkStart !== null ? clerkStart + clerkDur : stampAt;
  return { stampAt, clerkStart, quipStart, resultSec: Math.max(r.minHoldSec, lastAudioEnd + r.tailSec - clipOut) };
}

/**
 * End of the prelude motion before `onset`: walking back from the onset, the
 * first frame whose smoothed energy rises above valley + quietFraction·(peak −
 * valley), with the peak taken over the preceding lookback window. Everything
 * between this and the onset is "still". Pure.
 */
export function quietStartSec(diff, fps, onsetSec, { quietFraction, preludeLookbackSec }, smoothSec = CONFIG.alignment.action.smoothSec) {
  const s = smooth(diff, Math.max(1, Math.round(smoothSec * fps)));
  const onset = Math.min(s.length - 1, Math.round(onsetSec * fps));
  const from = Math.max(0, onset - Math.round(preludeLookbackSec * fps));
  const valley = s[onset];
  const peak = Math.max(...s.slice(from, onset + 1));
  const level = valley + quietFraction * (peak - valley);
  let i = onset;
  while (i - 1 >= from && s[i - 1] < level) i--;
  return i / fps;
}

/**
 * SNAPPY result shot from one continuous clip. Output: [prelude action (head
 * trimmed, up to preludeMaxSpeed×)] [neutral hold] [action at natural speed]
 * [short hold] → cut. The rule line starts on the first frame (or right after
 * the spoken hook) and ends just before the onset, so the footage before the
 * onset is exactly the line's length; the still part beyond neutralHoldSec is
 * cut. Stamp right after the cut, quip with it, next shot right after the quip.
 */
function planSnappyContinuous({ analysis, voDur, quipDur, clerkDur, onset, complete, spreadSpeed, minVoStartSec = 0, tempo }, p, r) {
  const quiet = analysis.quietStartSec ?? onset;
  const neutralIn = Math.max(quiet, onset - tempo.neutralHoldSec);
  const neutralOut = onset - neutralIn;
  const voFrom = Math.max(tempo.voLeadInSec, minVoStartSec);
  const lineOut = voFrom + voDur + p.preActionGapSec;
  const preludeOut = Math.max(0, lineOut - neutralOut);
  // Fill preludeOut from the action before `quiet`: up to preludeMaxSpeed× (more motion), else slower (≥ minSpeed), else freeze.
  const available = quiet;
  const preludeSpeed = preludeOut === 0 ? 1 : Math.min(tempo.preludeMaxSpeed, Math.max(p.minSpeed, available / preludeOut));
  const preludeSrc = Math.min(available, preludeOut * preludeSpeed);
  const preludeIn = quiet - preludeSrc;
  const freezeHeadSec = Math.max(0, preludeOut - preludeSrc / preludeSpeed);
  const onsetOut = freezeHeadSec + preludeSrc / preludeSpeed + neutralOut;

  // A settle beat holds the stillness a little longer (the pose is the joke).
  const holdSec = analysis.action.mode === BEAT_MODE.SETTLE ? CONFIG.settle.holdSec : tempo.holdAfterFlashSec;
  const holdEnd = Math.min(analysis.durationSec, complete + holdSec);
  const freezeTailSec = Math.max(0, holdSec - (holdEnd - complete));
  const pieces = [
    ...(preludeSrc > 0 ? [{ inSec: preludeIn, outSec: quiet, speed: preludeSpeed }] : []),
    ...(neutralOut > 0 ? [{ inSec: neutralIn, outSec: onset, speed: 1 }] : []),
    ...(complete > onset ? [{ inSec: onset, outSec: complete, speed: spreadSpeed }] : []),
    ...(holdEnd > complete ? [{ inSec: complete, outSec: holdEnd, speed: 1 }] : []),
  ];
  const grinCompleteAtSec = onsetOut + (complete - onset) / spreadSpeed;
  const anchorSrc = actionAnchors(analysis.action)[r.syntheticFlash.anchor] ?? complete;
  const flashOut = onsetOut + (Math.min(anchorSrc, complete) - onset) / spreadSpeed;
  const clipOut = grinCompleteAtSec + holdSec;

  const stampAt = clipOut + tempo.stampAfterCutSec;
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const quipStart = quipDur > 0 ? (clerkStart === null ? stampAt + tempo.quipAfterStampSec : clerkStart + clerkDur + p.quipGapSec) : null;
  const lastAudioEnd = quipStart !== null ? quipStart + quipDur : clerkStart !== null ? clerkStart + clerkDur : stampAt;
  const resultSec = Math.max(tempo.resultMinHoldSec, lastAudioEnd + tempo.cutAfterQuipSec - clipOut);
  const round = (pc) => ({ inSec: round3(pc.inSec), outSec: round3(pc.outSec), speed: round3(pc.speed) });

  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.REJECTED,
    source: { inSec: preludeIn, beatSec: onset, outSec: holdEnd, pieces: pieces.map(round) },
    speed: 1,
    introSec: 0,
    freezeHeadSec,
    freezeTailSec,
    resultSec,
    durationSec: clipOut + resultSec,
    beatAtSec: flashOut,
    syntheticFlashAt: flashOut,
    grinCompleteAtSec,
    grinOnsetAtSec: onsetOut,
    spreadSpeed,
    preludeSpeed,
    neutralHoldSec: neutralOut,
    events: {
      voStart: onsetOut - p.preActionGapSec - voDur,
      quipStart,
      stampAt,
      markAt: stampAt,
      clerkStart,
      cutAt: null,
      resultAt: clipOut,
      shutterAt: flashOut,
    },
  });
}

/**
 * Synthetic-flash result shot from ONE continuous clip: no content cuts. The
 * clip plays from its head (trimmed only if the VO window needs it) through the
 * neutral hold and the grin (sped up only if slow) to the clip end; the flash
 * fires at the configured anchor (default: grin complete); the rule line ends
 * before the grin onset; the final grin frame is held, then the cut.
 */
function planContinuousResult({ analysis, voDur, quipDur, clerkDur, onset, complete, spreadSpeed, minVoStartSec = 0 }, p, r) {
  const sf = r.syntheticFlash;
  // The rule line ends before the action ONSET (wherever the flash is anchored)
  // and starts no earlier than minVoStartSec (e.g. after a spoken hook).
  const voFrom = Math.max(p.leadInSec, minVoStartSec);
  const neededOut = voFrom + voDur + p.preActionGapSec;
  const inSrc = Math.max(0, onset - (Math.max(r.maxLeadSec, minVoStartSec) + voDur + p.preActionGapSec));
  const runUpSrc = onset - inSrc;
  // Too little footage before the onset: slow the prelude (≥ minSpeed), then freeze the first frame.
  const preludeSpeed = runUpSrc >= neededOut ? 1 : Math.max(p.minSpeed, runUpSrc / neededOut);
  const freezeHeadSec = Math.max(0, neededOut - runUpSrc / preludeSpeed);
  const onsetOut = freezeHeadSec + runUpSrc / preludeSpeed;
  // After completion: hold grinHoldSec in total — real footage first, then freeze the last frame.
  const holdEnd = Math.min(analysis.durationSec, complete + sf.grinHoldSec);
  const freezeTailSec = Math.max(0, sf.grinHoldSec - (holdEnd - complete));
  const pieces = [
    { inSec: inSrc, outSec: onset, speed: preludeSpeed },
    ...(complete > onset ? [{ inSec: onset, outSec: complete, speed: spreadSpeed }] : []),
    ...(holdEnd > complete ? [{ inSec: complete, outSec: holdEnd, speed: 1 }] : []),
  ];
  const outAt = (src) => onsetOut + (Math.min(src, complete) - onset) / spreadSpeed;
  const grinCompleteAtSec = outAt(complete);
  // still → action → FLASH at the anchor (default: action complete) → held.
  const flashOut = outAt(actionAnchors(analysis.action)[sf.anchor] ?? complete);
  const clipOut = grinCompleteAtSec + sf.grinHoldSec;
  const tail = resultTail({ clipOut, quipDur, clerkDur }, p, r);
  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.REJECTED,
    source: { inSec: inSrc, beatSec: onset, outSec: holdEnd, pieces: pieces.map((pc) => ({ inSec: round3(pc.inSec), outSec: round3(pc.outSec), speed: pc.speed })) },
    speed: 1,
    introSec: 0,
    freezeHeadSec,
    freezeTailSec,
    resultSec: tail.resultSec,
    durationSec: clipOut + tail.resultSec,
    beatAtSec: flashOut,
    syntheticFlashAt: flashOut,
    grinCompleteAtSec,
    spreadSpeed,
    grinOnsetAtSec: onsetOut,
    events: {
      voStart: onsetOut - p.preActionGapSec - voDur,
      quipStart: tail.quipStart,
      stampAt: tail.stampAt,
      markAt: tail.stampAt,
      clerkStart: tail.clerkStart,
      cutAt: null,
      resultAt: clipOut,
      shutterAt: flashOut,
    },
  });
}

/**
 * Result shot with a SYNTHETIC flash on a multi-part action (prelude part +
 * beat part starting at `beatPartStartSec`). Output is built from source
 * pieces: prelude → brief neutral hold → grin spread (sped up) → grin hold.
 * The flash fires at the grin onset; the rule VO ends just before it and, when
 * long, starts earlier over the prelude (the neutral hold never grows).
 */
export function planSyntheticResultShot(
  { analysis, voDur, quipDur = 0, clerkDur = 0, beatPartStartSec = 0, continuous = beatPartStartSec === 0, minVoStartSec = 0, tempo = activeTempo() } = {},
  p = CONFIG.alignment.placement,
  r = CONFIG.result,
) {
  const sf = r.syntheticFlash;
  const { action } = analysis;
  if (!action?.found) return { status: SHOT_STATUS.FAILED, reason: `no clear grin beat for a synthetic flash (${action?.reason ?? 'no analysis'})` };
  // The grin motion starts at the quiet valley before the rise (startT).
  const onset = action.startT;
  const peak = Math.max(action.peakT, onset);
  // Spread speed: only if the grin takes longer than spreadMaxSec; then aim for spreadTargetSec, within [min, max]×.
  const speedFor = (spread) =>
    spread <= sf.spreadMaxSec ? 1 : Math.min(sf.maxSpreadSpeed, Math.max(sf.minSpreadSpeed, spread / sf.spreadTargetSec));
  if (continuous) {
    const { complete } = actionAnchors(action);
    const args = { analysis, voDur, quipDur, clerkDur, onset, complete, spreadSpeed: speedFor(complete - onset), minVoStartSec };
    return isSnappy(tempo) ? planSnappyContinuous({ ...args, tempo }, p, r) : planContinuousResult(args, p, r);
  }
  const spreadSpeed = speedFor(peak - onset);
  const neutralStart = Math.max(beatPartStartSec, onset - sf.neutralHoldSec);
  const neutralOut = onset - neutralStart;
  const preludeEnd = Math.min(beatPartStartSec, neutralStart);

  // VO ends just before the flash; footage before the flash = prelude + neutral.
  const neededOut = p.leadInSec + voDur + p.preActionGapSec;
  const wantedPrelude = Math.max(0, r.maxLeadSec + voDur + p.preActionGapSec - neutralOut);
  const inSrc = Math.max(0, preludeEnd - wantedPrelude);
  const preludeOut = preludeEnd - inSrc;
  const freezeHeadSec = Math.max(0, neededOut - (preludeOut + neutralOut));
  const flashOut = freezeHeadSec + preludeOut + neutralOut;

  const holdEnd = Math.min(analysis.durationSec, peak + sf.grinHoldSec);
  const pieces = [
    ...(preludeOut > 0 ? [{ inSec: inSrc, outSec: preludeEnd, speed: 1 }] : []),
    ...(neutralOut > 0 ? [{ inSec: neutralStart, outSec: onset, speed: 1 }] : []),
    ...(peak > onset ? [{ inSec: onset, outSec: peak, speed: spreadSpeed }] : []),
    { inSec: peak, outSec: holdEnd, speed: 1 },
  ];
  const clipOut = flashOut + (peak - onset) / spreadSpeed + (holdEnd - peak);
  const voStart = flashOut - p.preActionGapSec - voDur;

  const stampAt = clipOut + r.stampAfterCutSec;
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const afterStamp = clerkStart === null ? stampAt + p.quipAfterStampSec : clerkStart + clerkDur + p.quipGapSec;
  const quipStart = quipDur > 0 ? afterStamp : null;
  const lastAudioEnd = quipStart !== null ? quipStart + quipDur : clerkStart !== null ? clerkStart + clerkDur : stampAt;
  const resultSec = Math.max(r.minHoldSec, lastAudioEnd + r.tailSec - clipOut);

  return finalize({
    status: SHOT_STATUS.OK,
    verdict: VERDICT.REJECTED,
    source: { inSec: inSrc, beatSec: onset, outSec: holdEnd, pieces: pieces.map((pc) => ({ inSec: round3(pc.inSec), outSec: round3(pc.outSec), speed: pc.speed })) },
    speed: 1,
    introSec: 0,
    freezeHeadSec,
    freezeTailSec: 0,
    resultSec,
    durationSec: clipOut + resultSec,
    beatAtSec: flashOut,
    syntheticFlashAt: flashOut,
    grinCompleteAtSec: flashOut + (peak - onset) / spreadSpeed,
    spreadSpeed,
    events: { voStart, quipStart, stampAt, markAt: stampAt, clerkStart, cutAt: null, resultAt: clipOut, shutterAt: flashOut },
  });
}

/**
 * Spoken hook timing. Pure. Returns where the hook VO plays, the earliest start
 * for the first shot's rule line, and how long the hook title stays up.
 */
export function planHook({ hookVoDur = 0, titleDurationSec, tempo = null }, h = CONFIG.hook) {
  if (!(hookVoDur > 0)) return { voStart: null, minFirstVoStartSec: 0, titleUntilSec: titleDurationSec };
  const start = isSnappy(tempo) ? tempo.hookVoStartSec : h.voStartSec;
  const gap = isSnappy(tempo) ? tempo.hookVoGapSec : h.voGapSec;
  const voEnd = start + hookVoDur;
  return { voStart: start, minFirstVoStartSec: voEnd + gap, titleUntilSec: Math.max(titleDurationSec, voEnd + h.titleTailSec) };
}

/** Rejected shots with a result still use the flash-anchored result structure. */
export function planShot(shot, inputs) {
  if (shot.verdict !== VERDICT.REJECTED) return planApprovedShot(inputs);
  if (!inputs.result) return planRejectedShot(inputs);
  const flash = resultFlash(inputs.analysis, inputs.flashMode);
  return flash?.synthetic ? planSyntheticResultShot(inputs) : planResultShot(inputs);
}

/**
 * End card: optional announcer line first (copy + spoken URL), then the
 * APPROVED stamp (thud), the clerk word (unless skipped) and a ding. The card lasts at least
 * `minDurationSec` and stretches to fit its audio. Times are card-local.
 */
export function planEndCard({ voDur = 0, clerkDur = 0, minDurationSec, tempo = null, stampAtSec = null, sheet = null }, e = CONFIG.endCard, p = CONFIG.alignment.placement) {
  if (sheet && voDur > 0) {
    // Photo sheet: build the frame first (sheet in → stamp), then the announcer over the finished frame.
    const stampAt = sheet.inSec + sheet.stampAfterInSec;
    const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
    const voStart = (clerkStart === null ? stampAt : clerkStart + clerkDur) + sheet.voAfterStampSec;
    const dingAt = clerkStart === null ? stampAt + e.dingAfterStampSec : clerkStart + clerkDur + e.dingAfterClerkSec;
    const tail = isSnappy(tempo) ? tempo.endCard.tailSec : e.tailSec;
    const durationSec = Math.max(voStart + voDur + tail, dingAt + tail);
    return finalize({ durationSec, source: {}, events: { voStart, stampAt, clerkStart, dingAt } });
  }
  if (isSnappy(tempo) && voDur > 0) {
    // Announcer from the first frame; stamp at the phrase end (or a fraction of the line); end shortly after the VO.
    const te = tempo.endCard;
    const voStart = te.voLeadInSec;
    const stampAt = voStart + (stampAtSec ?? voDur * te.stampAtFraction);
    const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
    const dingAt = clerkStart === null ? stampAt + e.dingAfterStampSec : clerkStart + clerkDur + e.dingAfterClerkSec;
    const durationSec = Math.max(voStart + voDur + te.tailSec, dingAt + te.tailSec);
    return finalize({ durationSec, source: {}, events: { voStart, stampAt, clerkStart, dingAt } });
  }
  const voStart = voDur > 0 ? e.voLeadInSec : null;
  const stampAt = voDur > 0 ? e.voLeadInSec + voDur + e.stampAfterVoSec : e.stampAtSec;
  const clerkStart = clerkDur > 0 ? stampAt + p.clerkDelaySec : null;
  const dingAt = clerkStart === null ? stampAt + e.dingAfterStampSec : clerkStart + clerkDur + e.dingAfterClerkSec;
  const durationSec = Math.max(minDurationSec, dingAt + e.tailSec);
  return finalize({ durationSec, source: {}, events: { voStart, stampAt, clerkStart, dingAt } });
}
