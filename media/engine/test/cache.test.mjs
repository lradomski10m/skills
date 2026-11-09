import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CacheStore } from '../lib/cache.mjs';
import { cacheKey, canonicalJson } from '../lib/hash.mjs';

describe('cache keys', () => {
  it('ignore object key order and undefined members', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    assert.equal(cacheKey('clips', { a: 1, b: undefined }), cacheKey('clips', { a: 1 }));
  });

  it('change with any output-determining input and with the stage', () => {
    const base = { prompt: 'p', seed: 1, still: 'abc' };
    const k = cacheKey('clips', base);
    assert.notEqual(k, cacheKey('clips', { ...base, seed: 2 }));
    assert.notEqual(k, cacheKey('clips', { ...base, prompt: 'p ' }));
    assert.notEqual(k, cacheKey('clips', { ...base, still: 'abd' }));
    assert.notEqual(k, cacheKey('stills', base));
    assert.match(k, /^[0-9a-f]{20}$/);
  });

  it('array order matters', () => {
    assert.notEqual(cacheKey('x', [1, 2]), cacheKey('x', [2, 1]));
  });
});

describe('CacheStore', () => {
  it('produces once, then serves the cached entry without calling produce again', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ad-video-cache-'));
    const store = new CacheStore(root);
    let calls = 0;
    const produce = async (e) => {
      calls++;
      await fs.writeFile(e.file('out.txt'), 'paid');
      return { n: calls };
    };
    const first = await store.getOrCreate('clips', { seed: 1 }, produce);
    const second = await store.getOrCreate('clips', { seed: 1 }, produce);
    assert.equal(first.hit, false);
    assert.equal(second.hit, true);
    assert.equal(calls, 1);
    assert.equal(await fs.readFile(second.entry.file('out.txt'), 'utf8'), 'paid');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('treats an entry without meta.json (interrupted run) as a miss', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ad-video-cache-'));
    const store = new CacheStore(root);
    const entry = store.entry('clips', { seed: 3 });
    await store.prepare(entry);
    assert.equal(await store.readMeta(entry), null);
    await fs.rm(root, { recursive: true, force: true });
  });
});
