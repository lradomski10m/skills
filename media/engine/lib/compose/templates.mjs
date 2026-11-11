// SVG templates → PNG with resvg (fonts from files, no system lookup). A template is
// an SVG with `{{placeholder}}` markers and an optional metadata comment:
//   <!-- template: { size: [600, 140], params: { value: number, label: text } } -->
// Filters: upper, lower, int, fixed:N, time (m:ss), pad:N. `{{colour.<name>}}` and
// `{{font.family}}` come from the kit. `data-fit-width="N"` on a <text> shrinks it to N px.
// Animated overlays render a cached frame sequence (params, opacity, scale, dx, dy keyframes).

import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { parse as parseYaml } from 'yaml';
import { BUILTIN_TEMPLATES_DIR } from '../constants.mjs';
import { UserError } from '../errors.mjs';

const META_RE = /<!--\s*template:\s*([\s\S]*?)-->/;
const PH_RE = /\{\{\s*([\w.-]+)((?:\|[\w-]+(?::[^|}]*)?)*)\s*\}\}/g;
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Template file for a name: the kit's templates/ first, then the engine's. */
export function findTemplate(name, kitTemplatesDir) {
  for (const dir of [kitTemplatesDir, BUILTIN_TEMPLATES_DIR]) {
    if (!dir) continue;
    const f = path.join(dir, name.endsWith('.svg') ? name : `${name}.svg`);
    if (fs.existsSync(f)) return f;
  }
  throw new UserError(`template "${name}" not found in ${[kitTemplatesDir, BUILTIN_TEMPLATES_DIR].filter(Boolean).join(' or ')}`);
}

export function templateMeta(svg) {
  const m = META_RE.exec(svg);
  if (!m) return {};
  try {
    return parseYaml(m[1]) ?? {};
  } catch (err) {
    throw new UserError(`template metadata is not valid YAML: ${err.message.split('\n')[0]}`);
  }
}

const FILTERS = {
  upper: (v) => String(v).toUpperCase(),
  lower: (v) => String(v).toLowerCase(),
  int: (v) => String(Math.round(Number(v))),
  fixed: (v, n) => Number(v).toFixed(Number(n ?? 1)),
  time: (v) => {
    const s = Math.max(0, Math.round(Number(v)));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  pad: (v, n) => String(v).padStart(Number(n ?? 2), '0'),
  invert: (v) => 1 - Number(v),
  scale: (v, n) => Number(v) * Number(n ?? 1),
};

/** Fill placeholders. `vars` = { params…, colour: {…}, font: { family } }. Pure. */
export function fill(svg, vars, name = 'template') {
  return svg.replace(PH_RE, (_, key, filters) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    const list = filters.split('|').filter(Boolean);
    const dflt = list.find((f) => f.startsWith('default'));
    if ((v === undefined || v === null) && !dflt) throw new UserError(`${name}: missing value for {{${key}}} (add |default: for an optional one)`);
    let out = v ?? dflt.slice('default:'.length);
    for (const f of list.filter((x) => !x.startsWith('default'))) {
      const [fn, arg] = f.split(':');
      if (!FILTERS[fn]) throw new UserError(`${name}: unknown filter |${fn}`);
      out = FILTERS[fn](out, arg);
    }
    return xml(out);
  });
}

const HIDDEN_RE = /\b(?:display="none"|visibility="hidden"|opacity="0")/;
const decode = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/**
 * Words a template draws that are not `{{param}}`s: the visible content of every
 * <text> (with its <tspan>s) after placeholders are removed, plus `|default:` values.
 * A hard-coded word renders in every locale ("teraz" leaked into an English cut), so
 * `plan` warns about each. Digits, symbols and punctuation are fine. Pure.
 */
export function templateTextLeaks(svg) {
  const src = String(svg).replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc|metadata|style|script)\b[\s\S]*?<\/\1>/g, '');
  const leaks = [];
  for (const m of src.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    if (HIDDEN_RE.test(m[1])) continue;
    const visible = decode(m[2].replace(/<tspan\b[^>]*(?:display="none"|visibility="hidden")[^>]*>[\s\S]*?<\/tspan>/g, '').replace(/<[^>]+>/g, ' ').replace(PH_RE, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (/\p{L}/u.test(visible)) leaks.push(visible);
  }
  for (const m of src.matchAll(PH_RE)) {
    const dflt = m[2].split('|').find((f) => f.startsWith('default:'));
    const value = dflt?.slice('default:'.length) ?? '';
    if (/\p{L}/u.test(value)) leaks.push(`{{${m[1]}|default:${value}}}`);
  }
  return leaks;
}

const resvgOpts = (fontFiles, family) => ({ font: { fontFiles, loadSystemFonts: false, defaultFontFamily: family }, fitTo: { mode: 'original' } });

/** Measured width of one <text> element (rendered alone in the same canvas). */
function textWidth(svgOpen, textEl, opts) {
  const r = new Resvg(`${svgOpen}${textEl}</svg>`, opts);
  const b = r.getBBox();
  return b ? b.width : 0;
}

/** Shrink every `data-fit-width` text until it fits. */
export function fitText(svg, opts) {
  const open = /<svg[^>]*>/.exec(svg)?.[0];
  if (!open) return svg;
  return svg.replace(/<text\b[^>]*data-fit-width="(\d+)"[^>]*>[\s\S]*?<\/text>/g, (el, max) => {
    let cur = el;
    for (let i = 0; i < 3; i++) {
      const w = textWidth(open, cur, opts);
      if (!(w > Number(max))) break;
      cur = cur.replace(/font-size="([\d.]+)"/, (_, fs0) => `font-size="${((Number(fs0) * Number(max)) / w) * 0.98}"`);
    }
    return cur;
  });
}

/** Render a filled SVG string to PNG. */
export function renderSvg(svg, { fontFiles, family = 'Inter' }) {
  const opts = resvgOpts(fontFiles, family);
  return new Resvg(fitText(svg, opts), opts).render().asPng();
}

const EASE = { linear: (x) => x, out: (x) => 1 - (1 - x) ** 2, in: (x) => x * x, inout: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) };

/** Value of a keyframed property at time t (numbers interpolate, others step). Pure. */
export function keyframeAt(keys, t, ease = 'linear') {
  if (!Array.isArray(keys) || !keys.length) return keys;
  const sorted = [...keys].sort((a, b) => a[0] - b[0]);
  if (t <= sorted[0][0]) return sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const [t0, v0] = sorted[i - 1];
    const [t1, v1] = sorted[i];
    if (t <= t1) {
      if (typeof v0 !== 'number' || typeof v1 !== 'number') return v0;
      const x = (EASE[ease] ?? EASE.linear)((t - t0) / Math.max(1e-9, t1 - t0));
      return v0 + (v1 - v0) * x;
    }
  }
  return sorted.at(-1)[1];
}

/** Wrap an SVG's content in a group with opacity / scale (about the centre) / offset. Pure. */
export function transformSvg(svg, { opacity = 1, scale = 1, dx = 0, dy = 0 }) {
  if (opacity === 1 && scale === 1 && !dx && !dy) return svg;
  const open = /<svg[^>]*>/.exec(svg)[0];
  const w = Number(/\bwidth="([\d.]+)"/.exec(open)?.[1] ?? 0);
  const h = Number(/\bheight="([\d.]+)"/.exec(open)?.[1] ?? 0);
  const g = `<g opacity="${opacity}" transform="translate(${dx} ${dy}) translate(${w / 2} ${h / 2}) scale(${scale}) translate(${-w / 2} ${-h / 2})">`;
  return svg.replace(open, `${open}${g}`).replace(/<\/svg>\s*$/, '</g></svg>');
}

/**
 * Frames for an animated overlay: for each frame time, params with keyframed values
 * substituted and transform props applied. Returns SVG strings (caller renders + caches).
 */
export function animatedFrames(svg, vars, animate, durationSec, fps, name) {
  const { ease = 'linear', ...props } = animate;
  const n = Math.max(1, Math.round(durationSec * fps));
  const transformKeys = ['opacity', 'scale', 'dx', 'dy'];
  const frames = [];
  for (let f = 0; f < n; f++) {
    const t = f / fps;
    const p = { ...vars };
    const tr = {};
    for (const [k, keys] of Object.entries(props)) {
      const v = keyframeAt(keys, t, ease);
      if (transformKeys.includes(k)) tr[k] = v;
      else p[k] = v;
    }
    frames.push(transformSvg(fill(svg, p, name), tr));
  }
  return frames;
}
