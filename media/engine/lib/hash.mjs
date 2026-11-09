// Content-hash cache keys. Pure: a key depends only on the values that change
// the paid output, so an unchanged still/clip/VO is never paid for twice.

import { createHash } from 'node:crypto';

/** Bump when a stage's output format changes so old cache entries are ignored. */
export const CACHE_SCHEMA = 1;

/** JSON with recursively sorted object keys; `undefined` members are dropped. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v ?? null)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Stable 20-hex key for a stage + its output-determining inputs. */
export function cacheKey(stage, inputs) {
  return createHash('sha256')
    .update(canonicalJson({ schema: CACHE_SCHEMA, stage, inputs }))
    .digest('hex')
    .slice(0, 20);
}

export function fileHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 20);
}
