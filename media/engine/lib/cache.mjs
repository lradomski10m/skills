// On-disk store: work/cache/<stage>/<key>/{files…, meta.json}. An entry is
// complete only once meta.json exists — it is written last.

import fs from 'node:fs/promises';
import path from 'node:path';
import { FILE } from './constants.mjs';
import { cacheKey } from './hash.mjs';

export class CacheStore {
  constructor(root) {
    this.root = root;
  }

  entry(stage, inputs) {
    const key = cacheKey(stage, inputs);
    const dir = path.join(this.root, stage, key);
    return {
      key,
      dir,
      file: (name) => path.join(dir, name),
      metaFile: path.join(dir, FILE.META),
    };
  }

  async readMeta(entry) {
    try {
      return JSON.parse(await fs.readFile(entry.metaFile, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async prepare(entry) {
    await fs.mkdir(entry.dir, { recursive: true });
  }

  async commit(entry, meta) {
    await fs.writeFile(entry.metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  }

  /**
   * Return the cached meta, or run `produce(entry)` (which writes files into
   * entry.dir and returns meta) and commit it.
   */
  async getOrCreate(stage, inputs, produce) {
    const entry = this.entry(stage, inputs);
    const cached = await this.readMeta(entry);
    if (cached) return { entry, meta: cached, hit: true };
    await this.prepare(entry);
    const meta = await produce(entry);
    await this.commit(entry, meta);
    return { entry, meta, hit: false };
  }
}
