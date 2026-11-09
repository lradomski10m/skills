// Built-in planners: generic timing solvers that presets call (`plan: { planner, args }`).
// Each returns `{ durationSec, events, segments[] }` in shot-local seconds; segments
// play back to back from 0. The solvers wrap the tested timing logic in
// alignment.mjs, so presets stay data.

import { phraseEndSec, planEndCard, planHook, planShot } from '../alignment.mjs';
import { CONFIG } from '../config.mjs';
import { BEAT_MODE, END_CARD_STYLE, FLASH_MODE, INTRO_KIND, SHOT_STATUS, VERDICT } from '../constants.mjs';
import { UserError } from '../errors.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
/** Preset verdicts are generic (reject / approve / none); the solvers use the 0.1.x names. */
const SOLVER_VERDICT = Object.freeze({ reject: VERDICT.REJECTED, approve: VERDICT.APPROVED, none: VERDICT.APPROVED });
/** The grid end cards show one perfect photo per shot in a 2×2 sheet. */
export const GRID_CELLS = 4;

/**
 * reveal — a subject does something on camera; the beat (action burst or settle)
 * is found by analysis; the line ends before it; a flash marks it; optionally a hard
 * cut to a result still. Wraps planShot (all 0.1.x timing rules and fallbacks).
 */
async function reveal(a, ctx) {
  if (!a.clip) throw new UserError(`${ctx.shotId}: reveal needs a clip`);
  const multiPart = (a.clip.beatSearchFromSec ?? 0) > 0;
  const tailSearch = a.result && !multiPart ? CONFIG.result.syntheticFlash.finalBeatSearchSec : null;
  const beat = a.beat ?? BEAT_MODE.ACTION;
  const analysis = await ctx.analyse(a.clip, { searchFromSec: a.clip.beatSearchFromSec ?? 0, searchLastSec: tailSearch, beat });
  const intro = a.intro ? { kind: a.intro.isClip ? INTRO_KIND.CLIP : INTRO_KIND.STILL, file: a.intro.file } : null;
  const plan = planShot(
    { verdict: SOLVER_VERDICT[a.verdict ?? 'reject'], beat },
    {
      analysis,
      clipDur: analysis.durationSec,
      voDur: a.line?.durationSec ?? 0,
      quipDur: a.quip?.durationSec ?? 0,
      clerkDur: a.clerk?.durationSec ?? 0,
      introDur: !intro ? 0 : intro.kind === INTRO_KIND.CLIP ? CONFIG.intro.clipDurationSec : CONFIG.intro.durationSec,
      result: Boolean(a.result),
      flashMode: a.flash ?? FLASH_MODE.AUTO,
      beatPartStartSec: a.clip.beatSearchFromSec ?? 0,
      continuous: !multiPart,
      minVoStartSec: a.minVoStart ?? 0,
      tempo: ctx.tempo,
    },
  );
  if (plan.status !== SHOT_STATUS.OK) throw new UserError(`${ctx.shotId}: ${plan.reason} — regenerate the clip or choose another beat mode`);
  const ev = plan.events;
  const review = [ev.shutterAt ?? ev.cutAt ?? ev.stampAt].filter((x) => x != null).flatMap((f) => [f - 0.4, f - 0.15, f, f + 0.1]);
  if (ev.resultAt != null) review.push(ev.resultAt + 0.05);
  if (ev.stampAt != null) review.push(ev.stampAt + 0.4);
  return {
    durationSec: plan.durationSec,
    events: { ...ev, flashAt: plan.syntheticFlashAt ?? ev.shutterAt ?? null, verdict: plan.verdict, plan },
    segments: [{ kind: 'planned', durationSec: plan.durationSec, plan, clipFile: a.clip.file, intro, result: a.result ? { file: a.result.file } : null, review }],
  };
}

/** hold — a background (clip, still, colour or graphic) for a fixed or computed duration. */
async function hold(a, ctx) {
  const d = Number(a.duration);
  if (!(d > 0)) throw new UserError(`${ctx.shotId}: hold needs a positive duration (got ${a.duration})`);
  const bg = a.background ?? { color: a.color ?? '#000000' };
  const seg = bg.file && bg.isClip
    ? { kind: 'clip', file: bg.file, inSec: a.in ?? 0, speed: a.speed ?? 1, loop: true }
    : bg.file
      ? { kind: 'still', file: bg.file, kenBurns: a.kenBurns ?? null }
      : bg.graphic
        ? { kind: 'still', graphic: bg.graphic, kenBurns: a.kenBurns ?? null }
        : { kind: 'color', color: bg.color ?? '#000000' };
  return { durationSec: d, events: {}, segments: [{ ...seg, durationSec: d, review: [0.1, d / 2, d - 0.1] }] };
}

/** clip — one clip played in/out at a speed (or reversed), with optional held first/last frames. */
async function clip(a, ctx) {
  if (!a.clip) throw new UserError(`${ctx.shotId}: clip planner needs a clip`);
  const inSec = a.in ?? 0;
  const outSec = Math.min(a.out ?? a.clip.durationSec, a.clip.durationSec);
  const speed = a.speed ?? 1;
  const playSec = (outSec - inSec) / speed;
  const head = a.freezeHead ?? 0;
  const tail = a.freezeTail ?? 0;
  const durationSec = head + playSec + tail;
  return {
    durationSec,
    events: { playStart: head, freezeAt: head + playSec, playSec },
    segments: [{ kind: 'clip', file: a.clip.file, inSec, outSec, speed, reverse: Boolean(a.reverse), freezeHeadSec: head, freezeTailSec: tail, durationSec, review: [0.1, head + playSec / 2, head + playSec - 0.05, durationSec - 0.05] }],
  };
}

/**
 * montage — slices of several clips cut on the music beat (every N beats from the
 * shot's global start), or on a fixed slice length without beats.
 */
async function montage(a, ctx) {
  const clips = a.clips ?? [];
  if (!clips.length) throw new UserError(`${ctx.shotId}: montage needs clips`);
  const every = a.every ?? 1;
  const beats = (ctx.beats?.beats ?? []).filter((b) => b > ctx.globalStart + 0.05);
  const segments = [];
  let t = 0;
  const cuts = [];
  for (const [i, c] of clips.entries()) {
    const next = beats.length ? beats[(i + 1) * every - 1] : null;
    const len = next != null ? next - (ctx.globalStart + t) : a.sliceSec ?? 1;
    if (!(len > 0.05)) break;
    const avail = c.clip.durationSec;
    const inSec = c.in ?? Math.max(0, (avail - len * (c.speed ?? 1)) / 2);
    segments.push({ kind: 'clip', file: c.clip.file, inSec, outSec: Math.min(avail, inSec + len * (c.speed ?? 1)), speed: c.speed ?? 1, freezeTailSec: Math.max(0, len - (avail - inSec) / (c.speed ?? 1)), durationSec: len, review: [len / 2] });
    t += len;
    cuts.push(t);
    if (a.maxSec && t >= a.maxSec) break;
  }
  return { durationSec: t, events: { cuts, starts: cuts.slice(0, -1), slices: segments.length }, segments };
}

/**
 * endcard — the closing card: the announcer line, the approve stamp, clerk word and
 * ding. With a grid style and one perfect photo per shot the sheet builds first and
 * the line plays over the complete frame. Wraps planEndCard.
 */
async function endcard(a, ctx) {
  const style = a.style ?? CONFIG.endCardStyle;
  const photos = style === END_CARD_STYLE.CLASSIC ? null : await ctx.perfectPhotos();
  const grid = Boolean(photos) && photos.length === GRID_CELLS && photos.every(Boolean);
  const line = a.line ?? null;
  const plan = planEndCard({
    voDur: line?.durationSec ?? 0,
    clerkDur: a.clerk?.durationSec ?? 0,
    minDurationSec: a.minDuration ?? CONFIG.endCard.defaultDurationSec,
    tempo: ctx.tempo,
    sheet: grid && CONFIG.photoSheet.timing === 'afterSheetIn' ? CONFIG.photoSheet : null,
    stampAtSec: line && ctx.tempo.endCard && a.stampAtPhrase ? phraseEndSec(line.alignment, line.text ?? '', a.stampAtPhrase) : null,
  });
  const d = plan.durationSec;
  return {
    durationSec: d,
    events: { ...plan.events, grid, style: grid ? style : END_CARD_STYLE.CLASSIC, photos: grid ? photos : null, before: grid ? await ctx.beforePhoto() : null },
    segments: [{ kind: 'card', durationSec: d, backgroundClip: a.backgroundClip?.file ?? null, graphic: { builtin: 'endcard-base', params: { ...(a.card ?? {}), style: grid ? style : END_CARD_STYLE.CLASSIC, grid, overVideo: Boolean(a.backgroundClip) } }, review: [0.05, 0.15, 0.3, 0.6, 2, d - 0.05].filter((x) => x < d) }],
  };
}

/** hook — the opening title (+ spoken hook); no segment of its own. Wraps planHook. */
async function hook(a, ctx) {
  const h = planHook({ hookVoDur: a.line?.durationSec ?? 0, titleDurationSec: a.titleSec ?? 2, tempo: ctx.tempo });
  return { durationSec: 0, events: { voStart: h.voStart, minFirstVoStart: h.minFirstVoStartSec, titleUntil: h.titleUntilSec }, segments: [] };
}

/** overlay — no timing of its own (global overlays, decorations). */
async function none() {
  return { durationSec: 0, events: {}, segments: [] };
}

export const PLANNERS = Object.freeze({ reveal, hold, clip, montage, endcard, hook, none });

export const roundSegments = (segs) => segs.map((s) => ({ ...s, durationSec: r3(s.durationSec) }));
