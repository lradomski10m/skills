import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FIXTURES_DIR } from '../lib/constants.mjs';
import { kitLocaleDefaults, loadKit } from '../lib/kit.mjs';
import { workPaths } from '../lib/paths.mjs';
import { altPath, ingest, ingestTarget, parseRole } from '../lib/ingest.mjs';
import { flashFrameTimes, reviewFolderName, reviewReadme } from '../lib/review.mjs';
import { runNameFor } from '../lib/runs.mjs';
import { checkLocaleOverlay, loadSpec, mergeLocale } from '../lib/spec.mjs';

const SPECS = path.join(FIXTURES_DIR, 'campaigns');

describe('locale overlays (shared base + per-locale text)', () => {
  it('pl and en-us load from the same base with the same shots, in base order', async () => {
    const pl = await loadSpec(path.join(SPECS, 'animals/pl.json'), { live: false });
    const en = await loadSpec(path.join(SPECS, 'animals/en-us.json'), { live: false });
    assert.deepEqual(pl.shots.map((s) => s.id), ['quokka', 'dog', 'cow', 'chameleon']);
    assert.deepEqual(en.shots.map((s) => s.id), pl.shots.map((s) => s.id));
    for (const [a, b] of pl.shots.map((s, i) => [s, en.shots[i]])) {
      assert.equal(a.videoPrompt, b.videoPrompt, 'visual prompts are shared');
      assert.equal(a.seed, b.seed);
      assert.notEqual(a.vo.line.text, b.vo.line.text, 'lines are per locale');
    }
    assert.equal(pl.labels.rejected, 'ODRZUCONE');
    assert.equal(en.labels.approved, 'APPROVED');
    assert.equal(pl.endCard.sheet.qrUrl, 'https://example.com/pl/');
    assert.equal(en.endCard.sheet.qrUrl, 'https://example.com/en-us/');
    assert.equal(pl.endCard.url, en.endCard.url, 'shared base field');
  });

  it('a subset spec extends a locale overlay', async () => {
    const two = await loadSpec(path.join(SPECS, 'animals/two.pl.json'), { live: false });
    assert.deepEqual(two.shots.map((s) => s.id), ['quokka', 'dog']);
    assert.equal(two.locale, 'pl');
  });

  it('missing-text check names every missing key (sheet keys only for real-sheet)', () => {
    const base = { shots: [{ id: 'a' }, { id: 'b' }], endCard: { style: 'real-sheet' } };
    const errors = checkLocaleOverlay(base, { locale: 'xx', shots: { a: { caption: 'x', vo: { line: 'y' } }, z: {} } });
    const missing = (k) => errors.some((e) => e.startsWith(`${k}: missing in the xx overlay`));
    assert.ok(missing('labels.rejected'));
    assert.ok(missing('endCard.sheet.qrUrl'));
    assert.ok(missing('shots.b.caption'));
    assert.ok(!checkLocaleOverlay({ ...base, endCard: { style: 'grid' } }, { locale: 'xx' }).some((e) => e.startsWith('endCard.sheet')));
    assert.ok(errors.includes('shots.z: not a shot in the base'));
    assert.ok(!errors.some((e) => e.startsWith('shots.a.')));
  });

  it('merges nested objects, replaces arrays, keeps base-only fields', () => {
    const m = mergeLocale(
      { endCard: { url: 'u', durationSec: 3 }, shots: [{ id: 'a', seed: 1 }] },
      { base: 'base.json', endCard: { cta: 'Go' }, shots: { a: { caption: 'c' } } },
    );
    assert.deepEqual(m.endCard, { url: 'u', durationSec: 3, cta: 'Go' });
    assert.deepEqual(m.shots, [{ id: 'a', seed: 1, caption: 'c' }]);
    assert.equal(m.base, undefined);
  });
});

describe('media kit', () => {
  const kitDir = async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kit-'));
    await fs.mkdir(path.join(dir, 'brand'), { recursive: true });
    await fs.mkdir(path.join(dir, 'voices'), { recursive: true });
    await fs.mkdir(path.join(dir, 'copy'), { recursive: true });
    await fs.writeFile(path.join(dir, 'brand/brand.json'), JSON.stringify({ name: 'Acme', stampMark: 'acme', url: 'acme.test', endCard: { style: 'grid' } }));
    await fs.writeFile(path.join(dir, 'brand/colours.json'), JSON.stringify({ accent: '#ff0000' }));
    await fs.writeFile(path.join(dir, 'voices/cast.json'), JSON.stringify({ '*': { clerk: { voiceId: null, ifMissing: 'skip' } }, pl: { narrator: { voiceId: 'n-pl' } } }));
    await fs.writeFile(path.join(dir, 'copy/pl.json'), JSON.stringify({ labels: { rejected: 'NIE', approved: 'TAK' }, endCard: { cta: 'Wejdź na acme.test' }, slogans: ['ignored by the engine'] }));
    return dir;
  };

  it('falls back to the built-in kit, and fills missing brand files from it', async () => {
    const def = loadKit('/nonexistent');
    assert.equal(def.isDefault, true);
    assert.ok(def.iconFile.endsWith('icon.png'));
    const k = loadKit(await kitDir());
    assert.equal(k.isDefault, false);
    assert.equal(k.name, 'Acme');
    assert.equal(k.colours.accent, '#ff0000');
    assert.ok(k.colours.rejected, 'unset colours come from the built-in kit');
    assert.ok(k.iconFile.includes('kit-default'), 'no icon in the kit → built-in icon');
  });

  it('gives a locale its cast (* under the locale) and engine copy', async () => {
    const d = kitLocaleDefaults(loadKit(await kitDir()), 'pl');
    assert.deepEqual(d.voices, { clerk: { voiceId: null, ifMissing: 'skip' }, narrator: { voiceId: 'n-pl' } });
    assert.deepEqual(d.labels, { brand: 'acme', rejected: 'NIE', approved: 'TAK' });
    assert.equal(d.endCard.cta, 'Wejdź na acme.test');
    assert.equal(d.endCard.url, 'acme.test');
    assert.equal(d.endCard.style, 'grid');
    assert.equal(d.slogans, undefined, 'free-form copy stays for the skill');
  });

  it('a campaign overlay wins over kit copy; the kit fills what it leaves out', async () => {
    const dir = await kitDir();
    await fs.writeFile(path.join(dir, 'brand/brand.json'), JSON.stringify({ name: 'Acme', stampMark: 'acme', url: 'example.com' }));
    const spec = await loadSpec(path.join(SPECS, 'animals/pl.json'), { live: false, kit: loadKit(dir) });
    assert.equal(spec.labels.rejected, 'ODRZUCONE', 'overlay wins');
    assert.equal(spec.labels.brand, 'acme', 'kit fills');
    assert.equal(spec.endCard.wordmark, 'Acme');
    assert.equal(spec.endCard.url, 'example.com');
    assert.equal(spec.endCard.style, 'real-sheet', 'campaign style wins over the kit');
  });
});

describe('ingest', () => {
  it('parses roles', () => {
    assert.deepEqual(parseRole('clip:quokka.oneshot'), { kind: 'clip', target: 'quokka.oneshot' });
    assert.deepEqual(parseRole('music'), { kind: 'music', target: null });
    assert.throws(() => parseRole('video:cow'), /kind one of/);
    assert.throws(() => parseRole('still:Cow'), /lowercase id/);
    assert.throws(() => parseRole('music:bed'), /no target/);
  });
  it('maps roles onto the numbered work folders', () => {
    const P = workPaths({ workRoot: '/w', campaign: 'c', locale: 'pl' });
    assert.equal(ingestTarget(parseRole('clip:cow'), P), '/w/c/3-clips/cow.mp4');
    assert.equal(ingestTarget(parseRole('result:cow'), P), '/w/c/2-stills/cow.result.png');
    assert.equal(ingestTarget(parseRole('perfect:cow'), P), '/w/c/2-stills/perfect/cow.png');
    assert.equal(ingestTarget(parseRole('vo:cow.line'), P), '/w/c/1-voice/pl/cow.line.mp3');
    assert.equal(ingestTarget(parseRole('vo:hook'), P), '/w/c/1-voice/pl/hook.mp3');
    assert.equal(ingestTarget(parseRole('vo:endcard.announcer'), P), '/w/c/1-voice/pl/endcard.announcer.mp3');
    assert.equal(ingestTarget(parseRole('music'), P), '/w/c/4-music/bed.mp3');
  });
  it('picks the next free _alt name', () => {
    const taken = new Set(['/d/clips/_alt/cow.prev1.mp4']);
    assert.equal(altPath('/d/clips/cow.mp4', (p) => taken.has(p)), '/d/clips/_alt/cow.prev2.mp4');
  });
  it('moves the previous file to _alt instead of overwriting it', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'));
    const src = path.join(dir, 'new.mp3');
    await fs.writeFile(src, 'new');
    const paths = workPaths({ workRoot: path.join(dir, 'work'), campaign: 'c', locale: 'pl' });
    await fs.mkdir(paths.voiceDir, { recursive: true });
    await fs.writeFile(path.join(paths.voiceDir, 'hook.mp3'), 'old');
    const { dest, moved } = await ingest({ source: src, paths, as: 'vo:hook', log: () => {} });
    assert.equal(await fs.readFile(dest, 'utf8'), 'new');
    assert.equal(await fs.readFile(moved, 'utf8'), 'old');
    assert.match(moved, /1-voice\/pl\/_alt\/hook\.prev1\.mp3$/);
  });
});

describe('review', () => {
  it('names runs like the pipeline', () => {
    assert.equal(runNameFor('demo-pl', { inputs: true }), 'demo-pl.inputs');
    assert.equal(runNameFor('demo-pl', { offline: true, onlyShot: 'dog' }), 'demo-pl.dog.offline');
    assert.equal(runNameFor('demo-pl'), 'demo-pl');
  });
  it('frames around the flash stay inside the shot', () => {
    const seg = { startSec: 10, plan: { durationSec: 5, events: { shutterAt: 3, resultAt: 3.3, stampAt: 3.5 } } };
    const t = flashFrameTimes(seg);
    assert.deepEqual(t, [12.6, 12.85, 13, 13.1, 13.35, 13.9]);
    const early = flashFrameTimes({ startSec: 0, plan: { durationSec: 1, events: { shutterAt: 0.1, resultAt: null, stampAt: 0.8 } } });
    assert.ok(early.every((x) => x >= 0 && x < 1));
  });
  it('numbers folders and lists them in the README', () => {
    assert.equal(reviewFolderName(3, 'cow'), '3 - cow');
    const text = reviewReadme({ spec: { id: 'x', title: 'X' }, runName: 'x.inputs', totalSec: 12.345, folders: [{ name: '1 - cow', files: ['a.png'] }] });
    assert.match(text, /video\.mp4 \(12\.35 s\)/);
    assert.match(text, /1 - cow\s+: a\.png/);
  });
});
