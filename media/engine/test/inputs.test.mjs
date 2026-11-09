import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createInputs, inputPath } from '../lib/inputs.mjs';
import { resolveRoots, workPaths } from '../lib/paths.mjs';
import { scaleAlignment } from '../lib/pipeline.mjs';

describe('inputs in media-work/<campaign>/', () => {
  const P = workPaths({ workRoot: '/w', campaign: 'c', locale: 'pl' });
  const at = inputPath(P);

  it('maps items to the numbered work folders (voice per locale, visuals shared)', () => {
    assert.equal(at.still('quokka'), '/w/c/2-stills/quokka.png');
    assert.equal(at.clip('endcard'), '/w/c/3-clips/endcard.mp4');
    assert.equal(at.vo('quokka', 'line'), '/w/c/1-voice/pl/quokka.line.mp3');
    assert.equal(at.vo('endcard', 'announcer'), '/w/c/1-voice/pl/endcard.announcer.mp3');
    assert.equal(at.vo('hook'), '/w/c/1-voice/pl/hook.mp3');
    assert.equal(at.introStill('quokka'), '/w/c/2-stills/quokka.intro.png');
    assert.equal(at.introClip('quokka'), '/w/c/3-clips/quokka.intro.mp4');
    assert.equal(at.resultStill('quokka'), '/w/c/2-stills/quokka.result.png');
    assert.equal(at.perfectPhoto('quokka'), '/w/c/2-stills/perfect/quokka.png');
    assert.equal(at.music(), '/w/c/4-music/bed.mp3');
  });

  it('derives every campaign folder from (workRoot, campaign, locale)', () => {
    assert.equal(P.rendersDir, '/w/c/5-renders/pl');
    assert.equal(P.reviewDir, '/w/c/review/pl');
    assert.equal(P.cacheDir, '/w/.cache', 'the cache is shared by every campaign');
    assert.equal(P.readme, '/w/c/README.md');
  });

  it('resolves kit and work roots: flag, then env, then ./media-kit + ./media-work', () => {
    assert.deepEqual(resolveRoots({}, {}, '/p'), { kitRoot: '/p/media-kit', workRoot: '/p/media-work' });
    assert.deepEqual(resolveRoots({}, { MEDIA_KIT: 'k', MEDIA_WORK: '/abs' }, '/p'), { kitRoot: '/p/k', workRoot: '/abs' });
    assert.equal(resolveRoots({ kit: 'x' }, { MEDIA_KIT: 'k' }, '/p').kitRoot, '/p/x');
  });

  it('returns provided files and null for missing ones (caller falls back)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-inputs-'));
    const paths = workPaths({ workRoot: dir, campaign: 'c', locale: 'pl' });
    await fs.mkdir(paths.voiceDir, { recursive: true });
    await fs.writeFile(path.join(paths.voiceDir, 'quokka.line.mp3'), 'x');
    const inputs = createInputs(paths);
    assert.equal(inputs.enabled, true);
    assert.equal(inputs.vo('quokka', 'line'), path.join(paths.voiceDir, 'quokka.line.mp3'));
    assert.equal(inputs.vo('quokka', 'quip'), null);
    assert.equal(inputs.still('quokka'), null);
    assert.equal(createInputs(workPaths({ workRoot: dir, campaign: 'c', locale: 'en-us' })).vo('quokka', 'line'), null, 'no pl VO leaks into en-us');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('ignores alternates in _alt/ and non-matching names', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-inputs-'));
    const paths = workPaths({ workRoot: dir, campaign: 'c', locale: 'pl' });
    await fs.mkdir(path.join(paths.voiceDir, '_alt'), { recursive: true });
    await fs.writeFile(path.join(paths.voiceDir, '_alt', 'quokka.quip.mp3'), 'x');
    await fs.writeFile(path.join(paths.voiceDir, 'quokka.quip.v2.mp3'), 'x');
    assert.equal(createInputs(paths).vo('quokka', 'quip'), null);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is inert without paths', () => {
    const inputs = createInputs(null);
    assert.equal(inputs.enabled, false);
    assert.equal(inputs.vo('quokka', 'line'), null);
  });
});

describe('post-speed', () => {
  it('rescales alignment times after atempo', () => {
    const a = { characters: ['a', 'b'], character_start_times_seconds: [0, 1.2], character_end_times_seconds: [1.2, 2.4] };
    const s = scaleAlignment(a, 1 / 1.2);
    assert.deepEqual(s.character_end_times_seconds.map((x) => Math.round(x * 1000) / 1000), [1, 2]);
    assert.deepEqual(s.characters, a.characters);
  });
});
