// Presets: named, parameterised shot recipes in Markdown (front matter + one fenced
// ```yaml body). Built-ins live in engine/presets/, project ones in
// media-kit/presets/ (same name wins). A preset declares its params (type, default,
// doc), the planner it uses, and the segments / audio / overlays / effects it emits,
// with timing written as anchor expressions (expr.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_PRESETS_DIR } from '../constants.mjs';
import { deepMerge } from '../kit.mjs';
import { fencedBlocks, parseYamlAt, problem, sections, SourceError, splitFrontMatter } from './source.mjs';

export const PARAM_TYPES = Object.freeze(['clip', 'still', 'vo', 'sfx', 'music', 'kit', 'text', 'number', 'bool', 'enum', 'time', 'list', 'object', 'any']);
/** Keys a shot may set besides its preset's params. */
export const SHOT_KEYS = Object.freeze(['preset', 'transition', 'audio', 'overlays', 'effects', 'notes']);
const BODY_KEYS = Object.freeze(['params', 'plan', 'segments', 'audio', 'overlays', 'effects', 'exports', 'review']);

function parsePresetFile(file, problems) {
  const text = fs.readFileSync(file, 'utf8');
  const fm = splitFrontMatter(text);
  const front = fm.yaml !== null ? parseYamlAt(fm.yaml, file, fm.yamlLine, problems).data ?? {} : {};
  const name = front.name ?? path.basename(file, '.md');
  // The body is the first ```yaml block anywhere after the front matter (docs around it).
  const all = sections(`## _\n${fm.body}`, fm.bodyLine - 1);
  const blocks = all.flatMap((s) => fencedBlocks(s, 'yaml'));
  const body = blocks.length ? parseYamlAt(blocks[0].src, file, blocks[0].line, problems).data ?? {} : {};
  for (const k of Object.keys(body)) if (!BODY_KEYS.includes(k)) problems.push(problem(file, blocks[0].line, `unknown preset key "${k}" (allowed: ${BODY_KEYS.join(', ')})`));
  for (const [p, d] of Object.entries(body.params ?? {})) {
    if (!PARAM_TYPES.includes(d?.type)) problems.push(problem(file, blocks[0]?.line, `param ${p}: type must be one of ${PARAM_TYPES.join(', ')}`));
  }
  return { name, summary: front.summary ?? '', extends: front.extends ?? null, file, body, docs: fm.body.trim() };
}

/** All presets: built-ins, then the kit's (overriding by name), with `extends` resolved. */
export function loadPresets(kitPresetsDir = null) {
  const problems = [];
  const raw = new Map();
  for (const dir of [BUILTIN_PRESETS_DIR, kitPresetsDir]) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
      const p = parsePresetFile(path.join(dir, f), problems);
      raw.set(p.name, { ...p, origin: dir === BUILTIN_PRESETS_DIR ? 'builtin' : 'kit' });
    }
  }
  const resolved = new Map();
  const resolve = (name, seen = []) => {
    if (resolved.has(name)) return resolved.get(name);
    const p = raw.get(name);
    if (!p) return null;
    if (seen.includes(name)) {
      problems.push(problem(p.file, null, `extends cycle: ${[...seen, name].join(' → ')}`));
      return null;
    }
    let body = p.body;
    if (p.extends) {
      const parent = resolve(p.extends, [...seen, name]);
      if (!parent) problems.push(problem(p.file, null, `extends unknown preset "${p.extends}"`));
      else body = { ...parent.body, ...p.body, params: deepMerge(parent.body.params ?? {}, p.body.params ?? {}) };
    }
    const out = { ...p, body };
    resolved.set(name, out);
    return out;
  };
  for (const name of raw.keys()) resolve(name);
  if (problems.length) throw new SourceError(problems);
  return resolved;
}

const typeOk = {
  clip: (v) => typeof v === 'string' || (Array.isArray(v) && v.every((p) => typeof p === 'string' || typeof p?.file === 'string')),
  still: (v) => typeof v === 'string',
  vo: (v) => typeof v === 'string',
  sfx: (v) => typeof v === 'string',
  music: (v) => typeof v === 'string',
  kit: (v) => typeof v === 'string',
  text: (v) => typeof v === 'string' || (typeof v?.t === 'string' && Object.keys(v).length === 1),
  number: (v) => typeof v === 'number' || (typeof v === 'string' && v.startsWith('=')),
  bool: (v) => typeof v === 'boolean',
  enum: (v) => typeof v === 'string',
  time: (v) => typeof v === 'number' || typeof v === 'string',
  list: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  any: () => true,
};

/**
 * A shot's params: declared params with defaults applied, every problem collected
 * (unknown key, wrong type, missing required, enum value). Pure.
 */
export function shotParams(shot, preset, problems) {
  const decl = preset.body.params ?? {};
  const out = {};
  for (const [k, v] of Object.entries(shot.fields)) {
    if (SHOT_KEYS.includes(k)) continue;
    if (!decl[k]) {
      problems.push(problem(shot.file, shot.lineOf([k]), `unknown param "${k}" for preset ${preset.name} (has: ${Object.keys(decl).join(', ') || 'none'})`, { shot: shot.id }));
      continue;
    }
    out[k] = v;
  }
  for (const [k, d] of Object.entries(decl)) {
    if (out[k] === undefined) {
      if (d.required) problems.push(problem(shot.file, shot.lineOf([]), `${k}: required by preset ${preset.name}${d.doc ? ` (${d.doc})` : ''}`, { shot: shot.id }));
      else out[k] = d.default ?? null;
      continue;
    }
    if (out[k] === null) continue;
    if (!typeOk[d.type]?.(out[k])) problems.push(problem(shot.file, shot.lineOf([k]), `${k}: expected ${d.type}, got ${JSON.stringify(out[k])}`, { shot: shot.id }));
    if (d.type === 'enum' && !d.values?.includes(out[k])) problems.push(problem(shot.file, shot.lineOf([k]), `${k}: one of ${d.values.join(', ')} (got ${out[k]})`, { shot: shot.id }));
  }
  return out;
}

/** Markdown listing of presets and their params (cli `presets`). Pure. */
export function describePresets(presets) {
  return [...presets.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const params = Object.entries(p.body.params ?? {})
        .map(([k, d]) => `  - ${k} (${d.type}${d.required ? ', required' : d.default !== undefined ? `, default ${JSON.stringify(d.default)}` : ''})${d.doc ? ` — ${d.doc}` : ''}`)
        .join('\n');
      return `${p.name} [${p.origin}]${p.extends ? ` extends ${p.extends}` : ''} — ${p.summary}\n${params}`;
    })
    .join('\n\n');
}
