import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { planApprovedShot, planRejectedShot } from '../lib/alignment.mjs';
import { approximateAlignment, assTime, buildAss, chunkWords, escapeAss, settleChunkTimes, wordsFromAlignment } from '../lib/captions.mjs';
import { CONFIG } from '../lib/config.mjs';
import { BUS, INTRO_KIND, SFX, VERDICT } from '../lib/constants.mjs';
import { stripEmoji } from '../lib/graphics.mjs';
import { offlineClipFilter } from '../lib/providers/offline.mjs';
import { actionConcatArgs, ANCHOR, finalPassArgs, segmentArgs, shotSegmentArgs, shotSegmentFilter, syntheticFlashFilter, musicDuckExpr } from '../lib/render.mjs';
import { checkTimeline, dbToGain, duckWindows, meanLufs, musicGainDb } from '../lib/timeline.mjs';

describe('captions', () => {
  const text = 'Głowa prosto. Nie przechylamy, ani trochę.';
  const alignment = approximateAlignment(text, 2.5);

  it('rebuilds words (with diacritics) from character alignment', () => {
    const words = wordsFromAlignment(alignment);
    assert.deepEqual(words.map((w) => w.text), ['Głowa', 'prosto.', 'Nie', 'przechylamy,', 'ani', 'trochę.']);
    for (const w of words) assert.ok(w.end > w.start);
  });

  it('breaks chunks after punctuation and at the word/char limits', () => {
    const chunks = chunkWords(wordsFromAlignment(alignment));
    assert.deepEqual(chunks.map((c) => c.text), ['Głowa prosto.', 'Nie przechylamy,', 'ani trochę.']);
  });

  it('settles chunk times so captions never overlap', () => {
    const settled = settleChunkTimes([
      { text: 'b', start: 1, end: 1.6 },
      { text: 'a', start: 0, end: 1.2 },
    ]);
    assert.equal(settled[0].text, 'a');
    assert.ok(settled[0].end <= settled[1].start);
  });

  it('strips emoji from burned-in graphic text but keeps Polish letters', () => {
    assert.equal(stripEmoji('Tłumaczą zwierzęta 🐾'), 'Tłumaczą zwierzęta');
    assert.equal(stripEmoji('Zażółć gęślą jaźń'), 'Zażółć gęślą jaźń');
  });

  it('formats ASS times and escapes override braces', () => {
    assert.equal(assTime(0), '0:00:00.00');
    assert.equal(assTime(65.237), '0:01:05.24');
    assert.equal(escapeAss('a{b}\\c'), 'a\\{b\\}\\\\c');
    const ass = buildAss([{ text: 'Zażółć', start: 1, end: 2 }], { fontName: 'Arial' });
    assert.match(ass, /PlayResX: 1080/);
    assert.match(ass, /Dialogue: 0,0:00:01.00,0:00:02.00,Caption,,0,0,0,,Zażółć/);
  });
});

const analysis = { durationSec: 5, flash: { found: true, t: 0.2 }, action: { found: true, t: 2.6 } };

/** A hand-built resolved timeline (the composer's output shape) for the final-pass builders. */
function sampleTimeline() {
  const H = CONFIG.render.height;
  return {
    totalSec: 10,
    overlays: [
      { graphic: 'hook', file: 'hook.png', fromSec: 0, toSec: 2, place: { anchor: 'top', y: CONFIG.layout.hookTop } },
      { graphic: 'mark', file: 'mark.png', fromSec: 1, toSec: 3, place: { anchor: 'center', y: CONFIG.layout.markY } },
      { graphic: 'stamp', file: 'stamp.png', fromSec: 2, toSec: 4, place: { anchor: 'bottom', y: H - CONFIG.layout.stampBottomGap } },
    ],
    audio: [
      { file: 'line.wav', atSec: 1, durSec: 1.5, bus: 'voice', gain: 1 },
      { file: 'thud.wav', atSec: 2, bus: 'sfx', gain: 0.9 },
    ],
    effects: [],
  };
}

describe('brand graphics', () => {
  it('builds the brand chip from a kit chip image: config height, rounded, translucent, shadow-padded', async () => {
    const { default: sharp } = await import('sharp');
    const { brandChipImagePng } = await import('../lib/graphics.mjs');
    const B = { ...CONFIG.brandBug, header: CONFIG.brandBug.chip };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chip-'));
    const file = path.join(dir, 'chip.png');
    await sharp({ create: { width: 680, height: 180, channels: 4, background: '#1e293b' } }).png().toFile(file);
    const png = await brandChipImagePng({ file, iconBox: { x: 35, y: 26, size: 128 } });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.height, B.header.heightPx + 2 * B.shadowPadPx);
    assert.equal(info.width, Math.round((680 * B.header.heightPx) / 180) + 2 * B.shadowPadPx, 'keeps the screenshot aspect');
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    const p = B.shadowPadPx;
    const mid = p + Math.round(B.header.heightPx / 2);
    // The soft shadow under the translucent chip adds alpha: at least the configured opacity, never fully opaque.
    const body = alphaAt(p + Math.round(B.header.heightPx * 1.5), mid);
    assert.ok(body >= Math.round(255 * B.header.opacity) - 3 && body < 255, `translucent body (${body})`);
    assert.ok(alphaAt(p, p) < alphaAt(p + Math.round(B.header.heightPx * B.header.radiusFrac), mid), 'rounded corner cut');
  });

  it('renders the brand bug as a fixed-size chip: icon + wordmark on a dark pill, shadow padding compensated', async () => {
    const { default: sharp } = await import('sharp');
    const { brandBugPng } = await import('../lib/graphics.mjs');
    const B = CONFIG.brandBug;
    const png = await brandBugPng('Brand');
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.height, B.iconPx + 2 * B.chipPadYPx + 2 * B.shadowPadPx, 'height = icon + chip padding + shadow padding');
    // Inside the chip (left edge, vertical centre, just inside the rounded end) the pill fill is opaque-ish.
    const cy = Math.round(info.height / 2);
    const alphaAt = (x, y) => data[(y * info.width + x) * 4 + 3];
    assert.ok(alphaAt(B.shadowPadPx + B.chipPadXPx / 2, cy) > 100, 'chip fill behind the icon edge');
    assert.ok(alphaAt(2, 2) < 40, 'corner outside the pill is (nearly) transparent');
  });

});

describe('ffmpeg builders', () => {
  it('splits a rejected shot at the beat and slows only the run-up', () => {
    const plan = planRejectedShot({ analysis: { ...analysis, action: { found: true, t: 2.2 } }, voDur: 3, clerkDur: 0.8 });
    const f = shotSegmentFilter(plan);
    assert.match(f, /trim=start=0\.000:end=2\.200,setpts=\(PTS-STARTPTS\)\/0\.7\d\d/);
    assert.match(f, /\[b\]trim=start=2\.200:end=/);
    assert.match(f, /scale=1080:1920:force_original_aspect_ratio=increase/);
    assert.match(f, new RegExp(`trim=duration=${plan.durationSec.toFixed(3)}`));
  });

  it('does not split a payoff shot', () => {
    const f = shotSegmentFilter(planApprovedShot({ clipDur: 5, voDur: 3 }));
    assert.doesNotMatch(f, /split/);
  });

  it('wires one input per overlay and per audio event, ducking music under the voice bus', () => {
    const tl = sampleTimeline();
    const music = { file: 'm.mp3', gainDb: -6, duckDb: -10, windows: [{ fromSec: 1, toSec: 2 }], attackSec: 0.1, releaseSec: 0.3, fadeOutSec: 0.4 };
    const args = finalPassArgs(tl, { captionsFile: 'c.ass', music }, 'out.mp4');
    const inputs = args.filter((a) => a === '-i').length;
    assert.equal(inputs, 1 + tl.overlays.length + tl.audio.length + 1);
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.match(graph, /volume=-6\.000dB,volume='1-0\.684\*min\(/);
    assert.match(graph, new RegExp(`afade=t=out:st=${(tl.totalSec - 0.4).toFixed(3)}:d=0\\.400`));
    assert.match(graph, /subtitles=filename=c\.ass:fontsdir=fonts/);
    assert.match(graph, /loudnorm=I=-14/);
    assert.equal(args.at(-1), 'out.mp4');
  });

  it('leaves out the subtitles filter when burned-in captions are off', () => {
    const args = finalPassArgs(sampleTimeline(), { captionsFile: null }, 'o.mp4');
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.doesNotMatch(graph, /subtitles=/);
    assert.match(graph, /format=yuv420p\[vout\]/);
  });

  it('positions top / centre / bottom anchored overlays at y, y − h/2 and y − h', () => {
    const graph = finalPassArgs(sampleTimeline(), { captionsFile: null }, 'o.mp4').join(' ');
    assert.match(graph, new RegExp(`y=${CONFIG.layout.hookTop}:`));
    assert.match(graph, new RegExp(`y=${CONFIG.layout.markY}-overlay_h/2`));
    assert.match(graph, new RegExp(`y=${CONFIG.render.height - CONFIG.layout.stampBottomGap}-overlay_h:`));
  });

  it('adds no music chain when there is no music', () => {
    const graph = finalPassArgs(sampleTimeline(), { captionsFile: 'c.ass' }, 'o.mp4').join(' ');
    assert.doesNotMatch(graph, /afade=t=out/);
  });

  it('builds a hard cut from a Ken Burns intro still into the clip on its flash', () => {
    const plan = planRejectedShot({ analysis: { ...analysis, flash: { found: true, t: 0.08 } }, voDur: 1.5, introDur: 0.8 });
    const f = shotSegmentFilter(plan, { intro: { kind: INTRO_KIND.STILL, file: 'i.png' }, clipAspect: 704 / 1280 });
    assert.match(f, /\[0:v\]split=2\[a\]\[b\];\[a\]trim=start=0\.080:/, 'clip starts on the flash');
    assert.match(f, /crop=w='min\(iw,ih\*0\.550000\)/, 'still cropped to the clip aspect');
    assert.match(f, new RegExp(`zoompan=z='1\\+${CONFIG.intro.pushIn}\\*on/23'`), '24 intro frames, push-in');
    assert.match(f, /\[i\]\[c\]concat=n=2:v=1:a=0,trim=duration=/);
    const args = shotSegmentArgs(plan, 'c.mp4', 'o.mp4', { intro: { kind: INTRO_KIND.STILL, file: 'i.png' }, clipAspect: 0.55 });
    assert.deepEqual(args.slice(0, 4), ['-i', 'c.mp4', '-i', 'i.png']);
  });

  it('uses the TAIL of a provided intro clip, ending on its last (aligned) frame', () => {
    const plan = planRejectedShot({ analysis, voDur: 1.5, introDur: CONFIG.intro.clipDurationSec });
    const f = shotSegmentFilter(plan, { intro: { kind: INTRO_KIND.CLIP, file: 'i.mp4' }, introClipDur: 5.04 });
    assert.doesNotMatch(f, /zoompan/);
    assert.match(f, new RegExp(`\\[1:v\\]trim=start=${(5.04 - plan.introSec).toFixed(3)},`));
    assert.match(f, /tpad=start_duration=0\.000/);
  });

  it('holds the first used intro frame when the intro must run longer than the intro clip', () => {
    const plan = { ...planRejectedShot({ analysis, voDur: 1.5, introDur: 1.2 }), introSec: 2 };
    const f = shotSegmentFilter(plan, { intro: { kind: INTRO_KIND.CLIP, file: 'i.mp4' }, introClipDur: 1.5 });
    assert.match(f, /trim=start=0\.000,/);
    assert.match(f, /tpad=start_duration=0\.500/);
  });

  it('cuts from the clip end to a Ken Burns result still (inputs: clip, result)', () => {
    const plan = {
      ...planRejectedShot({ analysis, voDur: 1.5 }),
      introSec: 0,
      resultSec: 2.5,
      durationSec: 7.5,
      freezeTailSec: 0,
    };
    const result = { file: 'r.png' };
    const f = shotSegmentFilter(plan, { result, clipAspect: 0.55 });
    assert.match(f, /trim=duration=5\.000,setpts=PTS-STARTPTS\[c\]/, 'clip cut at its planned length');
    assert.match(f, new RegExp(`\\[1:v\\]crop=.*zoompan=z='1\\+${CONFIG.result.pushIn}\\*on/74'.*\\[r\\]`));
    assert.match(f, /\[c\]\[r\]concat=n=2:v=1:a=0,trim=duration=7\.500/);
    assert.deepEqual(shotSegmentArgs(plan, 'c.mp4', 'o.mp4', { result, clipAspect: 0.55 }).slice(0, 4), ['-i', 'c.mp4', '-i', 'r.png']);
  });

  it('snaps a between-frames flash time to the nearest frame (never skips the brightest frame)', () => {
    // 6.083 s lies between frames 182 (6.0667) and 183 (6.1); nearest is 182 — its window contains 6.0667.
    assert.match(syntheticFlashFilter(6.083, [1]), /between\(t,6\.050,6\.082\)/);
    // 6.09 s → frame 183 (6.1).
    assert.match(syntheticFlashFilter(6.09, [1]), /between\(t,6\.083,6\.116\)/);
  });

  it('draws a synthetic flash as decaying white frames at the planned time', () => {
    const f = syntheticFlashFilter(2, [0.9, 0.5]);
    assert.match(f, /color=white@0\.9:t=fill:enable='between\(t,1\.983,2\.016\)'/, 'centred on the frame at 2.000');
    assert.match(f, /color=white@0\.5:t=fill:enable='between\(t,2\.017,2\.049\)'/, 'next frame');
    const plan = { ...planRejectedShot({ analysis, voDur: 1.5 }), syntheticFlashAt: 2.4 };
    assert.match(shotSegmentFilter(plan), /drawbox=x=0:y=0:w=iw:h=ih:color=white@/);
    assert.doesNotMatch(shotSegmentFilter(planRejectedShot({ analysis, voDur: 1.5 })), /drawbox/);
  });

  it('time-remaps source pieces (trim + speed) into one stream', () => {
    const plan = {
      ...planRejectedShot({ analysis, voDur: 1.5 }),
      source: { inSec: 0, beatSec: 8, outSec: 9, pieces: [{ inSec: 0, outSec: 4.5, speed: 1 }, { inSec: 8, outSec: 8.8, speed: 3 }] },
    };
    const f = shotSegmentFilter(plan);
    assert.match(f, /\[0:v\]split=2\[s0\]\[s1\]/);
    assert.match(f, /\[s1\]trim=start=8\.000:end=8\.800,setpts=\(PTS-STARTPTS\)\/3\.000\[q1\]/);
    assert.match(f, /\[q0\]\[q1\]concat=n=2:v=1:a=0\[j\]/);
  });

  it('joins action parts by frame index, excluding each part\'s end frame (no duplicate at the join)', () => {
    const args = actionConcatArgs(
      [{ file: 'beach.mp4', startFrame: 0, endFrame: 108 }, { file: 'grin.mp4', startFrame: 0, endFrame: null }],
      24,
      'out.mp4',
    );
    const graph = args[args.indexOf('-filter_complex') + 1];
    assert.match(graph, /\[0:v\]trim=start_frame=0:end_frame=108,/);
    assert.match(graph, /\[1:v\]trim=start_frame=0,setpts/);
    assert.match(graph, /\[p0\]\[p1\]concat=n=2:v=1:a=0\[v\]/);
    assert.deepEqual(args.slice(0, 4), ['-i', 'beach.mp4', '-i', 'grin.mp4']);
  });

  it('builds the offline synthetic clip with the flash and the burst at the injected times', () => {
    const f = offlineClipFilter({ actionAtSec: 2.6, durationSec: 5 });
    assert.match(f, /\(t-2\.6\)\/0\.4/);
    assert.match(f, new RegExp(`between\\(t,${CONFIG.offline.flashAtSec},`));
  });
});

describe('balanced wrapping', () => {
  it('bisects to the narrowest width that still fits', async () => {
    const { narrowestFit } = await import('../lib/graphics.mjs');
    assert.equal(await narrowestFit(100, 800, async (w) => w >= 437, 12), 437);
    assert.equal(await narrowestFit(100, 800, async () => true, 12), 101);
  });

  it('binds one-letter words to the next word (Polish typesetting)', async () => {
    const { bindShortWords } = await import('../lib/graphics.mjs');
    assert.equal(bindShortWords('w minutę, w domu. Zgodne z wymogami'), 'w\u00A0minutę, w\u00A0domu. Zgodne z\u00A0wymogami');
  });
});

describe('verdict sticker placement (rendered)', () => {
  it('is trimmed to its visible pixels: stampWidth wide, its bottom ~90 px above the frame bottom, off the face', async () => {
    const { default: sharp } = await import('sharp');
    const { stampPng, stickerOverlayPng } = await import('../lib/graphics.mjs');
    const png = await stickerOverlayPng(await stampPng({ label: 'REJECTED', brand: 'brand', verdict: VERDICT.REJECTED }));
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, CONFIG.layout.stampWidth);
    const rows = [];
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 40) { rows.push(y); break; }
    }
    // Overlay is bottom-anchored at H − gap, so its last opaque row sits there (±2 px of antialiasing).
    const top = CONFIG.render.height - CONFIG.layout.stampBottomGap - info.height + rows[0];
    const bottom = CONFIG.render.height - CONFIG.layout.stampBottomGap - info.height + rows.at(-1);
    assert.ok(Math.abs(bottom - (CONFIG.render.height - CONFIG.layout.stampBottomGap)) <= 2, `bottom ${bottom}`);
    assert.ok(top >= CONFIG.render.height * 0.7, `sticker top ${top} reaches into the face zone`);
  });
});

describe('musicDuckExpr', () => {
  it('is unity without VO and ramps around each window', () => {
    assert.equal(musicDuckExpr([], { duckDb: -10, attackSec: 0.1, releaseSec: 0.3 }), '1');
    const e = musicDuckExpr([{ fromSec: 1, toSec: 2 }, { fromSec: 4, toSec: 5 }], { duckDb: -20, attackSec: 0.1, releaseSec: 0.3 });
    assert.equal(e, '1-0.900*max(min(clip((t-0.900)/0.100,0,1),clip((2.300-t)/0.300,0,1)),min(clip((t-3.900)/0.100,0,1),clip((5.300-t)/0.300,0,1)))');
  });
});

describe('music levelling + duck windows (pure)', () => {
  const v = (atSec, durSec) => ({ bus: 'voice', atSec, durSec, file: 'v.wav' });
  it('merges close VO events and ignores SFX', () => {
    const w = duckWindows([v(0, 1), v(1.2, 1), v(4, 0.5), { bus: 'sfx', atSec: 3, durSec: 1 }], { mergeGapSec: 0.45 });
    assert.deepEqual(w, [{ fromSec: 0, toSec: 2.2 }, { fromSec: 4, toSec: 4.5 }]);
  });
  it('sets the bed levelDb relative to the voice reference', () => {
    assert.equal(musicGainDb({ bedLufs: -14.6, voiceLufs: -18, levelDb: -9 }).toFixed(1), '-12.4');
    assert.equal(meanLufs([-18, -18]).toFixed(1), '-18.0');
    assert.ok(meanLufs([-10, -30]) > -13.1 && meanLufs([-10, -30]) < -12.9, 'energy mean');
    assert.equal(dbToGain(-20).toFixed(2), '0.10');
  });
  it('the configured ducked bed sits ~18–20 dB under the voice', () => {
    const { levelDb, duckDb } = CONFIG.render.music;
    assert.ok(levelDb + duckDb <= -18 && levelDb + duckDb >= -20);
  });
});
