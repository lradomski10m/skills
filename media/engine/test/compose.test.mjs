import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { activeTempo } from '../lib/alignment.mjs';
import { approximateAlignment } from '../lib/captions.mjs';
import { FIXTURES_DIR } from '../lib/constants.mjs';
import { detectBeats, manualBeats } from '../lib/compose/beats.mjs';
import { compose } from '../lib/compose/compose.mjs';
import { EFFECTS, effectsGraph, flashChain, pipChain } from '../lib/compose/effects.mjs';
import { evaluate, ExprError, refsOf } from '../lib/compose/expr.mjs';
import { describePresets, loadPresets, shotParams } from '../lib/compose/presets.mjs';
import { formatProblem, SourceError } from '../lib/compose/source.mjs';
import { loadStoryboard } from '../lib/compose/storyboard.mjs';
import { animatedFrames, fill, keyframeAt, renderSvg, transformSvg } from '../lib/compose/templates.mjs';
import { makeText } from '../lib/compose/text.mjs';
import { loadKit } from '../lib/kit.mjs';
import { storyboardFromJson } from '../lib/migrate.mjs';

const SHOWCASE = path.join(FIXTURES_DIR, 'campaigns', 'showcase', 'storyboard.md');

describe('anchor expressions', () => {
  const scope = { 'plan.stampAt': 6.9, end: 8.8, $verdict: 'reject', first: true, 'global.hook.minFirstVoStart': 2.19 };
  const r = (p) => scope[p];
  it('evaluates arithmetic, refs, comparisons, ternaries and fallbacks', () => {
    assert.equal(evaluate('end - 1.2', r).toFixed(3), '7.600');
    assert.equal(evaluate("$verdict == 'reject'", r), true);
    assert.equal(evaluate('first ? (global.hook.minFirstVoStart ?? 0) : 0', r), 2.19);
    assert.equal(evaluate('missing ?? 5', r), 5);
    assert.equal(evaluate('max(1, end - 10)', r), 1);
    assert.equal(evaluate('end-1', r).toFixed(3), '7.800', 'a hyphen before a digit is subtraction');
    assert.equal(evaluate('beatAfter(1.0, 2)', r, { beats: [0.5, 1.01, 1.52] }), 1.52);
    assert.deepEqual(refsOf('a.b + max(c, $d)'), ['a.b', 'c', '$d']);
  });
  it('fails clearly on bad syntax and on arithmetic with a missing value', () => {
    assert.throws(() => evaluate('end +', r), ExprError);
    assert.throws(() => evaluate('nope + 1', r), /expected a number, got undefined/);
    assert.throws(() => evaluate('foo(1)', r), /unknown function foo/);
  });
});

describe('presets', () => {
  const presets = loadPresets(null);
  it('ships the built-in library, resolving extends', () => {
    for (const n of ['action-verdict', 'hook-title', 'title-card', 'montage', 'game-fail', 'phone-demo', 'clip', 'still', 'dialogue', 'end-card', 'end-card-real-sheet', 'end-card-classic']) assert.ok(presets.has(n), n);
    assert.equal(presets.get('end-card-grid').body.params.style.default, 'grid');
    assert.ok(presets.get('end-card-grid').body.plan, 'inherits the parent body');
    assert.match(describePresets(presets), /montage \[builtin\] — Fast cuts/);
  });
  it('validates shot params: unknown, type, enum, required, defaults', () => {
    const problems = [];
    const shot = { id: 's', file: 'sb.md', fields: { preset: 'action-verdict', clip: 'a', beat: 'wiggle', nope: 1, rulePill: 'yes' }, lineOf: () => 7 };
    const p = shotParams(shot, presets.get('action-verdict'), problems);
    const msgs = problems.map(formatProblem).join('\n');
    assert.match(msgs, /unknown param "nope"/);
    assert.match(msgs, /beat: one of action, settle/);
    assert.match(msgs, /rulePill: expected bool/);
    assert.match(msgs, /line: required by preset action-verdict/);
    assert.equal(p.verdict, 'reject');
  });
  it('a kit preset overrides a built-in one of the same name', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'presets-'));
    await fs.writeFile(path.join(dir, 'still.md'), '---\nname: still\nsummary: mine\n---\n```yaml\nparams: {}\nplan: { planner: hold, args: { duration: 1 } }\n```\n');
    const p = loadPresets(dir);
    assert.equal(p.get('still').summary, 'mine');
    assert.equal(p.get('still').origin, 'kit');
  });
});

/** Stub services for composing without files or ffmpeg. */
function stubCtx(sb, beats = null) {
  const tempo = activeTempo('snappy');
  const text = makeText(sb, sb.locale);
  return {
    locale: sb.locale,
    tempo,
    kit: loadKit(null),
    copy: {},
    text,
    clip: async (key) => ({ key: String(key), file: `clip:${key}`, durationSec: 5, isClip: true }),
    still: async (key) => ({ key, file: `still:${key}` }),
    vo: async (key) => ({ key, file: `vo:${key}`, durationSec: 1.5, alignment: approximateAlignment('a b c', 1.5), text: 'a b c' }),
    analyse: async () => ({ durationSec: 5, flash: { found: false }, action: { found: true, t: 3 } }),
    sfx: (n) => `sfx:${n}`,
    music: async () => null,
    kitFile: async (rel) => ({ file: rel }),
    perfectPhotos: async () => [],
    beforePhoto: async () => null,
    beats,
  };
}

describe('composer (showcase storyboard)', () => {
  const sb = loadStoryboard(SHOWCASE, { locale: 'en-us' });
  const beats = manualBeats({ bpm: 120, offset: 0.25 });
  it('lays shots back to back and cuts the montage on the beat', async () => {
    const tl = await compose(sb, { presets: loadPresets(null), ctx: stubCtx(sb, beats) });
    const grind = tl.segments.filter((s) => s.id === 'grind');
    assert.equal(grind.length, 4);
    for (const s of grind) {
      const end = s.startSec + s.durationSec;
      assert.ok(beats.beats.some((b) => Math.abs(b - end) < 0.002), `slice ends on a beat (${end})`);
    }
    let t = 0;
    for (const s of tl.segments) {
      assert.ok(Math.abs(s.startSec - t) < 0.002, `${s.id} starts where the previous ended`);
      t += s.durationSec;
    }
    assert.equal(tl.totalSec, Math.round(t * 1000) / 1000);
  });
  it('emits effects: per-cut punches (each), grey-wash at the freeze, transitions at cuts', async () => {
    const tl = await compose(sb, { presets: loadPresets(null), ctx: stubCtx(sb, beats) });
    const grindStarts = tl.segments.filter((s) => s.id === 'grind').map((s) => s.startSec);
    const punches = tl.effects.filter((e) => e.name === 'zoom-punch').map((e) => e.fromSec);
    assert.deepEqual(punches, grindStarts.slice(1), 'one punch at every cut inside the montage');
    const fail = tl.shots.find((s) => s.id === 'fail');
    const wash = tl.effects.find((e) => e.name === 'grey-wash');
    assert.ok(wash.fromSec > fail.startSec && wash.toSec === fail.endSec);
    assert.ok(tl.effects.some((e) => e.name === 'transition:whip' && Math.abs(e.params.atSec - grindStarts[0]) < 0.002));
    assert.ok(tl.effects.some((e) => e.name === 'transition:flash-cut' && Math.abs(e.params.atSec - fail.startSec) < 0.002));
  });
  it('places template overlays with animation keyframes evaluated in the shot', async () => {
    const tl = await compose(sb, { presets: loadPresets(null), ctx: stubCtx(sb, beats) });
    const stars = tl.overlays.find((o) => o.template === 'stars');
    const grind = tl.shots.find((s) => s.id === 'grind');
    assert.equal(stars.fromSec, grind.startSec);
    assert.ok(Math.abs(stars.animate.value[1][0] - (grind.endSec - grind.startSec)) < 0.002, 'keyframe "=end" resolved to the shot length');
    const pip = tl.overlays.find((o) => o.kind === 'pip');
    assert.equal(pip.quad.length, 4);
    const banner = tl.overlays.find((o) => o.template === 'banner');
    assert.equal(banner.params.text, 'Game over');
  });
  it('reports a planner/anchor problem with file:line and shot', async () => {
    const bad = { ...sb, shots: sb.shots.map((s) => (s.id === 'fail' ? { ...s, fields: { ...s.fields, preset: 'nope' } } : s)) };
    await assert.rejects(compose(bad, { presets: loadPresets(null), ctx: stubCtx(sb, beats) }), (err) => err instanceof SourceError && /shot fail: unknown preset "nope"/.test(err.message));
  });
});

describe('templates', () => {
  const vars = { text: 'Hi & <you>', n: 61.6, colour: { accent: '#f00' } };
  it('fills placeholders with filters and escapes XML', () => {
    assert.equal(fill('{{text|upper}}|{{n|int}}|{{n|time}}|{{colour.accent}}|{{missing|default:—}}', vars), 'HI &amp; &lt;YOU&gt;|62|1:02|#f00|—');
    assert.throws(() => fill('{{missing}}', vars, 'tpl'), /tpl: missing value for \{\{missing\}\}/);
  });
  it('interpolates keyframes (numbers ease, strings step) and wraps transforms', () => {
    assert.equal(keyframeAt([[0, 0], [1, 10]], 0.5), 5);
    assert.equal(keyframeAt([[0, 0], [1, 10]], 0.5, 'out'), 7.5);
    assert.equal(keyframeAt([[0, 'a'], [1, 'b']], 0.7), 'a');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect/></svg>';
    assert.match(transformSvg(svg, { opacity: 0.5, scale: 2 }), /<g opacity="0.5" transform="translate\(0 0\) translate\(50 25\) scale\(2\)/);
    const frames = animatedFrames('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text>{{v|int}}</text></svg>', {}, { v: [[0, 0], [1, 30]] }, 1, 30, 't');
    assert.equal(frames.length, 30);
    assert.match(frames[15], />15</);
  });
  it('renders with bundled fonts and shrinks data-fit-width text', () => {
    const k = loadKit(null);
    const svg = (fit) => `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><text x="0" y="45" font-family="Inter" font-size="48" ${fit}>A very long title here</text></svg>`;
    const png = renderSvg(svg('data-fit-width="280"'), { fontFiles: k.fontFiles, family: 'Inter' });
    assert.ok(png.length > 500);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
  });
});

describe('effects and transitions (filter text)', () => {
  const e = (name, params = {}) => ({ name, fromSec: 1, toSec: 2, params });
  it('builds every catalogue entry as a labelled chain', () => {
    for (const name of Object.keys(EFFECTS)) {
      const f = EFFECTS[name](e(name, { atSec: 1.5 }), 'in', 'out', 0);
      assert.match(f, /^\[in\]/, name);
      assert.match(f, /\[out\]$/, name);
    }
    assert.match(EFFECTS['grey-wash'](e('grey-wash'), 'i', 'o'), /hue=s='if\(between\(t,1\.000,2\.000\)/);
    assert.match(EFFECTS.cctv(e('cctv'), 'i', 'o', 3), /split\[m3\]\[e3\].*overlay=enable='between\(t,1\.000,2\.000\)'/);
  });
  it('chains effects in order and passes through without any', () => {
    assert.equal(effectsGraph([], '0:v', 'fx'), '[0:v]null[fx]');
    const g = effectsGraph([e('blur'), e('vignette')], '0:v', 'fx');
    assert.match(g, /^\[0:v\]gblur.*\[f0\];\[f0\]vignette.*\[fx\]$/);
    assert.throws(() => effectsGraph([e('nope')]), /unknown effect "nope"/);
  });
  it('snaps a flash to frames and warps PiP corners into the quad', () => {
    assert.match(flashChain(1.0, [1]), /between\(t,0\.983,1\.016\)/);
    const p = pipChain({ quad: [[1, 2], [3, 4], [5, 6], [7, 8]], fromSec: 2, inSec: 0.5 }, 3, 4, 'pp0');
    assert.match(p, /perspective=x0=1:y0=2:x1=3:y1=4:x2=7:y2=8:x3=5:y3=6:sense=destination/);
    assert.match(p, /\[4:v\]format=gray\[pmpp0\];\[pwpp0\]\[pmpp0\]alphamerge\[pp0\]/);
  });
});

describe('beats', () => {
  it('finds tempo and phase of a click track (± 1 frame) and a manual grid', () => {
    const sr = 22050;
    const s = new Float32Array(sr * 10);
    let seed = 1;
    for (let i = 0; i < s.length; i++) s[i] = ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.01;
    const bpm = 118;
    const off = 0.31;
    for (let t = off; t < 10; t += 60 / bpm) {
      const i0 = Math.round(t * sr);
      for (let j = 0; j < 400; j++) s[i0 + j] += Math.sin(j * 0.3) * Math.exp(-j / 80) * 0.6;
    }
    const r = detectBeats(s, sr);
    assert.ok(Math.abs(r.bpm - bpm) < 1.5, `bpm ${r.bpm}`);
    const err = Math.max(...r.beats.map((b) => Math.abs(b - (off + Math.round(((b - off) * bpm) / 60) * (60 / bpm)))));
    assert.ok(err < 1 / 30, `max error ${err}`);
    assert.deepEqual(manualBeats({ bpm: 120, offset: 0.5, durationSec: 2 }).beats, [0.5, 1, 1.5, 2]);
  });
});

describe('migrate-kit', () => {
  it('turns 0.1.x JSON specs into a storyboard that loads', async () => {
    const base = { campaign: 'demo', hook: { durationSec: 2 }, music: { file: null }, endCard: { durationSec: 3 }, shots: [{ id: 'cow', subject: 'a cow', videoPrompt: 'moo', action: [{ file: 'cow.mp4' }], beat: 'settle', verdict: 'rejected' }] };
    const ov = (l, x) => ({ id: `demo-${l}`, locale: l, hook: { text: `${x} hook`, vo: { text: `${x} hook.`, tts: `[warm] ${x} hook.` } }, shots: { cow: { caption: `${x} cap`, vo: { line: { text: `${x} line`, tts: `[tag] ${x} line` }, quip: `${x} quip` } } }, endCard: { copy: `${x} copy`, announcer: { text: `${x} go`, tts: `${x} go` }, stampAtPhrase: `${x} phrase` } });
    const md = storyboardFromJson('demo', base, { pl: ov('pl', 'P'), 'en-us': ov('en-us', 'E') });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mig-'));
    await fs.writeFile(path.join(dir, 'storyboard.md'), md);
    const sb = loadStoryboard(path.join(dir, 'storyboard.md'), { locale: 'pl' });
    assert.deepEqual(sb.shots[0].fields.clip, ['cow'], '0.1.x action parts stay a list');
    assert.equal(sb.shots[0].fields.beat, 'settle');
    assert.equal(sb.text['cow.line'].values['en-us'], 'E line');
    assert.equal(sb.front.end.line, 'endcard.announcer');
    assert.match(md, /## Voice scripts[\s\S]*\[tag\] P line/);
  });
});
