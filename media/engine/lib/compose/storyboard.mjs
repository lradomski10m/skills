// storyboard.md: YAML front matter (campaign globals) + `## Text` locale table +
// one `## Shot <id> — <title>` section per shot with a fenced ```yaml block. Prose
// is ignored. Optional `storyboard.<locale>.md` overlays (text + shot overrides) and
// `extends:` subsets (cut-downs). Every problem is reported with file:line.

import fs from 'node:fs';
import path from 'node:path';
import { deepMerge } from '../kit.mjs';
import { fencedBlocks, markdownTable, parseYamlAt, problem, sections, SourceError, splitFrontMatter } from './source.mjs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHOT_RE = /^Shot\s+([A-Za-z0-9_-]+)\s*(?:[—–-]+\s*(.*))?$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Front-matter keys the engine reads (others are kept for the skill and ignored). */
export const FRONT_KEYS = Object.freeze([
  'campaign', 'title', 'locales', 'tempo', 'tempoOverrides', 'cuts', 'hook', 'brandBug', 'overlays',
  'music', 'end', 'captions', 'extends', 'shots', 'source', 'id',
]);

function readFile(file, problems) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    problems.push(problem(file, null, 'file not found'));
    return null;
  }
}

/** Parse one storyboard-shaped Markdown file (no extends / overlays applied). */
export function parseStoryboardFile(file, problems, { requireFront = true } = {}) {
  const text = readFile(file, problems);
  if (text === null) return null;
  const fm = splitFrontMatter(text);
  let front = {};
  let frontLineOf = () => 1;
  if (fm.yaml !== null) {
    const y = parseYamlAt(fm.yaml, file, fm.yamlLine, problems);
    front = y.data ?? {};
    frontLineOf = y.lineOf;
  } else if (requireFront) problems.push(problem(file, 1, fm.unterminated ? 'front matter not closed with ---' : 'missing YAML front matter (--- … ---)'));
  if (!isObj(front)) {
    problems.push(problem(file, fm.yamlLine, 'front matter must be a YAML mapping'));
    front = {};
  }
  const out = { file, front, frontLineOf, text: {}, textCols: null, shots: [] };
  for (const sec of sections(fm.body, fm.bodyLine)) {
    if (/^Text\b/i.test(sec.title)) {
      const table = markdownTable(sec);
      if (!table) {
        problems.push(problem(file, sec.line, '## Text needs a Markdown table (| key | <locale> | …)'));
        continue;
      }
      out.textCols = table.header.slice(1);
      if (table.header[0].toLowerCase() !== 'key') problems.push(problem(file, sec.line, '## Text: the first column must be "key"'));
      for (const row of table.rows) {
        const key = row.cells[0];
        if (!key) continue;
        if (out.text[key]) problems.push(problem(file, row.line, `## Text: duplicate key "${key}"`));
        out.text[key] = { line: row.line, values: Object.fromEntries(out.textCols.map((col, i) => [col, (row.cells[i + 1] ?? '').replace(/\\\|/g, '|')])) };
      }
      continue;
    }
    const m = SHOT_RE.exec(sec.title);
    if (!m) continue;
    const id = m[1];
    const blocks = fencedBlocks(sec, 'yaml');
    if (blocks.length !== 1) {
      problems.push(problem(file, sec.line, `needs exactly one \`\`\`yaml block (found ${blocks.length})`, { shot: id }));
      continue;
    }
    const y = parseYamlAt(blocks[0].src, file, blocks[0].line, problems);
    if (y.data !== null && !isObj(y.data)) problems.push(problem(file, blocks[0].line, 'the yaml block must be a mapping', { shot: id }));
    out.shots.push({ id, title: m[2] ?? '', line: sec.line, fields: isObj(y.data) ? y.data : {}, lineOf: y.lineOf, file });
  }
  return out;
}

/**
 * Load a campaign storyboard for one locale: extends → base, locale overlay
 * (`storyboard.<locale>.md`), validation. Throws SourceError with every problem.
 */
export function loadStoryboard(file, { locale }) {
  const problems = [];
  const abs = path.resolve(file);
  let sb = parseStoryboardFile(abs, problems);
  if (!sb) throw new SourceError(problems);
  // extends: a cut-down / variant of another storyboard (front-matter overrides + shot subset).
  if (sb.front.extends) {
    const parentFile = path.resolve(path.dirname(abs), sb.front.extends);
    const parent = parseStoryboardFile(parentFile, problems);
    if (parent) {
      const { extends: _e, shots: pick, ...over } = sb.front;
      const byId = new Map(parent.shots.map((s) => [s.id, s]));
      let shots = parent.shots;
      if (Array.isArray(pick)) {
        const unknown = pick.filter((id) => !byId.has(id));
        if (unknown.length) problems.push(problem(abs, sb.frontLineOf(['shots']), `extends: unknown shot id(s) ${unknown.join(', ')}`));
        shots = pick.filter((id) => byId.has(id)).map((id) => byId.get(id));
      }
      const own = new Map(sb.shots.map((s) => [s.id, s]));
      sb = {
        ...parent,
        file: abs,
        front: deepMerge(parent.front, over),
        text: { ...parent.text, ...sb.text },
        shots: shots.map((s) => (own.has(s.id) ? { ...s, fields: deepMerge(s.fields, own.get(s.id).fields) } : s)),
        parentFile,
      };
    }
  }
  const front = sb.front;
  const fl = (k) => sb.frontLineOf([k]);
  if (typeof front.campaign !== 'string' || !SLUG_RE.test(front.campaign)) problems.push(problem(abs, fl('campaign'), 'campaign: lowercase slug required (it names media-work/<campaign>)'));
  if (!Array.isArray(front.locales) || !front.locales.length) problems.push(problem(abs, fl('locales'), 'locales: list required, e.g. [en-us]'));
  else if (locale && !front.locales.includes(locale)) problems.push(problem(abs, fl('locales'), `locale "${locale}" is not in locales [${front.locales.join(', ')}]`));
  const ids = new Set();
  for (const s of sb.shots) {
    if (!SLUG_RE.test(s.id)) problems.push(problem(s.file, s.line, 'shot id: lowercase slug (a-z, 0-9, -)', { shot: s.id }));
    if (ids.has(s.id)) problems.push(problem(s.file, s.line, 'duplicate shot id', { shot: s.id }));
    ids.add(s.id);
    if (typeof s.fields.preset !== 'string') problems.push(problem(s.file, s.lineOf([]), 'preset: required (name of a preset)', { shot: s.id }));
  }
  if (!sb.shots.length) problems.push(problem(abs, null, 'no "## Shot <id>" sections'));

  // Locale overlay: storyboard.<locale>.md → text + shot field overrides.
  const text = Object.fromEntries(Object.entries(sb.text).map(([k, v]) => [k, { ...v }]));
  const overlayFile = locale ? path.join(path.dirname(abs), `${path.basename(abs, '.md')}.${locale}.md`) : null;
  if (overlayFile && fs.existsSync(overlayFile)) {
    const ov = parseStoryboardFile(overlayFile, problems, { requireFront: false });
    if (ov) {
      for (const [k, v] of Object.entries(ov.text)) {
        const value = v.values[locale] ?? v.values.text ?? Object.values(v.values)[0];
        text[k] = { line: v.line, file: overlayFile, values: { ...(text[k]?.values ?? {}), [locale]: value } };
      }
      for (const o of ov.shots) {
        const target = sb.shots.find((s) => s.id === o.id);
        if (!target) problems.push(problem(overlayFile, o.line, 'not a shot in the storyboard', { shot: o.id }));
        else target.fields = deepMerge(target.fields, o.fields);
      }
    }
  }
  // Every text key needs a value in every locale of the campaign.
  for (const [key, v] of Object.entries(text)) {
    for (const l of front.locales ?? []) {
      if (!v.values[l]) problems.push(problem(v.file ?? abs, v.line, `text "${key}": missing ${l}`));
    }
  }
  if (problems.length) throw new SourceError(problems);
  return { file: abs, dir: path.dirname(abs), locale, front, text, shots: sb.shots, frontLineOf: sb.frontLineOf };
}
