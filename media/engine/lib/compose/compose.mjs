// The composer: storyboard + presets → resolved timeline (segments, overlays, audio,
// effects, captions). Shots are laid out back to back; each runs its preset's planner,
// then its emits are evaluated as anchor expressions in a scope of params, planner
// events, music beats and campaign-wide events. Asset access and analysis go through
// `ctx` (the pipeline in production, stubs in tests), so this module stays testable.

import { chunkWords, placeChunks, settleChunkTimes, wordsFromAlignment } from '../captions.mjs';
import { CONFIG } from '../config.mjs';
import { BUILTIN_GRAPHIC, BUS } from '../constants.mjs';
import { UserError } from '../errors.mjs';
import { BUILTINS, PLACES } from './builtins.mjs';
import { evaluate, ExprError } from './expr.mjs';
import { PLANNERS } from './planners.mjs';
import { shotParams } from './presets.mjs';
import { problem, SourceError } from './source.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
/** Default gains: voice 1; synthesised SFX as tuned in 0.1.x. */
const SFX_GAIN = Object.freeze({ thud: 0.9, ding: 0.45, shutter: 0.6, whoosh: 0.35 });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const getPath = (obj, parts) => parts.reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

/** Resolve a declared param to what planners/emits use (assets become objects). */
async function resolveParam(decl, value, ctx) {
  if (value === null || value === undefined) return null;
  switch (decl.type) {
    case 'clip':
      return ctx.clip(value);
    case 'still':
      return ctx.still(value);
    case 'vo':
      return ctx.vo(value, decl.role ?? 'narrator');
    case 'sfx':
      return ctx.sfx(value);
    case 'music':
      return ctx.music(value);
    case 'kit':
      return ctx.kitFile(value);
    case 'text':
      return ctx.text(value);
    case 'list':
      if (!decl.items) return value;
      return Promise.all(
        value.map(async (el) => {
          if (isObj(el)) return { ...el, [decl.items]: await resolveParam({ type: decl.items }, el[decl.items] ?? el.key, ctx) };
          return { [decl.items]: await resolveParam({ type: decl.items }, el, ctx) };
        }),
      );
    default:
      return value;
  }
}

export async function compose(sb, { presets, ctx, only = null, withEnd = true }) {
  const problems = [];
  const front = sb.front;
  const tempo = ctx.tempo;
  const beats = ctx.beats ?? null;
  const globals = { shots: { count: 0, end: 0 }, total: 0 };
  const items = [];

  const asShot = (id, fields, lineOf = () => sb.frontLineOf([id])) => ({ id, title: id, line: lineOf([]), fields, lineOf, file: sb.file });
  const all = sb.shots.filter((s) => !only || s.id === only);
  if (only && !all.length) throw new UserError(`--only: no shot "${only}" (have: ${sb.shots.map((s) => s.id).join(', ')})`);

  /** Prepare an item: preset lookup + param validation. */
  const prepare = (shot, role) => {
    const preset = presets.get(shot.fields.preset);
    if (!preset) {
      problems.push(problem(shot.file, shot.lineOf(['preset']), `unknown preset "${shot.fields.preset}" (have: ${[...presets.keys()].sort().join(', ')})`, { shot: shot.id }));
      return null;
    }
    return { shot, preset, role, params: shotParams(shot, preset, problems) };
  };
  const hookItem = front.hook ? prepare(asShot('hook', { preset: 'hook-title', ...front.hook }, (p) => sb.frontLineOf(['hook', ...p])), 'hook') : null;
  const shotItems = all.map((s) => prepare(s, 'shot'));
  const endItem = withEnd && front.end && !only ? prepare(asShot('end', front.end, (p) => sb.frontLineOf(['end', ...p])), 'end') : null;
  if (problems.length) throw new SourceError(problems);

  /** Scope resolver for one item. */
  const scopeFor = (item, extra) => (refPath) => {
    const [head, ...rest] = refPath.split('.');
    if (head.startsWith('$')) return getPath(item.resolved, [head.slice(1), ...rest]);
    switch (head) {
      case 'plan':
        return getPath(item.plan.events, rest);
      case 'start':
        return 0;
      case 'shotStart':
        return item.start;
      case 'end':
      case 'duration':
        return item.plan.durationSec;
      case 'first':
        return extra.index === 0;
      case 'last':
        return extra.index === extra.count - 1;
      case 'index':
        return extra.index;
      case 'global':
        return getPath(globals, rest);
      case 'kit':
        return getPath(ctx.kit ?? {}, rest);
      case 'copy':
        return getPath(ctx.copy ?? {}, rest);
      case 'config':
        return getPath(CONFIG, rest);
      case 'tempo':
        return getPath(tempo, rest);
      case 'beat':
      case 'downbeat': {
        const list = (head === 'beat' ? beats?.beats : beats?.downbeats) ?? [];
        const after = list.filter((b) => b >= item.start - 1e-6).map((b) => b - item.start);
        if (rest[0] === 'next') return after[0];
        if (rest[0] === 'prev') return list.filter((b) => b < item.start).map((b) => b - item.start).at(-1);
        return after[Number(rest[0]) - 1];
      }
      case 'drop':
        return beats?.drop != null ? beats.drop - item.start : undefined;
      default:
        return undefined;
    }
  };
  const here = (item, at) => ({ file: item.shot.file, line: item.shot.lineOf(at), shot: item.shot.id });
  const evalAt = (item, extra, expr, at) => {
    try {
      return evaluate(expr, scopeFor(item, extra), { beats: beats?.beats?.map((b) => b - item.start) });
    } catch (err) {
      if (!(err instanceof ExprError)) throw err;
      const h = here(item, at);
      problems.push(problem(h.file, h.line, `${at.join('.')}: ${err.message}`, { shot: h.shot }));
      return undefined;
    }
  };
  /** Non-time values: `$param`, `=expr`, `{t: key}`, `{{t.key}}` interpolation; recursive. */
  const valueOf = (item, extra, v, at) => {
    if (typeof v === 'string') {
      if (/^\$[\w.-]+$/.test(v)) return scopeFor(item, extra)(v);
      if (v.startsWith('=')) return evalAt(item, extra, v.slice(1), at);
      return v.includes('{{t.') ? v.replace(/\{\{t\.([\w.-]+)\}\}/g, (_, k) => ctx.text({ t: k })) : v;
    }
    if (Array.isArray(v)) return v.map((x, i) => valueOf(item, extra, x, [...at, i]));
    if (isObj(v)) {
      if (typeof v.t === 'string' && Object.keys(v).length === 1) return ctx.text(v);
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valueOf(item, extra, x, [...at, k])]));
    }
    return v;
  };

  /** Resolve params, run the planner. */
  const run = async (item, extra) => {
    item.resolved = {};
    for (const [k, d] of Object.entries(item.preset.body.params ?? {})) {
      try {
        // `=expr` values (typically defaults such as "=copy.endCard.cta") are evaluated first.
        const raw = typeof item.params[k] === 'string' && item.params[k].startsWith('=') ? evalAt(item, extra, item.params[k].slice(1), [k]) : item.params[k];
        item.resolved[k] = await resolveParam(d, raw, ctx);
      } catch (err) {
        const h = here(item, [k]);
        problems.push(problem(h.file, h.line, `${k}: ${err.message}`, { shot: h.shot }));
      }
    }
    const planDecl = item.preset.body.plan ?? { planner: 'none' };
    const planner = PLANNERS[planDecl.planner];
    if (!planner) throw new SourceError([problem(item.preset.file, null, `unknown planner "${planDecl.planner}" (have: ${Object.keys(PLANNERS).join(', ')})`)]);
    item.plan = { events: {}, durationSec: 0 };
    const args = {};
    for (const [k, v] of Object.entries(planDecl.args ?? {})) {
      // Planner args are expressions (`$param`, `plan.x`, `first ? a : b`); objects/lists recurse as values.
      args[k] = typeof v === 'string' ? evalAt(item, extra, v, ['plan', k]) : valueOf(item, extra, v, ['plan', k]);
    }
    try {
      item.plan = await planner(args, { ...ctx, shotId: item.shot.id, globalStart: item.start, tempo, beats });
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      const h = here(item, []);
      throw new SourceError([problem(h.file, h.line, err.message, { shot: h.shot })]);
    }
    for (const [k, v] of Object.entries(item.preset.body.exports ?? {})) {
      const val = evalAt(item, extra, v, ['exports', k]);
      globals[item.shot.id] = { ...(globals[item.shot.id] ?? {}), [k]: val };
    }
  };

  // 1. hook (no segment; exports e.g. hook.minFirstVoStart for the first shot)
  if (hookItem) {
    hookItem.start = 0;
    await run(hookItem, { index: 0, count: 1 });
  }
  // 2. shots back to back, then the end card
  let t = 0;
  const laid = [];
  const ordered = [...shotItems.map((it) => [it, 'shot']), ...(endItem ? [[endItem, 'end']] : [])];
  for (const [i, [item]] of ordered.entries()) {
    item.start = t;
    item.extra = { index: i, count: ordered.length };
    await run(item, item.extra);
    laid.push(item);
    t += item.plan.durationSec;
    if (item.role === 'shot') globals.shots = { count: globals.shots.count + 1, end: r3(t) };
  }
  globals.total = r3(t);
  if (problems.length) throw new SourceError(problems);

  // 3. emits (evaluated after layout, so global.total / shots.end are known)
  const segments = [];
  const audio = [];
  const overlays = [];
  const effects = [];
  const chunks = [];
  const pushAudio = (item, extra, a, at) => {
    if (a.when !== undefined && !evalAt(item, extra, a.when, [...at, 'when'])) return;
    const atSec = evalAt(item, extra, a.at ?? 0, [...at, 'at']);
    if (atSec === undefined || atSec === null) {
      const h = here(item, at);
      problems.push(problem(h.file, h.line, `${at.join('.')}.at: could not be resolved (use ?? for a fallback)`, { shot: h.shot }));
      return;
    }
    const g = item.start + atSec;
    if (a.vo !== undefined) {
      const line = valueOf(item, extra, a.vo, [...at, 'vo']);
      if (!line) return;
      audio.push({ file: line.file, atSec: r3(g), durSec: r3(line.durationSec), bus: BUS.VOICE, gain: a.gain ?? 1, label: line.key });
      if (line.alignment) chunks.push(...placeChunks(chunkWords(wordsFromAlignment(line.alignment)), g));
    } else if (a.sfx !== undefined) {
      const name = valueOf(item, extra, a.sfx, [...at, 'sfx']);
      if (!name) return;
      audio.push({ file: ctx.sfx(name), atSec: r3(g), bus: BUS.SFX, gain: a.gain ?? SFX_GAIN[name] ?? 1, label: name });
    } else if (a.dialogue !== undefined) {
      const c = valueOf(item, extra, a.dialogue, [...at, 'dialogue']);
      if (c?.file) audio.push({ file: c.file, atSec: r3(g), durSec: r3(c.durationSec), bus: BUS.VOICE, gain: a.gain ?? 1, label: 'dialogue', inSec: a.in ?? 0 });
    }
  };
  const pushOverlay = (item, extra, o, at) => {
    if (o.when !== undefined && !evalAt(item, extra, o.when, [...at, 'when'])) return;
    const from = item.start + (evalAt(item, extra, o.from ?? 0, [...at, 'from']) ?? 0);
    const toLocal = evalAt(item, extra, o.to ?? 'end', [...at, 'to']);
    const to = item.start + (toLocal ?? item.plan.durationSec);
    const params = valueOf(item, extra, o.params ?? {}, [...at, 'params']);
    const place = Object.fromEntries(Object.entries(o.place ?? {}).map(([k, v]) => [k, typeof v === 'string' && PLACES[v] ? PLACES[v]() : typeof v === 'string' && k !== 'anchor' && k !== 'area' ? evalAt(item, extra, v, [...at, 'place', k]) : v]));
    const base = { fromSec: r3(from), toSec: r3(to), z: o.z ?? 0 };
    if (o.fadeIn) base.fadeIn = { startSec: r3(from), durSec: evalAt(item, extra, o.fadeIn.dur ?? o.fadeIn, [...at, 'fadeIn']) };
    if (o.slide) base.slide = { startSec: r3(from), durSec: evalAt(item, extra, o.slide.dur, [...at, 'slide', 'dur']), dyPx: evalAt(item, extra, o.slide.dy, [...at, 'slide', 'dy']) };
    if (o.pip) {
      const clip = valueOf(item, extra, o.pip, [...at, 'pip']);
      overlays.push({ ...base, kind: 'pip', graphic: 'pip', clip: clip?.file, quad: valueOf(item, extra, o.quad, [...at, 'quad']), inSec: o.in ?? 0, speed: o.speed ?? 1 });
      return;
    }
    const tpl = String(valueOf(item, extra, o.template ?? '', [...at, 'template']) ?? '');
    if (tpl.startsWith(BUILTIN_GRAPHIC)) {
      const name = tpl.slice(BUILTIN_GRAPHIC.length);
      const b = BUILTINS[name];
      if (!b) {
        const h = here(item, at);
        problems.push(problem(h.file, h.line, `unknown built-in graphic "${name}" (have: ${Object.keys(BUILTINS).join(', ')})`, { shot: h.shot }));
        return;
      }
      overlays.push({ ...base, kind: 'builtin', graphic: b.label(params), builtin: name, params, place: { ...b.place(params), ...place } });
      return;
    }
    overlays.push({ ...base, kind: 'template', graphic: `${tpl}`, template: tpl, params, animate: o.animate ? valueOf(item, extra, o.animate, [...at, 'animate']) : null, place: { anchor: 'top', ...place } });
  };
  const pushEffect = (item, extra, e, at) => {
    if (e.when !== undefined && !evalAt(item, extra, e.when, [...at, 'when'])) return;
    const from = item.start + (evalAt(item, extra, e.from ?? 0, [...at, 'from']) ?? 0);
    const to = item.start + (evalAt(item, extra, e.to ?? 'end', [...at, 'to']) ?? item.plan.durationSec);
    effects.push({ name: e.name, fromSec: r3(from), toSec: r3(to), params: valueOf(item, extra, e.params ?? {}, [...at, 'params']) });
  };
  const emitsOf = (item) => {
    const b = item.preset.body;
    const extraShot = item.shot.fields;
    return {
      audio: [...(b.audio ?? []), ...(extraShot.audio ?? [])],
      overlays: [...(b.overlays ?? []), ...(extraShot.overlays ?? [])],
      effects: [...(b.effects ?? []), ...(extraShot.effects ?? [])],
    };
  };
  const emit = (item, extra) => {
    const e = emitsOf(item);
    e.audio.forEach((a, i) => pushAudio(item, extra, a, ['audio', i]));
    e.overlays.forEach((o, i) => pushOverlay(item, extra, o, ['overlays', i]));
    e.effects.forEach((x, i) => pushEffect(item, extra, x, ['effects', i]));
  };
  // Cuts: a sound into every cut after the first (tempo supplies lead + gain).
  const cutSfx = front.cuts?.sfx ?? null;
  for (const [i, item] of laid.entries()) {
    let local = 0;
    for (const s of item.plan.segments) {
      segments.push({ ...s, id: item.shot.id, startSec: r3(item.start + local), durationSec: r3(s.durationSec), review: (s.review ?? []).map((x) => r3(item.start + local + x)) });
      local += s.durationSec;
    }
    if (i > 0) {
      if (cutSfx && tempo.whoosh) {
        const lead = front.cuts.lead ?? tempo.whoosh.leadSec;
        if (item.start > 0) audio.push({ file: ctx.sfx(cutSfx), atSec: r3(Math.max(0, item.start - lead)), bus: BUS.SFX, gain: front.cuts.gain ?? tempo.whoosh.gain, label: cutSfx });
      }
      const tr = item.shot.fields.transition ?? front.cuts?.transition;
      if (tr && tr.name !== 'cut') effects.push({ name: `transition:${tr.name}`, fromSec: r3(item.start - (tr.durSec ?? 0.2) / 2), toSec: r3(item.start + (tr.durSec ?? 0.2) / 2), params: { ...tr, atSec: r3(item.start) } });
    }
    emit(item, item.extra);
  }
  if (hookItem) emit(hookItem, { index: 0, count: 1 });
  // Campaign-wide overlays: brand bug + front.overlays (global time, start = 0).
  const globalItem = { shot: asShot('front', {}), preset: { body: {} }, resolved: {}, plan: { events: {}, durationSec: globals.total }, start: 0 };
  if (front.brandBug && globals.shots.end > 0) {
    pushOverlay(globalItem, { index: 0, count: 1 }, { template: 'builtin:brand-bug', from: front.brandBug.from ?? 0, to: front.brandBug.to ?? 'global.shots.end', params: {} }, ['brandBug']);
  }
  (front.overlays ?? []).forEach((o, i) => pushOverlay(globalItem, { index: 0, count: 1 }, o, ['overlays', i]));
  if (problems.length) throw new SourceError(problems);
  return {
    totalSec: globals.total,
    segments,
    audio,
    overlays,
    effects,
    captions: front.captions ? settleChunkTimes(chunks).map((c) => ({ ...c, start: r3(c.start), end: r3(c.end) })) : [],
    events: globals,
  };
}
