import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FIXTURES_DIR } from '../lib/constants.mjs';
import { loadStoryboard } from '../lib/compose/storyboard.mjs';
import { formatProblem, SourceError } from '../lib/compose/source.mjs';
import { makeText } from '../lib/compose/text.mjs';
import { altPath, ingest, ingestTarget, parseRole } from '../lib/ingest.mjs';
import { loadKit } from '../lib/kit.mjs';
import { workPaths } from '../lib/paths.mjs';
import { reviewFolderName, reviewReadme, shotFrameTimes } from '../lib/review.mjs';
import { runNameFor } from '../lib/runs.mjs';

const EXAMPLE = path.join(FIXTURES_DIR, 'campaigns', 'animals', 'storyboard.md');
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'sb-'));
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

describe('storyboard.md', () => {
  it('reads front matter, the Text table and one yaml block per shot', () => {
    const sb = loadStoryboard(EXAMPLE, { locale: 'pl' });
    assert.equal(sb.front.campaign, 'animals');
    assert.deepEqual(sb.shots.map((s) => s.id), ['quokka', 'dog', 'cow', 'chameleon']);
    assert.equal(sb.shots[3].fields.beat, 'settle');
    assert.equal(sb.text.hook.values.pl, 'Wymagania zdjęcia do dowodu');
    assert.equal(makeText(sb, 'en-us')({ t: 'hook' }), 'Passport photo requirements');
  });

  it('reports every problem with file:line and shot', async () => {
    const dir = await tmp();
    const f = await write(
      dir,
      'storyboard.md',
      ['---', 'campaign: Bad Name', 'locales: [pl, en-us]', '---', '', '## Text', '| key | pl | en-us |', '|---|---|---|', '| hook | Cześć | |', '', '## Shot one — x', 'no yaml here', '', '## Shot two — y', '```yaml', 'clip: a', '```', ''].join('\n'),
    );
    const p = problemsOf(() => loadStoryboard(f, { locale: 'pl' }));
    assert.ok(p.some((x) => /storyboard\.md:2: campaign: lowercase slug/.test(x)), p.join('\n'));
    assert.ok(p.some((x) => /storyboard\.md:9: text "hook": missing en-us/.test(x)));
    assert.ok(p.some((x) => /storyboard\.md:11 shot one: needs exactly one ```yaml block/.test(x)));
    assert.ok(p.some((x) => /storyboard\.md:16 shot two: preset: required/.test(x)), p.join('\n'));
  });

  it('applies a per-locale overlay (text + shot fields) and extends for cut-downs', async () => {
    const dir = await tmp();
    const base = ['---', 'campaign: demo', 'locales: [pl]', '---', '## Text', '| key | pl |', '|---|---|', '| a | jeden |', '', '## Shot s1 — one', '```yaml', 'preset: x', 'n: 1', '```', '## Shot s2 — two', '```yaml', 'preset: x', '```', ''].join('\n');
    const f = await write(dir, 'storyboard.md', base);
    await write(dir, 'storyboard.pl.md', ['## Text', '| key | text |', '|---|---|', '| a | JEDEN |', '## Shot s1 — one', '```yaml', 'n: 2', '```', ''].join('\n'));
    const sb = loadStoryboard(f, { locale: 'pl' });
    assert.equal(sb.text.a.values.pl, 'JEDEN');
    assert.equal(sb.shots[0].fields.n, 2);
    const cut = await write(dir, 'teaser.md', ['---', 'extends: storyboard.md', 'shots: [s2]', 'title: Teaser', '---', ''].join('\n'));
    const t = loadStoryboard(cut, { locale: 'pl' });
    assert.deepEqual(t.shots.map((s) => s.id), ['s2']);
    assert.equal(t.front.campaign, 'demo');
    assert.equal(t.front.title, 'Teaser');
  });

  it('rejects a locale the campaign does not declare', () => {
    const p = problemsOf(() => loadStoryboard(EXAMPLE, { locale: 'de' }));
    assert.ok(p.some((x) => /locale "de" is not in locales/.test(x)));
  });
});

describe('media kit (YAML)', () => {
  const kitDir = async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, 'copy'));
    await write(dir, 'brand.yaml', 'name: Acme\nstampMark: acme\nurl: acme.test\nendCard: { style: grid }\ncolours: { accent: "#ff0000" }\n');
    await write(dir, 'voices.yaml', '"*": { clerk: { voiceId: null, ifMissing: skip } }\npl: { narrator: { voiceId: n-pl } }\n');
    await write(path.join(dir, 'copy'), 'pl.yaml', 'labels: { reject: NIE, approve: TAK }\ntext: { slogan: Szybko }\n');
    return dir;
  };
  it('loads brand, colours, voices and copy; falls back to the built-in kit', async () => {
    const k = loadKit(await kitDir());
    assert.equal(k.isDefault, false);
    assert.equal(k.name, 'Acme');
    assert.equal(k.colours.accent, '#ff0000');
    assert.ok(k.colours.rejected, 'unset colours come from the built-in kit');
    assert.ok(k.iconFile.endsWith('icon.png'));
    assert.deepEqual(k.voicesFor('pl'), { clerk: { voiceId: null, ifMissing: 'skip' }, narrator: { voiceId: 'n-pl' } });
    assert.equal(k.copyFor('pl').labels.reject, 'NIE');
    assert.ok(k.fontFiles.some((f) => f.endsWith('Inter-Bold.ttf')), 'bundled fonts are always available');
    assert.equal(loadKit('/nonexistent').isDefault, true);
  });
  it('kit copy text: is a fallback for the storyboard table', async () => {
    const k = loadKit(await kitDir());
    const sb = loadStoryboard(EXAMPLE, { locale: 'pl' });
    const text = makeText(sb, 'pl', k.copyFor('pl'));
    assert.equal(text({ t: 'slogan' }), 'Szybko');
    assert.equal(text('Hej {{t.slogan}}!'), 'Hej Szybko!');
    assert.throws(() => text({ t: 'nope' }), /text "nope" has no pl value/);
  });
  it('refuses a 0.1.x JSON kit with a pointer to migrate-kit', async () => {
    const dir = await kitDir();
    await fs.mkdir(path.join(dir, 'brand'));
    await write(path.join(dir, 'brand'), 'brand.json', '{}');
    assert.throws(() => loadKit(dir), /migrate-kit/);
  });
});

describe('ingest', () => {
  it('parses roles', () => {
    assert.deepEqual(parseRole('clip:quokka.oneshot'), { kind: 'clip', target: 'quokka.oneshot' });
    assert.deepEqual(parseRole('music'), { kind: 'music', target: null });
    assert.throws(() => parseRole('video:cow'), /kind one of/);
    assert.throws(() => parseRole('still:Cow'), /lowercase id/);
  });
  it('maps roles onto the numbered work folders', () => {
    const P = workPaths({ workRoot: '/w', campaign: 'c', locale: 'pl' });
    assert.equal(ingestTarget(parseRole('clip:cow'), P), '/w/c/3-clips/cow.mp4');
    assert.equal(ingestTarget(parseRole('result:cow'), P), '/w/c/2-stills/cow.result.png');
    assert.equal(ingestTarget(parseRole('perfect:cow'), P), '/w/c/2-stills/perfect/cow.png');
    assert.equal(ingestTarget(parseRole('vo:cow.line'), P), '/w/c/1-voice/pl/cow.line.mp3');
    assert.equal(ingestTarget(parseRole('music'), P), '/w/c/4-music/bed.mp3');
  });
  it('moves the previous file to _alt instead of overwriting it', async () => {
    const dir = await tmp();
    const src = await write(dir, 'new.mp3', 'new');
    const paths = workPaths({ workRoot: path.join(dir, 'work'), campaign: 'c', locale: 'pl' });
    await fs.mkdir(paths.voiceDir, { recursive: true });
    await write(paths.voiceDir, 'hook.mp3', 'old');
    const { dest, moved } = await ingest({ source: src, paths, as: 'vo:hook', log: () => {} });
    assert.equal(await fs.readFile(dest, 'utf8'), 'new');
    assert.equal(await fs.readFile(moved, 'utf8'), 'old');
    assert.match(moved, /1-voice\/pl\/_alt\/hook\.prev1\.mp3$/);
    assert.equal(altPath('/d/x.mp4', (p) => p.endsWith('prev1.mp4')), '/d/_alt/x.prev2.mp4');
  });
});

describe('review', () => {
  it('names runs like the pipeline', () => {
    assert.equal(runNameFor('demo-pl', { inputs: true }), 'demo-pl.inputs');
    assert.equal(runNameFor('demo-pl', { offline: true, onlyShot: 'dog' }), 'demo-pl.dog.offline');
  });
  it('takes key frames from segment hints, clamped inside the shot', () => {
    const shot = { id: 'a', startSec: 10, endSec: 15 };
    const t = shotFrameTimes([{ id: 'a', review: [9, 12, 16] }, { id: 'b', review: [20] }], shot);
    assert.deepEqual(t, [10, 12, 14.967]);
    assert.deepEqual(shotFrameTimes([], shot), [10.1, 12.5, 14.967]);
  });
  it('numbers folders and lists them in the README', () => {
    assert.equal(reviewFolderName(3, 'cow'), '3 - cow');
    const text = reviewReadme({ title: 'X', runName: 'x.inputs', totalSec: 12.345, folders: [{ name: '1 - cow', files: ['a.png'] }] });
    assert.match(text, /video\.mp4 \(12\.35 s\)/);
    assert.match(text, /1 - cow\s+: a\.png/);
  });
});
