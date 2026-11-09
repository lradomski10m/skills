import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FIXTURES_DIR } from '../lib/constants.mjs';
import {
  loadSpec,
  mergeExtends,
  normalizeLine,
  normalizeSpec,
  plainSpoken,
  stillPromptFor,
  ttsText,
  usedVoiceRoles,
  validateForLive,
  validateSpec,
} from '../lib/spec.mjs';

const CAMPAIGN = path.join(FIXTURES_DIR, 'campaigns', 'animals');
const A5 = path.join(CAMPAIGN, 'pl.json');
const WARMUP = path.join(CAMPAIGN, 'warmup.pl.json');

describe('example campaign (fixtures/campaigns/animals)', () => {
  it('PL is four rejected animal shots, with the built-in kit filling brand fields', async () => {
    const spec = await loadSpec(A5, { live: false });
    assert.deepEqual(spec.shots.map((s) => s.id), ['quokka', 'dog', 'cow', 'chameleon']);
    assert.ok(spec.shots.every((s) => s.verdict === 'rejected'));
    assert.deepEqual(spec.shots.map((s) => s.beat), ['action', 'action', 'action', 'settle'], 'cow v2 shakes its fringe over its eyes; the chameleon poses');
    assert.equal(spec.shots.find((s) => s.id === 'chameleon').vo.quip.text, 'Każde oko w tą samą stronę…');
    const quip = spec.shots[0].vo.quip;
    assert.equal(quip.text, 'No nie…');
    assert.match(quip.tts, /^\[[^\]]+\] No nie…$/, 'generation text = emotion tag + display text');
    assert.match(spec.shots[0].vo.line.tts, /^\[[^\]]+\] Po pierwsze:/);
    assert.equal(spec.hook.text, 'Wymagania zdjęcia do dowodu');
    assert.equal(spec.ruleCaptions, false, 'rule labels off');
    assert.equal(spec.shots.find((s) => s.id === 'dog').vo.quip.text, 'Serio?');
    assert.equal(spec.shots.find((s) => s.id === 'cow').vo.quip.text, 'Ani trochę.');
    assert.match(spec.shots.find((s) => s.id === 'chameleon').vo.line.text, /^Po czwarte:/);
    assert.equal(spec.hook.vo.text, 'Wymagania zdjęcia do dowodu.');
    assert.equal(spec.shots[0].still.pick, 0, 'pick defaults to the first option');
    assert.equal(spec.captions, false);
    assert.equal(spec.endCard.cta, 'Wejdź na example.com');
    assert.match(spec.endCard.announcer.tts, /example kropka com/, 'spoken URL is separate from the displayed text');
    assert.match(spec.endCard.announcer.text, /example\.com/);
    assert.equal(spec.endCard.url, 'example.com', 'from the kit');
    assert.equal(spec.labels.brand, 'brand', 'stamp mark from the kit');
    assert.equal(spec.endCard.style, 'real-sheet');
    assert.doesNotMatch(spec.endCard.copy, /zwrot pieniędzy/, 'guarantee sentence dropped from the end card');
    assert.equal(spec.voices.clerk.ifMissing, 'skip');
  });

  it('the warm-up spec is the first shot + end card', async () => {
    const spec = await loadSpec(WARMUP, { live: false });
    assert.equal(spec.id, 'animals-warmup-pl');
    assert.deepEqual(spec.shots.map((s) => s.id), ['quokka']);
    assert.equal(spec.endCard.url, 'example.com');
  });

  it('a live run accepts the committed spec: narrator + announcer ids are set, the clerk is skippable', async () => {
    const spec = await loadSpec(A5, { live: true });
    assert.equal(spec.voices.clerk.voiceId, null);
  });

  it('a live run refuses a used role with no voice id unless it is skippable', () => {
    const s = minimal();
    s.voices.clerk.voiceId = null;
    assert.ok(validateForLive(s).some((e) => /voices\.clerk\.voiceId is not set/.test(e)));
    s.voices.clerk.ifMissing = 'skip';
    assert.deepEqual(validateForLive(s), []);
  });

  it('fills {subject} into the shared still template', async () => {
    const spec = await loadSpec(A5, { live: false });
    assert.match(stillPromptFor(spec, spec.shots[0]), /^Photorealistic quokka with its natural wide smile, sitting upright/);
    // An explicit stillPrompt wins over the template.
    assert.equal(stillPromptFor(spec, { ...spec.shots[0], stillPrompt: 'Own prompt.' }), 'Own prompt.');
  });
});

const minimal = () => ({
  id: 'demo',
  locale: 'pl',
  voices: { narrator: { voiceId: 'n' }, clerk: { voiceId: 'c' } },
  labels: { rejected: 'NO', approved: 'YES', brand: 'b' },
  clerkLines: { rejected: 'No.', approved: 'Yes.' },
  hook: { text: 'Hook', durationSec: 2 },
  look: { stillTemplate: 'A {subject}.' },
  shots: [{ id: 'a', subject: 'cat', videoPrompt: 'v', caption: 'c', vo: { line: 'l' }, verdict: 'rejected', seed: 1 }],
  endCard: { copy: 'x', url: 'example.com', cta: 'Go to example.com' },
});

describe('validateSpec', () => {
  it('accepts a minimal valid spec', () => {
    assert.deepEqual(validateSpec(minimal()), []);
    assert.deepEqual(validateForLive(minimal()), []);
  });

  it('reports every problem with its path', () => {
    const s = minimal();
    s.id = 'Bad Id';
    s.shots[0].verdict = 'maybe';
    s.shots[0].seed = 1.5;
    delete s.shots[0].vo;
    s.labels.approved = '';
    const errors = validateSpec(s);
    for (const re of [/^id:/, /shots\[0\]\.verdict/, /shots\[0\]\.seed/, /shots\[0\]\.vo/, /labels\.approved/]) {
      assert.ok(errors.some((e) => re.test(e)), `expected ${re} in ${JSON.stringify(errors)}`);
    }
  });

  it('rejects duplicate shot ids, bad still picks and a template without {subject}', () => {
    const s = minimal();
    s.shots.push({ ...s.shots[0], still: { options: 2, pick: 2 } });
    s.look.stillTemplate = 'no token';
    const errors = validateSpec(s);
    assert.ok(errors.some((e) => /duplicate id/.test(e)));
    assert.ok(errors.some((e) => /still\.pick/.test(e)));
    assert.ok(errors.some((e) => /\{subject\}/.test(e)));
  });

  it('requires an end-card CTA that contains the URL, and a boolean captions flag', () => {
    const s = minimal();
    s.endCard.cta = 'Click here';
    s.captions = 'yes';
    const errors = validateSpec(s);
    assert.ok(errors.some((e) => /endCard\.cta: must contain endCard\.url/.test(e)));
    assert.ok(errors.some((e) => /^captions:/.test(e)));
    delete s.endCard.cta;
    assert.ok(validateSpec(s).some((e) => /needs copy, url and cta/.test(e)));
  });

  it('normalizeSpec fills still/quip/end-card defaults', () => {
    const n = normalizeSpec(minimal());
    assert.deepEqual(n.shots[0].vo.line, { text: 'l', tts: null }, 'plain strings normalise to { text, tts: null }');
    assert.equal(n.shots[0].beat, 'action', 'beat defaults to action');
    assert.equal(n.captions, false, 'burned-in captions are off by default');
    assert.equal(n.ruleCaptions, false, 'rule labels are off by default');
    assert.equal(n.endCard.announcer, null);
    assert.equal(n.endCard.backgroundClip, null);
    assert.equal(n.endCard.ctaHint, null);
    assert.equal(n.shots[0].still.options, 2);
    assert.equal(n.shots[0].vo.quip, null, 'quip defaults to null');
    assert.equal(n.endCard.durationSec, 3);
    assert.equal(n.music, null);
  });
});

describe('lines, roles and the end card', () => {
  it('accepts { text, tts } lines and gives the tag-free spoken form for offline voices', () => {
    const line = normalizeLine({ text: 'No nieeee…', tts: '[disappointed] No nieeee…' });
    assert.equal(ttsText(line), '[disappointed] No nieeee…');
    assert.equal(plainSpoken(line), 'No nieeee…');
    assert.equal(ttsText(normalizeLine('Plain.')), 'Plain.');
    assert.equal(normalizeLine(null), null);
  });

  it('validates multi-part actions and the flash mode', () => {
    const s = minimal();
    s.shots[0].action = [{ file: 'a.mp4', out: 4.5 }, { file: 'b.mp4' }];
    s.shots[0].flash = 'synthetic';
    assert.deepEqual(validateSpec(s), []);
    assert.deepEqual(normalizeSpec(s).shots[0].action[1], { in: 0, out: null, file: 'b.mp4' });
    s.shots[0].action = [{ file: 'a.mp4', in: 3, out: 2 }];
    s.shots[0].flash = 'sometimes';
    const errors = validateSpec(s);
    assert.ok(errors.some((e) => /action\[0\]\.out/.test(e)));
    assert.ok(errors.some((e) => /\.flash: one of/.test(e)));
  });

  it('enables the result structure by default, disables it with result: false; marks default off', () => {
    const s = minimal();
    const n = normalizeSpec(s);
    assert.equal(n.shots[0].result.enabled, true);
    assert.equal(n.marks, false);
    s.shots[0].result = false;
    s.marks = 'x';
    assert.equal(normalizeSpec(s).shots[0].result.enabled, false);
    assert.ok(validateSpec(s).some((e) => /^marks:/.test(e)));
  });

  it('turns intros on by default, off with intro: false, and validates intro paths', () => {
    const s = minimal();
    assert.equal(normalizeSpec(s).shots[0].intro.enabled, true);
    s.shots[0].intro = false;
    assert.equal(normalizeSpec(s).shots[0].intro.enabled, false);
    s.shots[0].intro = { still: 42 };
    assert.ok(validateSpec(s).some((e) => /intro\.still: path string/.test(e)));
  });

  it('validates the announcer role, ifMissing, postSpeed, and rejects the old endCard.vo', () => {
    const s = minimal();
    s.endCard.announcer = { text: 'Go to example.com', tts: 'Go to example dot com' };
    assert.ok(validateSpec(s).some((e) => /needs voices\.announcer/.test(e)));
    s.voices.announcer = { voiceId: 'a', postSpeed: 3, ifMissing: 'maybe' };
    s.endCard.vo = 'old';
    const errors = validateSpec(s);
    assert.ok(errors.some((e) => /announcer\.postSpeed/.test(e)));
    assert.ok(errors.some((e) => /announcer\.ifMissing/.test(e)));
    assert.ok(errors.some((e) => /endCard\.vo: replaced by endCard\.announcer/.test(e)));
    assert.deepEqual(usedVoiceRoles(s), ['narrator', 'clerk', 'announcer']);
  });
});

describe('extends', () => {
  it('selects parent shots by id in the given order and keeps overrides', () => {
    const parent = minimal();
    parent.shots.push({ ...parent.shots[0], id: 'b' });
    const merged = mergeExtends(parent, { extends: 'x.json', id: 'child', shots: ['b', 'a'] });
    assert.equal(merged.id, 'child');
    assert.deepEqual(merged.shots.map((s) => s.id), ['b', 'a']);
    assert.equal(merged.extends, undefined);
  });

  it('fails on an unknown shot id', () => {
    assert.throws(() => mergeExtends(minimal(), { shots: ['nope'] }), /unknown shot id/);
  });
});
