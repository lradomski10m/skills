// A5 golden: the composition engine reproduces the 0.1.x timelines (pl + en-us) from
// the same planner inputs — every segment start/duration, audio event and overlay
// window within 1 ms. Inputs were captured from real renders (test/tools/capture-golden.mjs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { activeTempo } from '../lib/alignment.mjs';
import { approximateAlignment } from '../lib/captions.mjs';
import { FIXTURES_DIR } from '../lib/constants.mjs';
import { compose } from '../lib/compose/compose.mjs';
import { loadPresets } from '../lib/compose/presets.mjs';
import { loadStoryboard } from '../lib/compose/storyboard.mjs';
import { makeText, voiceSpeed } from '../lib/compose/text.mjs';
import { loadKit } from '../lib/kit.mjs';

const STORYBOARD = path.join(FIXTURES_DIR, 'campaigns', 'animals', 'storyboard.md');
const TOL = 0.0015;

/** ctx stub: planner inputs from the golden fixture instead of files and ffmpeg. */
export function goldenCtx(sb, locale, fx) {
  const tempo = activeTempo(sb.front.tempo);
  const text = makeText(sb, locale);
  const shotOf = (key) => Object.keys(fx.inputs.shots).find((id) => key === id || key.startsWith(`${id}.`));
  const voRaw = (key) => {
    if (key === 'hook') return fx.inputs.hookSec;
    if (key === 'endcard.announcer') return fx.inputs.announcerSec;
    const [id, part] = key.split('.');
    return fx.inputs.shots[id]?.[`${part}Sec`] ?? null;
  };
  return {
    locale,
    tempo,
    kit: loadKit(null),
    copy: {},
    text,
    clip: async (key) => ({ key, file: `clip:${key}`, durationSec: fx.inputs.shots[shotOf(key)].analysis.durationSec, isClip: true }),
    still: async (key) => ({ key, file: `still:${key}` }),
    vo: async (key, role) => {
      const raw = voRaw(key);
      if (raw == null) return null;
      const d = raw / voiceSpeed(tempo, role);
      return { key, file: `vo:${key}`, durationSec: d, alignment: approximateAlignment(text.has(key) ? text({ t: key }) : key, d), text: text.has(key) ? text({ t: key }) : null };
    },
    analyse: async (clip) => fx.inputs.shots[shotOf(clip.key)].analysis,
    sfx: (name) => `sfx:${name}`,
    music: async () => null,
    kitFile: async (rel) => ({ file: `kit:${rel}` }),
    perfectPhotos: async () => Object.keys(fx.inputs.shots).map((id) => `perfect:${id}`),
    beforePhoto: async () => 'still:quokka',
    beats: null,
  };
}

const norm = {
  graphic: (g) => g.replace(/^stamp-rejected$/, 'stamp-reject').replace(/^stamp-approved$/, 'stamp-approve'),
  audio: (list) => list.map((a) => ({ kind: a.kind ?? (a.bus === 'voice' ? 'voice' : a.label), atSec: a.atSec, durSec: a.durSec ?? null })).sort((x, y) => x.atSec - y.atSec || x.kind.localeCompare(y.kind)),
};
const close = (a, b, what) => assert.ok(Math.abs(a - b) <= TOL, `${what}: ${a} vs expected ${b}`);

for (const locale of ['pl', 'en-us']) {
  describe(`A5 golden (${locale})`, () => {
    const fx = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'golden', `a5-${locale}.json`), 'utf8'));
    it('matches the 0.1.x timeline within 1 ms', async () => {
      const sb = loadStoryboard(STORYBOARD, { locale });
      const tl = await compose(sb, { presets: loadPresets(null), ctx: goldenCtx(sb, locale, fx) });
      const E = fx.expected;
      close(tl.totalSec, E.totalSec, 'total');
      assert.equal(tl.segments.length, E.segments.length, 'segment count');
      tl.segments.forEach((s, i) => {
        close(s.startSec, E.segments[i].startSec, `segment ${i} start`);
        close(s.durationSec, E.segments[i].durationSec, `segment ${i} duration`);
      });
      const got = norm.audio(tl.audio);
      const want = norm.audio(E.audio);
      assert.deepEqual(got.map((a) => a.kind), want.map((a) => a.kind), 'audio events (kinds, in time order)');
      got.forEach((a, i) => {
        close(a.atSec, want[i].atSec, `audio ${i} (${a.kind}) at`);
        if (want[i].durSec != null) close(a.durSec, want[i].durSec, `audio ${i} (${a.kind}) duration`);
      });
      const ov = (list) => list.map((o) => ({ g: norm.graphic(o.graphic), f: o.fromSec, t: o.toSec })).sort((x, y) => x.f - y.f || x.g.localeCompare(y.g));
      const go = ov(tl.overlays);
      const wo = ov(E.overlays);
      assert.deepEqual(go.map((o) => o.g), wo.map((o) => o.g), 'overlays');
      go.forEach((o, i) => {
        close(o.f, wo[i].f, `overlay ${o.g} from`);
        close(o.t, wo[i].t, `overlay ${o.g} to`);
      });
    });
  });
}
