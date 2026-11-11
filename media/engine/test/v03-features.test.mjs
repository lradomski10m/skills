// 0.3.0 features, pure or composed without ffmpeg: music bed padding, the ffmpeg
// watchdog, transitions (filter text), locale front-matter overrides, phone-demo hold,
// template lint.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { activeTempo } from '../lib/alignment.mjs';
import { approximateAlignment } from '../lib/captions.mjs';
import { CONFIG } from '../lib/config.mjs';
import { compose, transitionEffect } from '../lib/compose/compose.mjs';
import { EFFECTS, effectsGraph, pipChain, transitionCut } from '../lib/compose/effects.mjs';
import { loadPresets } from '../lib/compose/presets.mjs';
import { formatProblem, SourceError } from '../lib/compose/source.mjs';
import { loadStoryboard, OVERLAY_FRONT_KEYS } from '../lib/compose/storyboard.mjs';
import { templateTextLeaks } from '../lib/compose/templates.mjs';
import { makeText } from '../lib/compose/text.mjs';
import { clipChanges, clipNormaliseArgs, firstUtteranceCut, parseSilences, voCutArgs } from '../lib/ingest.mjs';
import { loadKit } from '../lib/kit.mjs';
import { parseProgress, progressLine, run } from '../lib/media/ffmpeg.mjs';
import { musicShortfall, templateWarnings } from '../lib/pipeline.mjs';
import { finalPassArgs } from '../lib/render.mjs';

const FPS = CONFIG.render.fps;
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'v03-'));
const write = async (dir, name, text) => {
  await fs.writeFile(path.join(dir, name), text);
  return path.join(dir, name);
};
const problemsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof SourceError) return err.problems.map(formatProblem);
    throw err;
  }
  return [];
};
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

describe('music bed shorter than the video', () => {
  const tl = { totalSec: 10, overlays: [], audio: [], effects: [] };
  const music = { file: 'm.mp3', gainDb: -6, duckDb: -10, windows: [], attackSec: 0.1, releaseSec: 0.3, fadeOutSec: 0.4 };
  it('plays once, fades at its own end and is padded with silence (no loop)', () => {
    const args = finalPassArgs(tl, { captionsFile: null, music: { ...music, bedSec: 6 } }, 'o.mp4');
    assert.ok(!args.includes('-stream_loop'), 'no looping input');
    const g = graphOf(args);
    assert.match(g, /afade=t=out:st=5\.600:d=0\.400,apad,atrim=duration=10\.000/, 'fade at the bed end, then silence');
    assert.match(g, /afade=t=out:st=9\.600:d=0\.400\[music\]/, 'and the usual fade with the video');
  });
  it('loops only when the storyboard asks (music.loop)', () => {
    const args = finalPassArgs(tl, { captionsFile: null, music: { ...music, bedSec: 6, loop: true } }, 'o.mp4');
    assert.equal(args[args.indexOf('m.mp3') - 3], '-stream_loop');
    assert.doesNotMatch(graphOf(args), /st=5\.600/);
  });
  it('a long enough bed gets no extra fade', () => {
    assert.doesNotMatch(graphOf(finalPassArgs(tl, { captionsFile: null, music: { ...music, bedSec: 12 } }, 'o.mp4')), /st=11/);
  });
  it('reports the shortfall', () => {
    assert.equal(musicShortfall(6, 10), 4);
    assert.equal(musicShortfall(12, 10), 0);
  });
});

describe('ffmpeg watchdog', () => {
  it('parses -progress blocks across chunk boundaries', () => {
    const a = parseProgress('frame=10\nout_time_us=1500000\nprogress=continue\nout_ti');
    assert.equal(a.outSec, 1.5);
    assert.equal(a.carry, 'out_ti');
    const b = parseProgress('me_us=2000000\nprogress=end\n', a.carry);
    assert.equal(b.outSec, 2);
    assert.equal(b.end, true);
    assert.equal(parseProgress('out_time_us=N/A\n').outSec, null);
    assert.equal(progressLine('final pass', 12.3, 68, 10), '  final pass 12.3/68.0 s (18%) · 1.23× realtime');
  });
  it('kills a child whose output time stops advancing, with a clear error', async () => {
    const script = "process.stdout.write('out_time_us=500000\\nprogress=continue\\n'); setTimeout(() => {}, 30000);";
    const t0 = Date.now();
    await assert.rejects(run(process.execPath, ['-e', script], { watch: { stallSec: 0.4, label: 'final pass' } }), /final pass stalled: output time stuck at 0\.50 s/);
    assert.ok(Date.now() - t0 < 5000, 'fails fast');
  });
  it('lets an advancing child finish and reports progress', async () => {
    const script = "let t=0; const i=setInterval(()=>{ t+=100000; process.stdout.write('out_time_us='+t+'\\n'); if(t>=500000){clearInterval(i);} }, 50);";
    const seen = [];
    await run(process.execPath, ['-e', script], { watch: { stallSec: 2, onProgress: (s) => seen.push(s) } });
    assert.deepEqual(seen, [0.1, 0.2, 0.3, 0.4, 0.5]);
  });
});

describe('transitions dissolve + slide (filter text)', () => {
  const at = 2;
  it('start on the cut (frame index) with their own default length', () => {
    const e = transitionEffect({ name: 'slide' }, at);
    assert.equal(e.fromSec, 2);
    assert.equal(e.toSec, 2.35);
    assert.deepEqual(transitionCut(e), { cutFrame: 60, cutSec: 2, durSec: 0.35 });
    const dip = transitionEffect({ name: 'dip', durSec: 0.4 }, at);
    assert.equal(dip.fromSec, 1.8, 'centred transitions are unchanged');
  });
  it('slide: two branches — held background (padded forever, shortest) under the live base at an eased x', () => {
    const f = EFFECTS['transition:slide'](transitionEffect({ name: 'slide', durSec: 0.3 }, 2.01), 'in', 'out', 4);
    assert.equal((f.match(/split/g) ?? []).length, 1);
    assert.match(f, /^\[in\]split\[sb4\]\[st4\];\[sb4\]trim=end_frame=60,tpad=stop_mode=clone:stop=-1\[sh4\];/);
    assert.match(f, /\[sh4\]\[st4\]overlay=x='if\(between\(t,2\.000,2\.300\),main_w\*pow\(1-\(t-2\.000\)\/0\.300,3\),0\)':y='0':eval=frame:shortest=1\[out\]$/);
    const up = EFFECTS['transition:slide'](transitionEffect({ name: 'slide', direction: 'up' }, 2), 'i', 'o', 0);
    assert.match(up, /x='0':y='if\(between.*main_h\*pow/);
    assert.throws(() => EFFECTS['transition:slide'](transitionEffect({ name: 'slide', direction: 'diagonal' }, 2), 'i', 'o', 0), /direction one of left, right, up, down/);
  });
  it('dissolve: the held outgoing frame fades out over the live base', () => {
    const f = EFFECTS['transition:dissolve'](transitionEffect({ name: 'dissolve', durSec: 0.5 }, 1), 'in', 'out', 0);
    assert.equal((f.match(/split/g) ?? []).length, 1);
    assert.match(f, /trim=end_frame=30,tpad=stop_mode=clone:stop_duration=0\.500,format=yuva420p,fade=t=out:st=1\.000:d=0\.500:alpha=1\[df0\]/);
    assert.match(f, /\[dm0\]\[df0\]overlay=eof_action=pass,format=yuv420p\[out\]$/);
    assert.doesNotMatch(f, /xfade/);
  });
  it('chain over many cuts with unique labels', () => {
    const effects = Array.from({ length: 13 }, (_, k) => transitionEffect({ name: k % 2 ? 'dissolve' : 'slide', durSec: 0.2 }, 0.5 * (k + 1)));
    const g = effectsGraph(effects, '0:v', 'fx');
    const outs = [...g.matchAll(/\[(\w+)\](?:;|$)/g)].map((m) => m[1]);
    assert.equal(new Set(outs).size, outs.length, 'every output label is unique');
    assert.match(g, /\[fx\]$/);
  });
});

describe('locale overlay front matter', () => {
  const base = ['---', 'campaign: demo', 'locales: [pl, en-us]', 'music: { bed: bed, levelDb: -9 }', 'end: { preset: end-card, sheet: sheet-pl, copy: x }', '---', '## Shot s1 — one', '```yaml', 'preset: still', '```', ''].join('\n');
  it('deep-merges end, music, brandBug, cuts and hook over the base for that locale only', async () => {
    const dir = await tmp();
    const f = await write(dir, 'storyboard.md', base);
    await write(dir, 'storyboard.en-us.md', ['---', 'end: { sheet: sheet-en }', 'music: { bed: bed-en }', 'brandBug: { from: 1 }', 'cuts: { transition: { name: slide } }', 'hook: { duration: 2 }', '---', ''].join('\n'));
    const en = loadStoryboard(f, { locale: 'en-us' });
    assert.deepEqual(en.front.end, { preset: 'end-card', sheet: 'sheet-en', copy: 'x' });
    assert.deepEqual(en.front.music, { bed: 'bed-en', levelDb: -9 });
    assert.deepEqual(en.front.brandBug, { from: 1 });
    assert.equal(en.front.cuts.transition.name, 'slide');
    assert.equal(en.front.hook.duration, 2);
    assert.match(en.frontFileOf(['end', 'sheet']), /storyboard\.en-us\.md$/, 'lines point at the overlay that set the key');
    assert.equal(en.frontLineOf(['end']), 2);
    assert.match(en.frontFileOf(['campaign']), /storyboard\.md$/);
    const pl = loadStoryboard(f, { locale: 'pl' });
    assert.equal(pl.front.end.sheet, 'sheet-pl');
  });
  it('rejects identity and unknown keys with file:line', async () => {
    const dir = await tmp();
    const f = await write(dir, 'storyboard.md', base);
    await write(dir, 'storyboard.pl.md', ['---', 'campaign: other', 'endd: { sheet: x }', '---', ''].join('\n'));
    const p = problemsOf(() => loadStoryboard(f, { locale: 'pl' }));
    assert.ok(p.some((x) => /storyboard\.pl\.md:2: campaign: cannot be overridden per locale/.test(x)), p.join('\n'));
    assert.ok(p.some((x) => /storyboard\.pl\.md:3: unknown front-matter key "endd"/.test(x)), p.join('\n'));
    assert.ok(OVERLAY_FRONT_KEYS.includes('music'));
  });
});

/** Stub services for composing without files or ffmpeg (recordings are 5 s). */
function stubCtx(sb) {
  return {
    locale: sb.locale,
    tempo: activeTempo('snappy'),
    kit: loadKit(null),
    copy: {},
    text: makeText(sb, sb.locale),
    clip: async (key) => ({ key: String(key), file: `clip:${key}`, durationSec: 5, isClip: true }),
    still: async (key) => ({ key, file: `still:${key}` }),
    vo: async (key) => ({ key, file: `vo:${key}`, durationSec: 1, alignment: approximateAlignment('a b', 1), text: 'a b' }),
    analyse: async () => ({ durationSec: 5, flash: { found: false }, action: { found: true, t: 3 } }),
    sfx: (n) => `sfx:${n}`,
    music: async () => null,
    kitFile: async (rel) => ({ file: rel }),
    perfectPhotos: async () => [],
    beforePhoto: async () => null,
    beats: null,
  };
}

describe('phone-demo hold', () => {
  const sbText = (shot) => ['---', 'campaign: demo', 'locales: [en-us]', '---', '## Shot pre — x', '```yaml', 'preset: still', 'still: a', 'duration: 1', '```', '## Shot demo — phone', '```yaml', 'preset: phone-demo', 'phone: phone', 'recording: rec', 'quad: [[1,2],[3,4],[5,6],[7,8]]', ...shot, '```', ''].join('\n');
  const composeWith = async (shot) => {
    const dir = await tmp();
    const sb = loadStoryboard(await write(dir, 'storyboard.md', sbText(shot)), { locale: 'en-us' });
    return compose(sb, { presets: loadPresets(null), ctx: stubCtx(sb) });
  };
  it('freezes the last played frame for `hold` s; the stamp lands on the first frozen frame', async () => {
    const tl = await composeWith(['hold: 2', 'verdict: approve', 'timer: true', 'timerTo: 60']);
    const shot = tl.shots.find((s) => s.id === 'demo');
    assert.equal(shot.endSec - shot.startSec, 7, 'recording (5 s) + hold (2 s)');
    const pip = tl.overlays.find((o) => o.kind === 'pip');
    assert.equal(pip.outSec, 5);
    assert.equal(pip.hold, 2);
    const stamp = tl.overlays.find((o) => o.builtin === 'stamp');
    assert.equal(stamp.fromSec, shot.startSec + 5);
    assert.ok(tl.audio.some((a) => a.label === 'thud' && a.atSec === shot.startSec + 5));
    assert.ok(tl.audio.some((a) => a.label === 'ding'));
    const timer = tl.overlays.find((o) => o.template === 'timer');
    assert.deepEqual(timer.animate.seconds, [[0, 0], [5, 60]], 'the timer stops with the recording');
    assert.equal(tl.events.demo.holdAt, 5);
    const chain = pipChain(pip, 3, 4, 'pp0');
    assert.match(chain, /^\[3:v\]fps=30,trim=start=0\.000:end=5\.000,setpts=\(PTS-STARTPTS\)\/1\.000\+1\.000\/TB,tpad=stop_mode=clone:stop_duration=2\.000,/);
    const args = finalPassArgs({ totalSec: 8, overlays: [{ ...pip, mask: 'm.png' }], audio: [], effects: [] }, { captionsFile: null }, 'o.mp4');
    assert.equal(args[args.indexOf('clip:rec') - 1], '-i');
    assert.notEqual(args[args.indexOf('clip:rec') - 2], '-1', 'a held PiP does not loop');
  });
  it('stampAt counts back from the end of the shot', async () => {
    const tl = await composeWith(['hold: 2', 'verdict: reject', 'stampAt: 0.5']);
    const shot = tl.shots.find((s) => s.id === 'demo');
    assert.equal(tl.overlays.find((o) => o.builtin === 'stamp').fromSec, shot.endSec - 0.5);
  });
  it('without hold it behaves like 0.2.x: no stamp, the recording loops, the timer runs to the end', async () => {
    const tl = await composeWith(['duration: 2.5', 'timer: true']);
    const shot = tl.shots.find((s) => s.id === 'demo');
    assert.equal(shot.endSec - shot.startSec, 2.5);
    assert.ok(!tl.overlays.some((o) => o.builtin === 'stamp'));
    assert.ok(!tl.audio.some((a) => a.label === 'thud'));
    const pip = tl.overlays.find((o) => o.kind === 'pip');
    assert.equal(pip.hold, undefined);
    assert.deepEqual(tl.overlays.find((o) => o.template === 'timer').animate.seconds, [[0, 0], [2.5, 2.5]]);
    const args = finalPassArgs({ totalSec: 4, overlays: [{ ...pip, mask: 'm.png' }], audio: [], effects: [] }, { captionsFile: null }, 'o.mp4');
    assert.equal(args[args.indexOf('clip:rec') - 3], '-stream_loop');
  });
});

describe('template lint', () => {
  it('finds visible words that are not {{params}}, and word defaults', () => {
    const svg = '<svg><!-- template: { size: [1, 1] } --><title>Clock</title><text x="1">{{a}} teraz <tspan fill="red">{{b}}</tspan></text><text>1:00 · 99%</text><text>{{c|default:NOW}}</text><text>{{d|default:—}}</text><text display="none">hidden</text></svg>';
    assert.deepEqual(templateTextLeaks(svg), ['teraz', '{{c|default:NOW}}']);
  });
  it('the built-in templates are clean', async () => {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates');
    for (const f of await fs.readdir(dir)) assert.deepEqual(templateTextLeaks(await fs.readFile(path.join(dir, f), 'utf8')), [], f);
  });
  it('plan warns once per leaking template the timeline uses', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'templates'));
    await write(path.join(dir, 'templates'), 'clock.svg', '<svg><text>{{time|time}} teraz</text></svg>');
    const kit = { templatesDir: path.join(dir, 'templates') };
    const tl = { overlays: [{ kind: 'template', template: 'clock' }, { kind: 'template', template: 'clock' }, { kind: 'template', template: 'banner' }, { kind: 'builtin', builtin: 'stamp' }] };
    const w = await templateWarnings(tl, kit);
    assert.equal(w.length, 1);
    assert.match(w[0], /template clock .*"teraz"/);
  });
});

describe('ingest helpers (pure)', () => {
  const stream = (o) => ({ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', r_frame_rate: `${FPS}/1`, avg_frame_rate: `${FPS}/1`, ...o });
  it('lists what a clip needs: CFR, untagged colour, yuv420p, h264, no audio', () => {
    assert.deepEqual(clipChanges({ streams: [stream()] }), []);
    assert.deepEqual(clipChanges({ streams: [stream({ color_primaries: 'unknown', color_space: 'unknown' })] }), []);
    const c = clipChanges({ streams: [stream({ r_frame_rate: '60/1', avg_frame_rate: '2580/57', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709', pix_fmt: 'yuv444p', codec_name: 'hevc' }), { codec_type: 'audio' }] });
    assert.deepEqual(c, ['variable frame rate (avg 45.26 fps) → 30 fps CFR', 'colour tags bt709 → unspecified', 'yuv444p → yuv420p', 'hevc → h264', "1 audio track dropped (--keep-audio keeps a lip-synced clip's sound)"]);
    assert.deepEqual(clipChanges({ streams: [stream(), { codec_type: 'audio' }] }, 30, { keepAudio: true }), [], 'a dialogue clip keeps its sound');
    assert.deepEqual(clipChanges({ streams: [stream({ r_frame_rate: '24/1', avg_frame_rate: '24/1' })] }), ['24 fps → 30 fps']);
    assert.throws(() => clipChanges({ streams: [{ codec_type: 'audio' }] }), /no video stream/);
  });
  it('normalises CFR first, then clears colour tags; video only', () => {
    const a = clipNormaliseArgs('in.mov', 'out.mp4');
    assert.match(a[a.indexOf('-vf') + 1], /^fps=30,setparams=color_primaries=unknown:color_trc=unknown:colorspace=unknown:range=unknown,format=yuv420p$/);
    assert.ok(a.includes('-an'));
    assert.deepEqual(a.slice(0, 4), ['-i', 'in.mov', '-map', '0:v:0']);
    const k = clipNormaliseArgs('in.mov', 'out.mp4', 30, { keepAudio: true });
    assert.ok(!k.includes('-an') && k.includes('0:a:0?'));
  });
  it('finds the first utterance of a repeated take, ignoring leading and trailing silence', () => {
    const s = parseSilences('frame:1\nlavfi.silence_start=0\nlavfi.silence_end=0.2\nlavfi.silence_start=1.4\nlavfi.silence_end=1.9\nlavfi.silence_start=3.1\nlavfi.silence_end=3.6\nlavfi.silence_start=4.8\n', 5);
    assert.deepEqual(s, [{ startSec: 0, endSec: 0.2 }, { startSec: 1.4, endSec: 1.9 }, { startSec: 3.1, endSec: 3.6 }, { startSec: 4.8, endSec: 5 }]);
    const c = firstUtteranceCut(s, 5, { fadeSec: 0.15 });
    assert.equal(c.cutSec.toFixed(2), '1.55');
    assert.equal(c.speechEndSec, 1.4);
    assert.equal(c.pauses, 2);
    assert.equal(firstUtteranceCut([{ startSec: 0, endSec: 0.2 }, { startSec: 1.4, endSec: 5 }], 5), null, 'one utterance: nothing to cut');
  });
  it('cuts a take with a fade that ends on the cut', () => {
    const a = voCutArgs('in.mp3', 'out.mp3', 1.2, 0.15);
    assert.equal(a[a.indexOf('-af') + 1], 'atrim=end=1.200,afade=t=out:st=1.050:d=0.150');
  });
});
