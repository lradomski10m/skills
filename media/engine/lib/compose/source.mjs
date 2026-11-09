// Markdown + YAML source handling shared by storyboards and presets: front matter,
// `##` sections, fenced ```yaml blocks, Markdown tables — every value keeps a way back
// to its file:line, so validation errors point at the right place.

import path from 'node:path';
import { isMap, isSeq, LineCounter, parseDocument } from 'yaml';
import { UserError } from '../errors.mjs';

/** One validation problem. `file:line [shot id] path: message`. */
export function problem(file, line, message, { shot = null, at = null } = {}) {
  return { file, line, shot, at, message };
}

export const formatProblem = (p) =>
  `${p.file ? path.basename(p.file) : '?'}${p.line ? `:${p.line}` : ''}${p.shot ? ` shot ${p.shot}` : ''}${p.at ? ` ${p.at}` : ''}: ${p.message}`;

export class SourceError extends UserError {
  constructor(problems) {
    super(`${problems.length} problem(s):\n${problems.map((p) => `  ${formatProblem(p)}`).join('\n')}`);
    this.problems = problems;
  }
}

/**
 * Parse YAML that starts at `baseLine` (1-based line of its first line) in `file`.
 * Returns `{ data, lineOf(pathArray) }`; YAML syntax errors become problems.
 */
export function parseYamlAt(src, file, baseLine, problems) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(src, { lineCounter, prettyErrors: true, uniqueKeys: true });
  for (const err of doc.errors) {
    const line = err.linePos?.[0]?.line;
    problems.push(problem(file, line ? baseLine + line - 1 : baseLine, `YAML: ${err.message.split('\n')[0]}`));
  }
  const lineOf = (p) => {
    let node = doc.contents;
    let best = node;
    for (const key of p) {
      if (!node) break;
      if (isMap(node)) {
        const pair = node.items.find((it) => String(it.key?.value ?? it.key) === String(key));
        node = pair?.value ?? null;
        best = pair?.key ?? best;
        if (node) best = node;
      } else if (isSeq(node)) {
        node = node.items[Number(key)] ?? null;
        if (node) best = node;
      } else break;
    }
    const offset = best?.range?.[0];
    return offset === undefined ? baseLine : baseLine + lineCounter.linePos(offset).line - 1;
  };
  return { data: doc.errors.length ? null : doc.toJS({ maxAliasCount: 50 }), lineOf };
}

/** Split `---` front matter. Returns `{ yaml, yamlLine, body, bodyLine }` (lines 1-based). */
export function splitFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { yaml: null, yamlLine: 0, body: text, bodyLine: 1 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { yaml: null, yamlLine: 0, body: text, bodyLine: 1, unterminated: true };
  return { yaml: lines.slice(1, end).join('\n'), yamlLine: 2, body: lines.slice(end + 1).join('\n'), bodyLine: end + 2 };
}

/** `## Title` sections of a Markdown body: `{ title, line, lines[], startLine }`. */
export function sections(body, bodyLine) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let cur = null;
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = !fence && /^##\s+(.+?)\s*$/.exec(l);
    if (m) {
      cur = { title: m[1], line: bodyLine + i, lines: [], startLine: bodyLine + i + 1 };
      out.push(cur);
    } else if (cur) cur.lines.push(l);
  });
  return out;
}

/** Fenced code blocks of a language inside a section: `{ src, line }` (line of the first content line). */
export function fencedBlocks(section, lang = 'yaml') {
  const out = [];
  let open = null;
  section.lines.forEach((l, i) => {
    const m = /^\s*```\s*([\w-]*)\s*$/.exec(l);
    if (!m) {
      if (open) open.body.push(l);
      return;
    }
    if (!open) open = { lang: m[1], start: section.startLine + i + 1, body: [] };
    else {
      if (open.lang === lang) out.push({ src: open.body.join('\n'), line: open.start });
      open = null;
    }
  });
  return out;
}

/** Markdown pipe table inside a section → `{ header[], rows: [{ cells[], line }] }` (first table only). */
export function markdownTable(section) {
  const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const rows = [];
  let header = null;
  section.lines.forEach((l, i) => {
    if (!/^\s*\|/.test(l)) return;
    const cells = split(l);
    if (!header) header = cells;
    else if (cells.every((c) => /^:?-{2,}:?$/.test(c))) return;
    else rows.push({ cells, line: section.startLine + i });
  });
  return header ? { header, rows } : null;
}
