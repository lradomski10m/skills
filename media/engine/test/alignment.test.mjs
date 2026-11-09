import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFrames, detectFlash, lumaSeries, planApprovedShot, planEndCard, planRejectedShot, planShot } from '../lib/alignment.mjs';
import { CONFIG } from '../lib/config.mjs';
import { activeTempo } from '../lib/alignment.mjs';
/** The original pacing — the pre-'snappy' tests pin it explicitly. */
const RELAXED = activeTempo('relaxed');
import { SHOT_STATUS, VERDICT } from '../lib/constants.mjs';

const FPS = 30;
const W = 72;
const H = 128;
const BOX = 20;
const BURST_FRAMES = 12;

/** Deterministic PRNG (mulberry32) so the noise is reproducible. */
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic clip: grey wall + sensor noise, a dark "subject" box that moves
 * fast during the action burst, and a white flash.
 */
/**
 * Default noise ±1 gives a motion floor of ~0.67 — the run-up floor measured on
 * real i2v footage (fixtures/quokka-real.json: 0.65) after the 72×128 downscale.
 */
function synthClip({ durationSec = 5, flashAtSec = 0.2, flashFrames = 2, actionAtSec = 2.6, noise = 1, seed = 1, motion = true }) {
  const rand = prng(seed);
  const n = Math.round(durationSec * FPS);
  const flashStart = flashAtSec === null ? -1 : Math.round(flashAtSec * FPS);
  const actionFrame = Math.round(actionAtSec * FPS);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const f = new Uint8Array(W * H);
    const progress = motion ? Math.min(1, Math.max(0, (i - actionFrame) / BURST_FRAMES)) : 0;
    const bx = Math.round(10 + 40 * progress);
    const by = 54;
    const flash = flashStart >= 0 && i >= flashStart && i < flashStart + flashFrames;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const inBox = x >= bx && x < bx + BOX && y >= by && y < by + BOX;
        const base = flash ? 250 : inBox ? 50 : 120;
        f[y * W + x] = Math.max(0, Math.min(255, base + Math.round((rand() - 0.5) * 2 * noise)));
      }
    }
    frames.push(f);
  }
  return frames;
}

describe('detection', () => {
  for (const actionAtSec of [2.2, 2.4, 2.6, 2.8, 3.0, 1.4, 3.8]) {
    it(`finds flash and an action beat injected at ${actionAtSec}s within ±1 frame`, () => {
      const a = analyzeFrames(synthClip({ actionAtSec, seed: Math.round(actionAtSec * 10) }), FPS);
      assert.equal(a.flash.found, true);
      assert.ok(Math.abs(a.flash.startFrame - Math.round(0.2 * FPS)) <= 1, `flash frame ${a.flash.startFrame}`);
      assert.equal(a.action.found, true, a.action.reason);
      const expected = Math.round(actionAtSec * FPS);
      assert.ok(Math.abs(a.action.frame - expected) <= 1, `beat frame ${a.action.frame}, expected ${expected}±1`);
    });
  }

  for (const flashAtSec of [0, 0.5, 1.2]) {
    it(`finds a flash at ${flashAtSec}s (including frame 0)`, () => {
      const flash = detectFlash(lumaSeries(synthClip({ flashAtSec, actionAtSec: 3 })), FPS);
      assert.equal(flash.found, true);
      assert.ok(Math.abs(flash.startFrame - Math.round(flashAtSec * FPS)) <= 1);
    });
  }

  it('reports a missing flash', () => {
    const a = analyzeFrames(synthClip({ flashAtSec: null }), FPS);
    assert.equal(a.flash.found, false);
    assert.match(a.flash.reason, /no flash/);
  });

  it('reports no clear action beat when the clip only has sensor noise', () => {
    const a = analyzeFrames(synthClip({ motion: false, noise: 6 }), FPS);
    assert.equal(a.flash.found, true);
    assert.equal(a.action.found, false);
    assert.match(a.action.reason, /no clear action beat/);
  });

  it('finds the burst over continuous gentle idle movement (breathing / twitching)', () => {
    const frames = synthClip({ actionAtSec: 2.6, seed: 9 });
    // Overlay a small patch that sways ±2 px every frame for the whole clip.
    frames.forEach((f, i) => {
      const ox = 50 + Math.round(2 * Math.sin(i / 2));
      for (let y = 10; y < 22; y++) for (let x = ox; x < ox + 10; x++) f[y * W + x] = 30;
    });
    const a = analyzeFrames(frames, FPS);
    assert.equal(a.action.found, true, a.action.reason);
    assert.ok(Math.abs(a.action.frame - 78) <= 1, `beat frame ${a.action.frame}`);
  });

  it('never mistakes the flash itself for the action', () => {
    const a = analyzeFrames(synthClip({ actionAtSec: 2.6, flashFrames: 4 }), FPS);
    assert.ok(a.action.t > a.flash.endT + CONFIG.alignment.action.settleSec - 1 / FPS);
  });
});

const P = CONFIG.alignment.placement;
const fakeAnalysis = (flashT, beatT, durationSec = 5) => ({
  durationSec,
  flash: { found: true, t: flashT, endT: flashT + 0.07 },
  action: { found: true, t: beatT },
});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.002, `${msg}: ${a} vs ${b}`);

describe('placement — rejected shot', () => {
  it('fits a short VO at normal speed and ends it just before the beat', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 2.6), voDur: 1.5, clerkDur: 0.7 });
    assert.equal(plan.status, SHOT_STATUS.OK);
    assert.equal(plan.speed, 1);
    assert.equal(plan.freezeHeadSec, 0);
    near(plan.source.inSec, 0, 'in point (flash − preFlash, clamped)');
    near(plan.beatAtSec, 2.6, 'beat on output');
    near(plan.events.voStart + 1.5, plan.beatAtSec - P.preActionGapSec, 'VO ends just before the beat');
    near(plan.events.stampAt, plan.beatAtSec + P.stampDelaySec, 'stamp after the beat');
    near(plan.events.clerkStart, plan.events.stampAt + P.clerkDelaySec, 'clerk after the thud');
  });

  it('slows the run-up (≥ minSpeed) when the VO is a little too long', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 2.2), voDur: 2.3, clerkDur: 0.7 });
    assert.ok(plan.speed < 1 && plan.speed >= P.minSpeed, `speed ${plan.speed}`);
    assert.equal(plan.freezeHeadSec, 0);
    near(plan.events.voStart, P.leadInSec, 'VO starts at the lead-in');
    near(plan.events.voStart + 2.3, plan.beatAtSec - P.preActionGapSec, 'VO still ends before the beat');
  });

  it('caps the slow-down and freezes the opening frame for the rest', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 2.2), voDur: 5.2, clerkDur: 0.7 });
    assert.equal(plan.speed, P.minSpeed);
    assert.ok(plan.freezeHeadSec > 0);
    near(plan.events.voStart, P.leadInSec, 'VO starts at the lead-in');
    near(plan.beatAtSec, plan.freezeHeadSec + (2.2 - 0) / P.minSpeed, 'beat after freeze + stretched run-up');
  });

  it('places the quip after the clerk word and freezes the tail if the clip runs out', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 4.2, 5), voDur: 1, quipDur: 0.8, clerkDur: 0.8 });
    near(plan.events.quipStart, plan.events.clerkStart + 0.8 + P.quipGapSec, 'quip after clerk');
    near(plan.durationSec, plan.events.quipStart + 0.8 + P.tailPadSec, 'duration covers the quip');
    assert.ok(plan.freezeTailSec > 0, 'tail freeze when post-beat source is too short');
    near(plan.source.outSec, 5, 'out point clamped to clip end');
  });

  it('fails the shot when no action beat was detected', () => {
    const analysis = { durationSec: 5, flash: { found: true, t: 0.2 }, action: { found: false, reason: 'no clear action beat' } };
    const plan = planShot({ verdict: VERDICT.REJECTED }, { analysis, voDur: 1, clerkDur: 0.5 });
    assert.equal(plan.status, SHOT_STATUS.FAILED);
    assert.match(plan.reason, /action beat/);
  });

  it('fails the shot when no flash was detected', () => {
    const analysis = { durationSec: 5, flash: { found: false, reason: 'no flash in first 1.5s' }, action: { found: true, t: 2 } };
    assert.equal(planRejectedShot({ analysis, voDur: 1, clerkDur: 0.5 }).status, SHOT_STATUS.FAILED);
  });
});

describe('placement — approved payoff', () => {
  it('starts the VO at the lead-in and shows the ✓ near its end', () => {
    const plan = planApprovedShot({ clipDur: 5, voDur: 3.8 });
    near(plan.events.voStart, P.payoffLeadInSec, 'VO start');
    near(plan.events.markAt, P.payoffLeadInSec + 3.8 - P.payoffMarkLeadSec, 'mark near VO end');
    assert.equal(plan.freezeTailSec, 0);
  });

  it('freezes the last frame when the VO outlasts the clip', () => {
    const plan = planApprovedShot({ clipDur: 5, voDur: 5.5 });
    assert.ok(plan.freezeTailSec > 0);
    near(plan.source.outSec, 5, 'out point at clip end');
  });
});

describe('placement — end card', () => {
  const E = CONFIG.endCard;

  it('speaks the URL line first, then stamps, then the clerk word and the ding', () => {
    const plan = planEndCard({ voDur: 1.6, clerkDur: 0.9, minDurationSec: 3 });
    near(plan.events.voStart, E.voLeadInSec, 'VO lead-in');
    near(plan.events.stampAt, E.voLeadInSec + 1.6 + E.stampAfterVoSec, 'stamp after the VO');
    near(plan.events.clerkStart, plan.events.stampAt + P.clerkDelaySec, 'clerk after the thud');
    near(plan.events.dingAt, plan.events.clerkStart + 0.9 + E.dingAfterClerkSec, 'ding after the clerk');
    near(plan.durationSec, plan.events.dingAt + E.tailSec, 'card stretches to fit its audio');
  });

  it('keeps the minimum duration and the fixed stamp time without a VO line', () => {
    const plan = planEndCard({ clerkDur: 0.5, minDurationSec: 4 });
    assert.equal(plan.events.voStart, null);
    near(plan.events.stampAt, E.stampAtSec, 'fixed stamp time');
    near(plan.durationSec, 4, 'minimum duration');
  });
});

describe('placement — skipped clerk word', () => {
  it('starts the quip right after the thud when there is no clerk word', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 2.6), voDur: 1.5, quipDur: 0.8 });
    assert.equal(plan.events.clerkStart, null);
    near(plan.events.quipStart, plan.events.stampAt + P.quipAfterStampSec, 'quip after the thud');
  });

  it('rings the end-card ding after the thud when there is no clerk word, sized by the announcer', () => {
    const plan = planEndCard({ voDur: 5.6, minDurationSec: 3 });
    assert.equal(plan.events.clerkStart, null);
    near(plan.events.dingAt, plan.events.stampAt + CONFIG.endCard.dingAfterStampSec, 'ding after the thud');
    near(plan.events.stampAt, CONFIG.endCard.voLeadInSec + 5.6 + CONFIG.endCard.stampAfterVoSec, 'stamp after the announcer');
  });
});

describe('detection — real i2v footage (measured fixture)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries } = await import('../lib/alignment.mjs');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/quokka-real.json', import.meta.url), 'utf8'));

  it('finds the camera flash at the start of the quokka clip', () => {
    const a = analyzeSeries(fixture, fixture.fps);
    assert.equal(a.flash.found, true);
    assert.ok(a.flash.t < 0.2, `flash at ${a.flash.t}`);
  });

  it('lands the beat on the smile (~3.4–4 s), not on the stray second flash at ~3.25 s', () => {
    const a = analyzeSeries(fixture, fixture.fps);
    assert.deepEqual(a.strayFlashesSec, [3.25]);
    assert.equal(a.action.found, true, a.action.reason);
    assert.ok(a.action.t >= 3.3 && a.action.t <= 3.6, `onset ${a.action.t}`);
    assert.ok(a.action.peakT >= 3.5 && a.action.peakT <= 4.1, `peak ${a.action.peakT}`);
  });

  it('reports no clear beat when the smile is flattened to the run-up level (negative control)', () => {
    const onset = Math.round(3.3 * fixture.fps);
    const flat = fixture.diff.map((d, i) => (i >= onset ? 0.65 : d));
    const a = analyzeSeries({ luma: fixture.luma, diff: flat }, fixture.fps);
    assert.equal(a.action.found, false);
  });
});

describe('placement — habitat intro', () => {
  const INTRO = 0.8;

  it('starts the clip exactly on its flash and cuts there after the intro', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.08, 3.38), voDur: 1.5, introDur: INTRO });
    near(plan.source.inSec, 0.08, 'clip in-point = flash');
    near(plan.introSec, INTRO, 'intro length');
    near(plan.events.cutAt, INTRO, 'cut at the end of the intro');
    near(plan.beatAtSec, INTRO + (3.38 - 0.08), 'beat after intro + run-up');
    assert.equal(plan.freezeHeadSec, 0);
  });

  it('lets the rule VO start during the intro when the run-up is short', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.08, 1.6), voDur: 2, introDur: INTRO });
    assert.ok(plan.events.voStart < plan.introSec, `VO starts at ${plan.events.voStart}, intro ends ${plan.introSec}`);
    near(plan.events.voStart + 2, plan.beatAtSec - P.preActionGapSec, 'VO still ends just before the beat');
  });

  it('holds the intro longer instead of freezing the flash frame when the VO is very long', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.08, 1.2), voDur: 4.5, introDur: INTRO });
    assert.equal(plan.speed, P.minSpeed);
    assert.equal(plan.freezeHeadSec, 0, 'never freeze the flash frame');
    assert.ok(plan.introSec > INTRO, `intro extended to ${plan.introSec}`);
    near(plan.events.voStart, P.leadInSec, 'VO from the lead-in');
  });

  it('keeps the no-intro behaviour unchanged (pre-flash lead, freeze head)', () => {
    const plan = planRejectedShot({ analysis: fakeAnalysis(0.2, 1.2), voDur: 4.5 });
    near(plan.source.inSec, 0, 'pre-flash in-point');
    assert.equal(plan.introSec, 0);
    assert.ok(plan.freezeHeadSec > 0);
    assert.equal(plan.events.cutAt, null);
  });

  it('prepends the intro to a payoff shot and still shows the clip', () => {
    const plan = planApprovedShot({ clipDur: 5, voDur: 0.5, introDur: INTRO });
    near(plan.introSec, INTRO, 'intro');
    assert.ok(plan.durationSec >= INTRO + P.payoffMinClipSec);
    near(plan.source.outSec, plan.durationSec - INTRO, 'clip fills the rest');
  });
});

describe('placement — result shot (habitat action clip → flash → result still)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot, flashRuns } = await import('../lib/alignment.mjs');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/quokka-beach.json', import.meta.url), 'utf8'));
  const analysis = analyzeSeries(fixture, fixture.fps);
  const R = CONFIG.result;

  it('finds the single late camera flash anywhere in the clip (frame 126, ~5.25 s)', () => {
    assert.equal(analysis.flashes.length, 1);
    assert.equal(analysis.flashes[0].startFrame, 126);
    assert.equal(flashRuns(fixture.luma.map(() => 130), fixture.fps).length, 0, 'flat clip: no flash');
  });

  it('ends the rule VO just before the flash, plays the grin to the clip end, then holds the result still', () => {
    const plan = planResultShot({ analysis, voDur: 4.4, quipDur: 1.84 });
    assert.equal(plan.status, SHOT_STATUS.OK);
    near(plan.events.voStart + 4.4, plan.beatAtSec - P.preActionGapSec, 'VO ends just before the flash');
    near(plan.events.shutterAt, plan.beatAtSec, 'shutter on the flash');
    near(plan.source.outSec, analysis.durationSec, 'clip plays to its end');
    near(plan.events.resultAt, plan.beatAtSec + (analysis.durationSec - analysis.flashes[0].t), 'cut after the grin');
    near(plan.events.stampAt, plan.events.resultAt + R.stampAfterCutSec, 'stamp lands on the result still');
    near(plan.events.quipStart, plan.events.stampAt + P.quipAfterStampSec, 'quip after the thud (clerk skipped)');
    near(plan.durationSec, plan.events.quipStart + 1.84 + R.tailSec, 'still holds until the quip ends + tail');
    assert.ok(plan.events.voStart >= 0 && plan.events.voStart <= P.leadInSec + R.maxLeadSec + 0.001, `VO starts at ${plan.events.voStart}`);
  });

  it('trims idle footage so the VO starts within maxLeadSec', () => {
    const plan = planResultShot({ analysis, voDur: 1.5 });
    near(plan.source.inSec, analysis.flashes[0].t - (R.maxLeadSec + 1.5 + P.preActionGapSec), 'head trimmed');
    near(plan.events.voStart, R.maxLeadSec, 'VO after the allowed lead');
  });

  it('slows / freezes the run-up when the VO is longer than the footage before the flash', () => {
    const plan = planResultShot({ analysis: { durationSec: 3, flashes: [{ t: 1.5 }] }, voDur: 3 });
    assert.equal(plan.speed, P.minSpeed);
    assert.ok(plan.freezeHeadSec > 0);
  });

  it('fails without a flash, and keeps a minimum result hold', () => {
    assert.equal(planResultShot({ analysis: { durationSec: 5, flashes: [] }, voDur: 2 }).status, SHOT_STATUS.FAILED);
    const plan = planResultShot({ analysis, voDur: 2 });
    assert.ok(plan.resultSec >= R.minHoldSec);
  });

  it('planShot routes rejected shots with a result still to the result planner', () => {
    assert.ok(planShot({ verdict: VERDICT.REJECTED }, { analysis, voDur: 2, result: true }).resultSec > 0);
  });
});

describe('result shot — multi-part action with a synthetic flash (measured fixture)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot, resultFlash } = await import('../lib/alignment.mjs');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/quokka-action.json', import.meta.url), 'utf8'));
  const JOIN = 4.5;
  const analysis = analyzeSeries(fixture, fixture.fps, { searchFromSec: JOIN });
  const SF = CONFIG.result.syntheticFlash;

  it('has no real flash; the grin beat is found 3–4 s into the transition part', () => {
    assert.equal(analysis.flashes.length, 0);
    assert.equal(analysis.action.found, true, analysis.action.reason);
    const intoPart = analysis.action.t - JOIN;
    assert.ok(intoPart >= 3 && intoPart <= 4, `onset ${intoPart.toFixed(2)} s into the transition`);
    assert.ok(analysis.action.peakT > analysis.action.t);
  });

  it('would pick the prelude head-turn without the search window (why the window exists)', () => {
    const whole = analyzeSeries(fixture, fixture.fps);
    assert.ok(whole.action.t < JOIN, `unwindowed beat at ${whole.action.t}`);
  });

  const plan = planResultShot({ analysis, voDur: 4.4, quipDur: 1.84, beatPartStartSec: JOIN });
  const pieces = plan.source.pieces;
  const outLen = (pc) => (pc.outSec - pc.inSec) / pc.speed;

  it('fires the synthetic flash at the START of the grin motion, after a brief neutral hold', () => {
    assert.equal(plan.status, SHOT_STATUS.OK);
    near(plan.source.beatSec, analysis.action.startT, 'flash source time = start of the grin motion');
    const intoPart = analysis.action.startT - JOIN;
    assert.ok(intoPart >= 2.9 && intoPart <= 3.3, `motion start ${intoPart.toFixed(2)} s into the transition (measured valley ~3.0 s)`);
    assert.ok(analysis.action.startT < analysis.action.t, 'start precedes the half-height onset');
    near(plan.syntheticFlashAt, plan.beatAtSec, 'flash drawn at the beat');
    const neutral = pieces.find((pc) => pc.outSec === Math.round(analysis.action.startT * 1000) / 1000 && pc.speed === 1);
    near(outLen(neutral), SF.neutralHoldSec, 'neutral hold = config');
  });

  it('keeps the prelude motion from the head (looking around) and cuts only neutral footage', () => {
    near(pieces[0].inSec, 0, 'prelude kept from the clip start');
    near(pieces[0].outSec, JOIN, 'prelude runs to the join');
    assert.ok(pieces[1].inSec > JOIN, 'the jump cut drops neutral footage inside the beat part');
  });

  it('compresses the grin spread so it completes ~0.25–0.35 s after the flash, then holds it', () => {
    const spread = pieces.find((pc) => pc.speed === plan.spreadSpeed);
    assert.ok(plan.spreadSpeed >= SF.minSpreadSpeed && plan.spreadSpeed <= SF.maxSpreadSpeed);
    near(spread.inSec, analysis.action.startT, 'spread starts at the motion start');
    near(spread.outSec, analysis.action.peakT, 'spread ends at the peak');
    const afterFlash = plan.grinCompleteAtSec - plan.beatAtSec;
    assert.ok(afterFlash >= 0.2 && afterFlash <= 0.4, `grin complete ${afterFlash.toFixed(2)} s after the flash`);
    near(outLen(pieces.at(-1)), SF.grinHoldSec, 'grin hold');
    near(plan.events.resultAt, plan.grinCompleteAtSec + SF.grinHoldSec, 'cut to the result after the hold');
  });

  it('ends the rule VO just before the flash, starting over the prelude', () => {
    near(plan.events.voStart + 4.4, plan.beatAtSec - P.preActionGapSec, 'VO ends just before the flash');
    assert.ok(plan.events.voStart < JOIN, 'VO starts over the prelude');
  });

  it('starts a long VO earlier rather than lengthening the neutral hold', () => {
    const long = planResultShot({ analysis, voDur: 7, beatPartStartSec: JOIN });
    const neutral = long.source.pieces[1];
    near(outLen(neutral), SF.neutralHoldSec, 'neutral hold unchanged');
    near(long.events.voStart + 7, long.beatAtSec - P.preActionGapSec, 'still ends before the flash');
  });

  it('prefers a real flash in auto mode, and can force a synthetic one', () => {
    const withReal = { ...analysis, flashes: [{ t: 2 }] };
    assert.deepEqual(resultFlash(withReal), { t: 2, synthetic: false });
    assert.equal(resultFlash(withReal, 'synthetic').synthetic, true);
    assert.equal(resultFlash({ flashes: [], action: { found: false } }), null);
  });
});

describe('result shot — one continuous clip, synthetic flash, no cuts (measured fixture)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot } = await import('../lib/alignment.mjs');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/quokka-oneshot.json', import.meta.url), 'utf8'));
  const SF = CONFIG.result.syntheticFlash;
  const analysis = analyzeSeries(fixture, fixture.fps, { searchLastSec: SF.finalBeatSearchSec });
  const plan = planResultShot({ analysis, voDur: 4.4, quipDur: 1.84, continuous: true, tempo: RELAXED });

  it('finds the FINAL burst (the grin at ~6.7–7.0 s), not the earlier looking around', () => {
    assert.equal(analysis.flashes.length, 0);
    assert.equal(analysis.action.found, true, analysis.action.reason);
    assert.ok(analysis.action.startT >= 6.5 && analysis.action.startT <= 6.9, `grin start ${analysis.action.startT}`);
    // Unwindowed, the looking around dominates: no beat, or one in the wrong place.
    const whole = analyzeSeries(fixture, fixture.fps);
    assert.ok(!whole.action.found || whole.action.t < 6, 'the grin is only found with the final-burst window');
  });

  it('plays the clip continuously from its head: no content cuts', () => {
    const pieces = plan.source.pieces;
    near(pieces[0].inSec, 0, 'from the clip start');
    for (let k = 1; k < pieces.length; k++) near(pieces[k].inSec, pieces[k - 1].outSec, 'contiguous');
    near(pieces.at(-1).outSec, analysis.durationSec, 'to the clip end');
  });

  it('still → grin forms at 1× → FLASH when the grin is complete → final frame held → cut', () => {
    assert.ok(analysis.action.startT >= 6.5 && analysis.action.startT <= 6.8, `onset ${analysis.action.startT}`);
    assert.ok(analysis.action.peakT >= 6.9 && analysis.action.peakT <= 7.04, `peak ${analysis.action.peakT}`);
    assert.equal(plan.spreadSpeed, 1, 'the grin forms at natural speed');
    near(plan.grinOnsetAtSec, analysis.action.startT, 'no head trim, no freeze');
    near(plan.syntheticFlashAt, analysis.action.peakT, 'flash at the grin peak (default anchor)');
    near(plan.events.shutterAt, plan.syntheticFlashAt, 'shutter with the flash');
    // Hold grinHoldSec in total after completion: the clip's remaining footage first, then a freeze.
    near(plan.freezeTailSec, SF.grinHoldSec - (analysis.durationSec - analysis.action.peakT), 'freeze only what footage lacks');
    near(plan.events.resultAt, plan.grinCompleteAtSec + SF.grinHoldSec, 'cut after the hold');
  });

  it('ends the rule line before the grin ONSET (not just before the flash)', () => {
    near(plan.events.voStart + 4.4, plan.grinOnsetAtSec - P.preActionGapSec, 'line ends before the onset');
    assert.ok(plan.events.voStart + 4.4 < plan.syntheticFlashAt);
  });

  it('can anchor the flash at the onset instead (config)', () => {
    const r = { ...CONFIG.result, syntheticFlash: { ...SF, anchor: 'onset' } };
    const onsetPlan = planResultShot({ analysis, voDur: 4.4, quipDur: 1.84, continuous: true, tempo: RELAXED }, P, r);
    near(onsetPlan.syntheticFlashAt, onsetPlan.grinOnsetAtSec, 'flash at the onset');
    const bad = { ...CONFIG.result, syntheticFlash: { ...SF, anchor: 'middle' } };
    assert.throws(() => planResultShot({ analysis, voDur: 4.4, continuous: true, tempo: RELAXED }, P, bad), /unknown syntheticFlash\.anchor/);
  });
});

describe('result shot — dog head tilt (one continuous clip, measured fixture)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot, actionAnchors } = await import('../lib/alignment.mjs');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/dog-oneshot.json', import.meta.url), 'utf8'));
  const SF = CONFIG.result.syntheticFlash;
  const analysis = analyzeSeries(fixture, fixture.fps, { searchLastSec: SF.finalBeatSearchSec });
  const plan = planResultShot({ analysis, voDur: 3.6, quipDur: 1.2, continuous: true, tempo: RELAXED });
  const a = actionAnchors(analysis.action);

  it('finds the head tilt as the final burst (not the panting at 0–2 s)', () => {
    assert.equal(analysis.flashes.length, 0);
    assert.equal(analysis.action.found, true, analysis.action.reason);
    assert.ok(a.onset >= 5.4 && a.onset <= 5.8, `tilt onset ${a.onset}`);
    assert.ok(a.complete >= 5.9 && a.complete <= 6.25, `tilt complete ${a.complete}`);
  });

  it('flashes when the tilt is complete, at natural speed, then holds 0.4 s of real footage', () => {
    assert.equal(plan.spreadSpeed, 1, 'a 0.5 s tilt plays at natural speed');
    near(plan.syntheticFlashAt, plan.grinCompleteAtSec, 'flash at completion (default anchor)');
    near(plan.syntheticFlashAt, a.complete, 'no remap before it: output = source');
    assert.equal(plan.freezeTailSec, 0, 'footage covers the hold, no freeze');
    near(plan.events.resultAt, plan.grinCompleteAtSec + SF.grinHoldSec, 'cut 0.4 s after completion');
  });

  it('ends the rule line before the tilt onset', () => {
    near(plan.events.voStart + 3.6, plan.grinOnsetAtSec - P.preActionGapSec, 'line ends before the onset');
  });
});

describe('spoken hook', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planHook, planResultShot } = await import('../lib/alignment.mjs');
  const H = CONFIG.hook;

  it('plays at voStartSec, delays the first rule line, keeps the title up for it', () => {
    const h = planHook({ hookVoDur: 2.32, titleDurationSec: 2 });
    near(h.voStart, H.voStartSec, 'hook VO start');
    near(h.minFirstVoStartSec, H.voStartSec + 2.32 + H.voGapSec, 'first line after the hook + gap');
    near(h.titleUntilSec, H.voStartSec + 2.32 + H.titleTailSec, 'title outlasts the hook VO');
    assert.deepEqual(planHook({ titleDurationSec: 2 }), { voStart: null, minFirstVoStartSec: 0, titleUntilSec: 2 });
  });

  it('starts the quokka line after the hook and still ends it before the onset (slows the prelude slightly)', async () => {
    const fixture = JSON.parse(await readFile(new URL('./fixtures/quokka-oneshot.json', import.meta.url), 'utf8'));
    const analysis = analyzeSeries(fixture, fixture.fps, { searchLastSec: CONFIG.result.syntheticFlash.finalBeatSearchSec });
    const minVoStartSec = planHook({ hookVoDur: 2.32, titleDurationSec: 2 }).minFirstVoStartSec;
    const plan = planResultShot({ analysis, voDur: 4.4, quipDur: 1.84, continuous: true, minVoStartSec, tempo: RELAXED });
    near(plan.events.voStart, minVoStartSec, 'line starts right after the hook');
    near(plan.events.voStart + 4.4, plan.grinOnsetAtSec - P.preActionGapSec, 'and ends before the onset');
    const prelude = plan.source.pieces[0];
    near(prelude.inSec, 0, 'no head trim (nothing to trim)');
    assert.ok(prelude.speed < 1 && prelude.speed >= P.minSpeed, `prelude slowed to ${prelude.speed}`);
    assert.equal(plan.freezeHeadSec, 0);
  });
});

describe('snappy tempo (pure planners)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot, planHook, planEndCard, phraseEndSec, activeTempo: tempoOf } = await import('../lib/alignment.mjs');
  const SNAPPY = tempoOf('snappy');
  const SF = CONFIG.result.syntheticFlash;
  const load = async (n) => {
    const fx = JSON.parse(await readFile(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
    return analyzeSeries(fx, fx.fps, { searchLastSec: SF.finalBeatSearchSec });
  };
  const VO = 1.1; // narrator playback speed
  const quokka = await load('quokka-oneshot');
  const dog = await load('dog-oneshot');
  const hook = planHook({ hookVoDur: 2.32 / VO, titleDurationSec: 2, tempo: SNAPPY });
  const q = planResultShot({ analysis: quokka, voDur: 4.4 / VO, quipDur: 1.84 / VO, continuous: true, minVoStartSec: hook.minFirstVoStartSec, tempo: SNAPPY });
  const d = planResultShot({ analysis: dog, voDur: 3.6 / VO, quipDur: 1.2 / VO, continuous: true, tempo: SNAPPY });

  it('starts the hook at 0 and the first line ≤ 0.1 s after it', () => {
    near(hook.voStart, 0, 'hook at 0');
    near(q.events.voStart, 2.32 / VO + SNAPPY.hookVoGapSec, 'first line right after the hook');
  });

  it('detects where the prelude motion ends (quokka ~5.4 s, dog ~3.75 s)', () => {
    assert.ok(quokka.quietStartSec >= 5.2 && quokka.quietStartSec <= 5.6, `quokka ${quokka.quietStartSec}`);
    assert.ok(dog.quietStartSec >= 3.5 && dog.quietStartSec <= 4.0, `dog ${dog.quietStartSec}`);
  });

  it('dog: line on the first frame, ends before the onset; neutral hold ≈ 0.5 s; prelude ≤ 1.3×', () => {
    near(d.events.voStart, 0, 'line starts on the first frame');
    near(d.events.voStart + 3.6 / VO, d.grinOnsetAtSec - P.preActionGapSec, 'ends before the onset');
    near(d.neutralHoldSec, SNAPPY.neutralHoldSec, 'neutral hold');
    assert.ok(d.preludeSpeed <= SNAPPY.preludeMaxSpeed && d.preludeSpeed >= 1, `prelude ${d.preludeSpeed}×`);
  });

  it('flash → 0.25 s hold → cut → stamp 0.1 s later with the quip → next cut 0.15 s after the quip', () => {
    for (const plan of [q, d]) {
      near(plan.events.resultAt, plan.grinCompleteAtSec + SNAPPY.holdAfterFlashSec, 'hold after the flash');
      near(plan.events.stampAt, plan.events.resultAt + SNAPPY.stampAfterCutSec, 'stamp after the cut');
      near(plan.events.quipStart, plan.events.stampAt, 'quip with the stamp');
    }
    near(d.durationSec, d.events.quipStart + 1.2 / VO + SNAPPY.cutAfterQuipSec, 'next cut right after the quip');
  });

  it('dog lands in the 5–6 s target', () => {
    assert.ok(d.durationSec >= 5 && d.durationSec <= 6, `dog ${d.durationSec} s`);
  });

  it('end card: stamp at the phrase end with real timing; fraction otherwise; ends 0.3 s after the VO', () => {
    const text = 'Zdjęcie do dowodu w minutę, w domu. Poprawki gratis. Wejdź na example.com.';
    const real = { characters: [...text], character_start_times_seconds: [...text].map((_, i) => i * 0.07), character_end_times_seconds: [...text].map((_, i) => (i + 1) * 0.07) };
    const at = phraseEndSec(real, text, 'Poprawki gratis.');
    near(at, (text.indexOf('Poprawki gratis.') + 16) * 0.07, 'phrase end');
    assert.equal(phraseEndSec({ ...real, approximate: true }, text, 'Poprawki gratis.'), null, 'approximate timing is not trusted');
    const card = planEndCard({ voDur: 5.6, minDurationSec: 3, tempo: SNAPPY, stampAtSec: at });
    near(card.events.voStart, 0, 'announcer on the first frame');
    near(card.events.stampAt, at, 'stamp at the phrase end');
    near(card.durationSec, 5.6 + SNAPPY.endCard.tailSec, 'ends 0.3 s after the VO');
  });
});

describe('settle beat (cow posing, chameleon eyes) — measured fixtures', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, planResultShot, detectSettle, activeTempo: tempoOf } = await import('../lib/alignment.mjs');
  const SNAPPY = tempoOf('snappy');
  const S = CONFIG.settle;
  const load = async (n) => {
    const fx = JSON.parse(await readFile(new URL(`./fixtures/${n}.json`, import.meta.url), 'utf8'));
    return { fx, analysis: analyzeSeries(fx, fx.fps, { beat: 'settle' }) };
  };
  const cow = await load('cow-oneshot');
  const cham = await load('chameleon-oneshot');

  it('cow: the last motion (head lift) settles at ~5–5.6 s; the action detector finds nothing', () => {
    assert.equal(cow.analysis.action.reliable, true);
    assert.ok(cow.analysis.action.t >= 5 && cow.analysis.action.t <= 5.6, `settle ${cow.analysis.action.t}`);
    assert.equal(analyzeSeries(cow.fx, cow.fx.fps, { searchLastSec: 1.5 }).action.found, false, 'no grin/tilt-like burst');
  });

  it('chameleon: eyes-only motion is too weak to trust → fixed anchor just before the end', () => {
    const a = cham.analysis.action;
    assert.equal(a.reliable, false, `excess ${a.excess}`);
    near(a.t, (cham.fx.diff.length - 1) / cham.fx.fps - S.fallbackBeforeEndSec, 'fallback anchor');
  });

  it('flat footage always falls back; a clear late burst settles where it dies down', () => {
    const fps = 24;
    const flat = Array.from({ length: 168 }, () => 0.5);
    assert.equal(detectSettle(flat, fps).reliable, false);
    const burst = flat.map((d, i) => (i >= 100 && i < 120 ? 3 : d));
    const r = detectSettle(burst, fps);
    assert.equal(r.reliable, true);
    assert.ok(r.t >= 120 / fps - 0.3 && r.t <= 120 / fps + 0.3, `settle ${r.t}`);
  });

  it('snappy plan: flash at the settle point, no neutral cut, 0.4 s of stillness held, line ends before it', () => {
    for (const { analysis } of [cow, cham]) {
      const plan = planResultShot({ analysis, voDur: 4.2, quipDur: 1.3, continuous: true, tempo: SNAPPY });
      assert.equal(plan.status, SHOT_STATUS.OK);
      assert.equal(plan.neutralHoldSec, 0, 'stillness comes after the flash, nothing to cut');
      near(plan.events.resultAt - plan.syntheticFlashAt, S.holdSec, 'stillness held');
      near(plan.events.voStart + 4.2, plan.syntheticFlashAt - P.preActionGapSec, 'line ends before the flash');
    }
  });
});

describe('cow v2 — fringe shake is an ACTION beat (measured fixture)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { analyzeSeries, actionAnchors } = await import('../lib/alignment.mjs');
  const fx = JSON.parse(await readFile(new URL('./fixtures/cow-v2-oneshot.json', import.meta.url), 'utf8'));
  const a = analyzeSeries(fx, fx.fps, { searchLastSec: CONFIG.result.syntheticFlash.finalBeatSearchSec });

  it('finds the head shake as the final burst and completes when the fringe has fallen (~6.6 s)', () => {
    assert.equal(a.action.found, true, a.action.reason);
    const { onset, complete } = actionAnchors(a.action);
    assert.ok(onset >= 5.4 && onset <= 6, `shake onset ${onset}`);
    assert.ok(complete >= 6.4 && complete <= 6.9, `fringe settled ${complete}`);
  });
});

describe('photo-sheet end card timing', async () => {
  const { planEndCard, activeTempo: tempoOf } = await import('../lib/alignment.mjs');
  const PS = CONFIG.photoSheet;
  const SNAPPY = tempoOf('snappy');

  it('builds the complete frame first, then plays the announcer over it; ends 0.3 s after the VO', () => {
    const plan = planEndCard({ voDur: 5.6, minDurationSec: 3, tempo: SNAPPY, sheet: PS });
    near(plan.events.stampAt, PS.inSec + PS.stampAfterInSec, 'stamp right after the sheet settles');
    near(plan.events.voStart, plan.events.stampAt + PS.voAfterStampSec, 'VO starts on the finished frame');
    near(plan.durationSec, plan.events.voStart + 5.6 + SNAPPY.endCard.tailSec, 'card ends 0.3 s after the VO');
  });

  it('keeps the classic line-relative stamp when no sheet timing is given', () => {
    const plan = planEndCard({ voDur: 5.6, minDurationSec: 3, tempo: SNAPPY });
    near(plan.events.voStart, 0, 'VO from the first frame');
    near(plan.events.stampAt, 5.6 * SNAPPY.endCard.stampAtFraction, 'stamp at the fraction');
  });
});
