// Global timeline assembly. Pure: per-shot plans + audio facts in, a flat list
// of segments / audio events / overlays / caption chunks out. The renderer
// only translates this into ffmpeg; every timing decision is made here.

import { chunkWords, placeChunks, settleChunkTimes, wordsFromAlignment } from './captions.mjs';
import { activeTempo, phraseEndSec, planEndCard, planHook } from './alignment.mjs';
import { endCardSheetLayout } from './endcard-layout.mjs';
import { CONFIG } from './config.mjs';
import { BUS, SFX, VERDICT } from './constants.mjs';

/** How an overlay's `y` is read: its top edge, its centre, or a full-frame overlay at 0,0. */
export const ANCHOR = Object.freeze({ TOP: 'top', CENTER: 'center', BOTTOM: 'bottom', FULL: 'full' });

export const GRAPHIC = Object.freeze({
  HOOK: 'hook',
  PILL: (shotId) => `pill-${shotId}`,
  MARK: (verdict) => `mark-${verdict}`,
  STAMP: (verdict) => `stamp-${verdict}`,
  BRAND: 'brand-bug',
  PHOTO_SHEET: 'photo-sheet',
  ENDCARD_BASE: 'endcard-base',
  ENDCARD_FULL: 'endcard-full',
});

const GAIN = Object.freeze({ narrator: 1, announcer: 1, clerk: 1, [SFX.THUD]: 0.9, [SFX.DING]: 0.45, [SFX.SHUTTER]: 0.6, [SFX.WHOOSH]: 0.35 });

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Transparent shadow margin inside the brand-bug PNG (graphics.brandBugPng), so marginPx is the visible margin. */
export const brandBugPadPx = () => CONFIG.brandBug.shadowPadPx;

/** Y of the verdict sticker's bottom edge (the platform UI may overlap it — accepted). */
export const stampBottomY = () => CONFIG.render.height - CONFIG.layout.stampBottomGap;

/**
 * @param {object} args
 * @param {{hook: {durationSec: number}, endCard: {durationSec: number}}} args.spec
 * @param {Array<{shot, plan, clipFile, line: {file, alignment, durationSec}, quip?: {file, alignment, durationSec}}>} args.shots
 * @param {{[verdict]: {file, durationSec}|null}} args.clerk — clerk stamp words (null = skipped role)
 * @param {{thud: string, ding: string}} args.sfx — files
 * @param {boolean} args.withEndCard
 * @param {{file, alignment, durationSec}} [args.announcer] — announcer line over the end card
 * @param {string} [args.endCardBackground] — clip played under the end card (else a solid card)
 * @param {{file, alignment, durationSec}} [args.hookVo] — the spoken hook, from planHook().voStart
 */
export function buildTimeline({ spec, shots, clerk, sfx, withEndCard, announcer = null, endCardBackground = null, hookVo = null, endCardSheet = false }) {
  const segments = [];
  const audio = [];
  const overlays = [];
  const chunks = [];
  const hookEnd = spec.hook.durationSec;
  const { layout } = CONFIG;
  const tempo = activeTempo(spec.tempo ?? CONFIG.tempo.profile);
  /** A whoosh swelling into a cut at `cutSec` (snappy tempo only; not before the first shot). */
  const whooshInto = (cutSec) => {
    if (!tempo.whoosh || cutSec <= 0) return;
    audio.push({ file: sfx[SFX.WHOOSH], atSec: r3(Math.max(0, cutSec - tempo.whoosh.leadSec)), bus: BUS.SFX, gain: tempo.whoosh.gain });
  };
  let t = 0;

  const addLine = (line, at, gain = GAIN.narrator) => {
    audio.push({ file: line.file, atSec: r3(at), durSec: r3(line.durationSec), bus: BUS.VOICE, gain });
    chunks.push(...placeChunks(chunkWords(wordsFromAlignment(line.alignment)), at));
  };

  for (const { shot, plan, clipFile, line, quip, intro = null, result = null } of shots) {
    const start = t;
    const end = start + plan.durationSec;
    const ev = plan.events;
    whooshInto(start);
    segments.push({ kind: 'shot', shotId: shot.id, clipFile, plan, intro, result, startSec: r3(start) });
    // Result structure: the clip's own camera flash gets a shutter click.
    if (ev.shutterAt !== null && ev.shutterAt !== undefined) {
      audio.push({ file: sfx[SFX.SHUTTER], atSec: r3(start + ev.shutterAt), bus: BUS.SFX, gain: GAIN[SFX.SHUTTER] });
    }
    // Habitat intro → clip: a shutter click on the hard cut.
    if (intro && ev.cutAt !== null) audio.push({ file: sfx[SFX.SHUTTER], atSec: r3(start + ev.cutAt), bus: BUS.SFX, gain: GAIN[SFX.SHUTTER] });

    addLine(line, start + ev.voStart);
    if (quip && ev.quipStart !== null) addLine(quip, start + ev.quipStart);

    if (spec.ruleCaptions) {
      overlays.push({ graphic: GRAPHIC.PILL(shot.id), fromSec: r3(Math.max(start, hookEnd)), toSec: r3(end), anchor: ANCHOR.TOP, y: layout.ruleTop });
    }

    if (plan.verdict === VERDICT.REJECTED) {
      // Sticker anchored by its (trimmed) bottom edge near the frame bottom, centred.
      overlays.push({ graphic: GRAPHIC.STAMP(VERDICT.REJECTED), fromSec: r3(start + ev.stampAt), toSec: r3(end), anchor: ANCHOR.BOTTOM, y: stampBottomY() });
      // Optional ✗, after the sticker so it sits on top of its corner.
      if (spec.marks) {
        overlays.push({ graphic: GRAPHIC.MARK(plan.verdict), fromSec: r3(start + ev.markAt), toSec: r3(end), anchor: ANCHOR.CENTER, y: layout.markY, dx: layout.markDx });
      }
      audio.push({ file: sfx[SFX.THUD], atSec: r3(start + ev.stampAt), bus: BUS.SFX, gain: GAIN[SFX.THUD] });
      if (clerk[VERDICT.REJECTED] && ev.clerkStart !== null) {
        audio.push({ file: clerk[VERDICT.REJECTED].file, atSec: r3(start + ev.clerkStart), durSec: r3(clerk[VERDICT.REJECTED].durationSec), bus: BUS.VOICE, gain: GAIN.clerk });
      }
    } else {
      if (spec.marks) overlays.push({ graphic: GRAPHIC.MARK(plan.verdict), fromSec: r3(start + ev.markAt), toSec: r3(end), anchor: ANCHOR.CENTER, y: layout.markY });
      audio.push({ file: sfx[SFX.DING], atSec: r3(start + ev.markAt), bus: BUS.SFX, gain: GAIN[SFX.DING] });
    }
    t = end;
  }

  if (withEndCard) {
    const start = t;
    const clerkWord = clerk[VERDICT.APPROVED];
    whooshInto(start);
    const plan = planEndCard({
      voDur: announcer?.durationSec ?? 0,
      clerkDur: clerkWord?.durationSec ?? 0,
      minDurationSec: spec.endCard.durationSec,
      tempo,
      // Photo sheet ('afterSheetIn'): stamp right after the sheet settles, then the announcer over the finished frame.
      sheet: endCardSheet && CONFIG.photoSheet.timing === 'afterSheetIn' ? CONFIG.photoSheet : null,
      // Real word timing → stamp at the phrase end; approximate timing → null (fraction of the line).
      stampAtSec: announcer && tempo.endCard && spec.endCard.stampAtPhrase ? phraseEndSec(announcer.alignment, announcer.text ?? '', spec.endCard.stampAtPhrase) : null,
    });
    const ev = plan.events;
    const end = start + plan.durationSec;
    segments.push({ kind: 'endcard', durationSec: plan.durationSec, startSec: r3(start), backgroundClip: endCardBackground });
    if (announcer) addLine(announcer, start + ev.voStart, GAIN.announcer);
    if (endCardSheet) {
      // Photo sheet slides/fades in on the card's first frame; the approve stamp then lands on it.
      const L = endCardSheetLayout(spec.endCard.style);
      const ps = CONFIG.photoSheet;
      overlays.push({
        graphic: GRAPHIC.PHOTO_SHEET,
        fromSec: r3(start),
        toSec: r3(end),
        anchor: ANCHOR.TOP,
        x: L.sheet.x - L.pad,
        y: L.sheet.y - L.pad,
        fadeIn: { startSec: r3(start), durSec: ps.inSec },
        slide: { startSec: r3(start), durSec: ps.inSec, dyPx: ps.slideDyPx },
      });
      overlays.push({ graphic: GRAPHIC.STAMP(VERDICT.APPROVED), fromSec: r3(start + ev.stampAt), toSec: r3(end), anchor: ANCHOR.CENTER, y: L.stamp.cy, dx: L.stamp.cx - CONFIG.render.width / 2 });
    }
    // Over a background clip the card itself is an overlay (with a dimming scrim baked in).
    if (endCardBackground && !endCardSheet) {
      overlays.push({ graphic: GRAPHIC.ENDCARD_BASE, fromSec: r3(start), toSec: r3(start + ev.stampAt), anchor: ANCHOR.FULL, y: 0 });
    }
    if (!endCardSheet) overlays.push({ graphic: GRAPHIC.ENDCARD_FULL, fromSec: r3(start + ev.stampAt), toSec: r3(end), anchor: ANCHOR.FULL, y: 0 });
    audio.push({ file: sfx[SFX.THUD], atSec: r3(start + ev.stampAt), bus: BUS.SFX, gain: GAIN[SFX.THUD] });
    if (clerkWord && ev.clerkStart !== null) {
      audio.push({ file: clerkWord.file, atSec: r3(start + ev.clerkStart), durSec: r3(clerkWord.durationSec), bus: BUS.VOICE, gain: GAIN.clerk });
    }
    audio.push({ file: sfx[SFX.DING], atSec: r3(start + ev.dingAt), bus: BUS.SFX, gain: GAIN[SFX.DING] });
    t = end;
  }

  // The hook title stays up at least as long as the spoken hook (+ a short tail).
  const hook = planHook({ hookVoDur: hookVo?.durationSec ?? 0, titleDurationSec: hookEnd, tempo });
  if (hookVo && shots.length) addLine(hookVo, hook.voStart);
  // Persistent brand bug over the animal shots (the end card carries its own big logo).
  const shotsEndSec = segments.filter((sg) => sg.kind === 'shot').reduce((acc, sg) => Math.max(acc, sg.startSec + sg.plan.durationSec), 0);
  if (shotsEndSec > 0) {
    const at = CONFIG.brandBug.marginPx - brandBugPadPx();
    overlays.unshift({ graphic: GRAPHIC.BRAND, fromSec: 0, toSec: r3(shotsEndSec), anchor: ANCHOR.TOP, y: at, x: at });
  }
  if (shots.length) overlays.unshift({ graphic: GRAPHIC.HOOK, fromSec: 0, toSec: r3(Math.min(hook.titleUntilSec, t)), anchor: ANCHOR.TOP, y: layout.hookTop });


  return { totalSec: r3(t), segments, audio, overlays, captions: settleChunkTimes(chunks).map((c) => ({ ...c, start: r3(c.start), end: r3(c.end) })) };
}

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
  return problems;
}
