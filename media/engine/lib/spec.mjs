// Video spec: load (with `extends` + shot subset) and validate. Validation is
// pure and returns every problem at once, each prefixed with its JSON path.

import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { UserError } from './errors.mjs';
import { BEAT_MODE, END_CARD_STYLE, FLASH_MODE, IF_MISSING, LOCALE_KEYS, LOCALE_SHOT_KEYS, REQUIRED_VOICE_ROLES, SHEET_LOCALE_KEYS, VERDICTS, VOICE_ROLE } from './constants.mjs';
import { deepMerge, kit as currentKit, kitLocaleDefaults } from './kit.mjs';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SUBJECT_TOKEN = '{subject}';
const MAX_STILL_OPTIONS = 4;

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isAbsent = (v) => v === undefined || v === null;

/**
 * A spoken line: a plain string, or `{ text, tts }` where `text` is the display /
 * caption form and `tts` the generation text (may carry emotion tags such as
 * "[disappointed]" or a spoken URL). Pure.
 */
export const normalizeLine = (line) => (isAbsent(line) ? null : typeof line === 'string' ? { text: line, tts: null } : { tts: null, ...line });

const TTS_TAG_RE = /\[[^\]]*\]\s*/g;
/** Generation text for a line (tts form, else display text). Pure. */
export const ttsText = (line) => line.tts ?? line.text;
/** Spoken form without emotion tags — for voices that would read tags aloud (offline `say`). Pure. */
export const plainSpoken = (line) => ttsText(line).replace(TTS_TAG_RE, '').trim();

function checkLine(line, at, errors, { required }) {
  if (isAbsent(line)) return required && errors.push(`${at}: required (string or { text, tts })`);
  if (typeof line === 'string') return !isStr(line) && errors.push(`${at}: non-empty string`);
  if (!isObj(line) || !isStr(line.text)) return errors.push(`${at}: string or { text, tts }`);
  if (!isAbsent(line.tts) && !isStr(line.tts)) errors.push(`${at}.tts: string`);
}

export class SpecError extends UserError {
  constructor(file, errors) {
    super(`Invalid spec ${file}:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    this.errors = errors;
  }
}

function checkVoice(v, at, errors) {
  if (!isObj(v)) return errors.push(`${at}: required object`);
  if (v.voiceId !== null && v.voiceId !== undefined && !isStr(v.voiceId)) errors.push(`${at}.voiceId: string or null`);
  if (v.modelId !== undefined && !isStr(v.modelId)) errors.push(`${at}.modelId: non-empty string`);
  if (v.settings !== undefined && !isObj(v.settings)) errors.push(`${at}.settings: object`);
  if (!isAbsent(v.ifMissing) && !Object.values(IF_MISSING).includes(v.ifMissing)) errors.push(`${at}.ifMissing: one of ${Object.values(IF_MISSING).join(', ')}`);
  if (!isAbsent(v.postSpeed) && !(v.postSpeed >= 0.5 && v.postSpeed <= 2)) errors.push(`${at}.postSpeed: number 0.5..2 (atempo after generation)`);
}

function checkShot(shot, i, spec, errors) {
  const at = `shots[${i}]`;
  if (!isObj(shot)) return errors.push(`${at}: required object`);
  if (!isStr(shot.id) || !SLUG_RE.test(shot.id)) errors.push(`${at}.id: lowercase ASCII slug`);
  if (!isStr(shot.stillPrompt) && !isStr(shot.subject)) errors.push(`${at}: needs "subject" (fills look.stillTemplate) or "stillPrompt"`);
  if (!isStr(shot.videoPrompt)) errors.push(`${at}.videoPrompt: non-empty string`);
  if (!isStr(shot.caption)) errors.push(`${at}.caption: non-empty string (rule text shown in the pill)`);
  if (!VERDICTS.includes(shot.verdict)) errors.push(`${at}.verdict: one of ${VERDICTS.join(', ')}`);
  if (!isInt(shot.seed)) errors.push(`${at}.seed: integer`);
  if (!isObj(shot.vo)) errors.push(`${at}.vo: object with line (+ optional quip)`);
  else {
    checkLine(shot.vo.line, `${at}.vo.line`, errors, { required: true });
    checkLine(shot.vo.quip, `${at}.vo.quip`, errors, { required: false });
  }
  if (shot.still !== undefined) {
    const s = shot.still;
    if (!isObj(s)) errors.push(`${at}.still: object`);
    else {
      const options = s.options ?? CONFIG.stills.defaultOptions;
      if (!isInt(options) || options < 1 || options > MAX_STILL_OPTIONS) errors.push(`${at}.still.options: integer 1..${MAX_STILL_OPTIONS}`);
      if (s.pick !== undefined && (!isInt(s.pick) || s.pick < 0 || s.pick >= options)) errors.push(`${at}.still.pick: integer 0..${options - 1}`);
      if (s.file !== undefined && !isStr(s.file)) errors.push(`${at}.still.file: path string`);
    }
  }
  if (!isAbsent(shot.intro) && shot.intro !== false) {
    if (!isObj(shot.intro)) errors.push(`${at}.intro: false (disable) or { still?, clip? }`);
    else for (const key of ['still', 'clip']) if (!isAbsent(shot.intro[key]) && !isStr(shot.intro[key])) errors.push(`${at}.intro.${key}: path string`);
  }
  if (!isAbsent(shot.action)) {
    if (!Array.isArray(shot.action) || shot.action.length === 0) errors.push(`${at}.action: non-empty array of { file, in?, out? }`);
    else {
      shot.action.forEach((part, k) => {
        const pat = `${at}.action[${k}]`;
        if (!isObj(part) || !isStr(part.file)) return errors.push(`${pat}.file: path (relative to clips/)`);
        if (!isAbsent(part.in) && !(part.in >= 0)) errors.push(`${pat}.in: seconds ≥ 0`);
        if (!isAbsent(part.out) && !(part.out > (part.in ?? 0))) errors.push(`${pat}.out: seconds > in`);
      });
    }
  }
  if (!isAbsent(shot.beat) && !Object.values(BEAT_MODE).includes(shot.beat)) {
    errors.push(`${at}.beat: one of ${Object.values(BEAT_MODE).join(', ')}`);
  }
  if (!isAbsent(shot.flash) && !Object.values(FLASH_MODE).includes(shot.flash)) {
    errors.push(`${at}.flash: one of ${Object.values(FLASH_MODE).join(', ')}`);
  }
  if (!isAbsent(shot.result) && shot.result !== false) {
    if (!isObj(shot.result)) errors.push(`${at}.result: false (disable) or { still? }`);
    else if (!isAbsent(shot.result.still) && !isStr(shot.result.still)) errors.push(`${at}.result.still: path string`);
  }
  if (isStr(shot.subject) && !isStr(shot.stillPrompt) && !spec.look?.stillTemplate?.includes(SUBJECT_TOKEN)) {
    errors.push(`${at}: uses "subject" but look.stillTemplate has no ${SUBJECT_TOKEN} token`);
  }
}

/** Pure structural validation. Returns an array of error strings (empty = valid). */
export function validateSpec(spec) {
  const errors = [];
  if (!isObj(spec)) return ['spec: must be a JSON object'];
  if (!isStr(spec.id) || !SLUG_RE.test(spec.id)) errors.push('id: lowercase ASCII slug');
  if (!isStr(spec.locale)) errors.push('locale: non-empty string');
  if (!isObj(spec.voices)) errors.push(`voices: object with ${REQUIRED_VOICE_ROLES.join(' + ')}`);
  else {
    REQUIRED_VOICE_ROLES.forEach((role) => checkVoice(spec.voices[role], `voices.${role}`, errors));
    if (!isAbsent(spec.voices.announcer)) checkVoice(spec.voices.announcer, 'voices.announcer', errors);
    if (!isAbsent(spec.endCard?.announcer) && isAbsent(spec.voices.announcer)) errors.push('endCard.announcer needs voices.announcer');
  }
  for (const group of ['labels', 'clerkLines']) {
    if (!isObj(spec[group])) errors.push(`${group}: object`);
    else VERDICTS.forEach((v) => !isStr(spec[group][v]) && errors.push(`${group}.${v}: non-empty string`));
  }
  if (isObj(spec.labels) && !isStr(spec.labels.brand)) errors.push('labels.brand: non-empty string');
  if (!isObj(spec.hook) || !isStr(spec.hook.text)) errors.push('hook.text: non-empty string');
  else {
    if (!(spec.hook.durationSec > 0)) errors.push('hook.durationSec: positive number');
    checkLine(spec.hook.vo, 'hook.vo', errors, { required: false });
  }
  if (!isObj(spec.look) || !isStr(spec.look.stillTemplate)) errors.push('look.stillTemplate: non-empty string');
  if (!Array.isArray(spec.shots) || spec.shots.length === 0) errors.push('shots: non-empty array');
  else {
    spec.shots.forEach((s, i) => checkShot(s, i, spec, errors));
    const ids = spec.shots.map((s) => s?.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) errors.push(`shots: duplicate id(s) ${[...new Set(dupes)].join(', ')}`);
  }
  if (!isObj(spec.endCard) || !isStr(spec.endCard.copy) || !isStr(spec.endCard.url) || !isStr(spec.endCard.cta)) {
    errors.push('endCard: needs copy, url and cta (the link text shown on the button)');
  } else {
    const e = spec.endCard;
    if (!e.cta.includes(e.url)) errors.push('endCard.cta: must contain endCard.url (it is underlined as the link)');
    if (e.durationSec !== undefined && !(e.durationSec > 0)) errors.push('endCard.durationSec: positive number');
    for (const key of ['ctaHint', 'wordmark', 'backgroundClip']) {
      if (!isAbsent(e[key]) && !isStr(e[key])) errors.push(`endCard.${key}: string or null`);
    }
    if (!isAbsent(e.vo)) errors.push('endCard.vo: replaced by endCard.announcer (the announcer voices the end card)');
    if (!isAbsent(e.style) && !Object.values(END_CARD_STYLE).includes(e.style)) errors.push(`endCard.style: one of ${Object.values(END_CARD_STYLE).join(', ')}`);
    checkLine(e.announcer, 'endCard.announcer', errors, { required: false });
  }
  if (spec.captions !== undefined && typeof spec.captions !== 'boolean') errors.push('captions: boolean (burned-in VO captions)');
  if (spec.ruleCaptions !== undefined && typeof spec.ruleCaptions !== 'boolean') errors.push('ruleCaptions: boolean (per-shot rule label)');
  if (spec.marks !== undefined && typeof spec.marks !== 'boolean') errors.push('marks: boolean (✗/✓ verdict marks)');
  if (!isAbsent(spec.tempo) && !Object.hasOwn(CONFIG.tempo.profiles, spec.tempo)) {
    errors.push(`tempo: one of ${Object.keys(CONFIG.tempo.profiles).join(', ')}`);
  }
  if (spec.music !== undefined && spec.music !== null) {
    if (!isObj(spec.music)) errors.push('music: object or null');
    else {
      if (spec.music.file !== null && spec.music.file !== undefined && !isStr(spec.music.file)) errors.push('music.file: path or null');
      for (const k of ['levelDb', 'duckDb']) {
        if (spec.music[k] !== undefined && !(typeof spec.music[k] === 'number' && spec.music[k] <= 0)) errors.push(`music.${k}: number ≤ 0 (dB)`);
      }
    }
  }
  return errors;
}

/** Voice roles a spec actually speaks with. Pure. */
export function usedVoiceRoles(spec) {
  const roles = [VOICE_ROLE.NARRATOR, VOICE_ROLE.CLERK];
  if (!isAbsent(spec.endCard?.announcer)) roles.push(VOICE_ROLE.ANNOUNCER);
  return roles;
}

/** A role that may be dropped when it has no voice id / provided file. */
export const isSkippable = (voice) => voice?.ifMissing === IF_MISSING.SKIP;

/** Extra checks only a live (paid) run needs. */
export function validateForLive(spec) {
  return usedVoiceRoles(spec)
    .filter((role) => !isStr(spec.voices?.[role]?.voiceId) && !isSkippable(spec.voices?.[role]))
    .map(
      (role) =>
        `voices.${role}.voiceId is not set — create the voice in ElevenLabs ` +
        `(design prompt in voices.${role}.designPrompt) and paste its id into the spec`,
    );
}

/**
 * Child spec: `{ "extends": "<file>", "shots": ["<shotId>", …], …overrides }`.
 * A string list in `shots` selects parent shots by id, in that order.
 */
export function mergeExtends(parent, child) {
  const { extends: _ignored, ...overrides } = child;
  const merged = { ...parent, ...overrides };
  if (Array.isArray(child.shots) && child.shots.every((s) => typeof s === 'string')) {
    const byId = new Map(parent.shots.map((s) => [s.id, s]));
    const unknown = child.shots.filter((id) => !byId.has(id));
    if (unknown.length) throw new Error(`extends: unknown shot id(s) ${unknown.join(', ')}`);
    merged.shots = child.shots.map((id) => byId.get(id));
  }
  return merged;
}

/** Fill defaults that the rest of the pipeline relies on. Pure. */
export function normalizeSpec(spec) {
  return {
    ...spec,
    campaign: spec.campaign ?? spec.id,
    endCard: {
      durationSec: CONFIG.endCard.defaultDurationSec,
      ctaHint: null,
      backgroundClip: null,
      style: CONFIG.endCardStyle,
      ...spec.endCard,
      announcer: normalizeLine(spec.endCard.announcer),
    },
    hook: { ...spec.hook, vo: normalizeLine(spec.hook.vo) },
    captions: spec.captions ?? CONFIG.captions.enabledByDefault,
    ruleCaptions: spec.ruleCaptions ?? CONFIG.ruleCaptions.enabledByDefault,
    marks: spec.marks ?? CONFIG.marks.enabledByDefault,
    tempo: spec.tempo ?? CONFIG.tempo.profile,
    music: spec.music ?? null,
    shots: spec.shots.map((s) => ({
      ...s,
      vo: { line: normalizeLine(s.vo.line), quip: normalizeLine(s.vo.quip) },
      // Intro is on unless `intro: false`; files come from the spec or --inputs (stills/<shot>.intro.png).
      intro: s.intro === false ? { enabled: false, still: null, clip: null } : { enabled: true, still: null, clip: null, ...s.intro },
      // Result structure is used when a result still exists (spec path or stills/<shot>.result.png).
      result: s.result === false ? { enabled: false, still: null } : { enabled: true, still: null, ...s.result },
      // Multi-part action clip (ordered parts, joined frame-accurately) or null = clips/<shot>.mp4.
      action: s.action ? s.action.map((p) => ({ in: 0, out: null, ...p })) : null,
      flash: s.flash ?? FLASH_MODE.AUTO,
      beat: s.beat ?? BEAT_MODE.ACTION,
      still: { options: CONFIG.stills.defaultOptions, pick: 0, ...s.still },
    })),
  };
}

export function stillPromptFor(spec, shot) {
  return shot.stillPrompt ?? spec.look.stillTemplate.replace(SUBJECT_TOKEN, shot.subject);
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err instanceof SyntaxError) throw new SpecError(file, [`not valid JSON: ${err.message}`]);
    throw err;
  }
}

/* ── Localization: shared base + per-locale overlay ─────────────────────────── */

const getPath = (obj, dotted) => dotted.split('.').reduce((o, k) => (isObj(o) ? o[k] : undefined), obj);

/**
 * Missing-text check for one locale: every LOCALE_KEYS path (plus
 * SHEET_LOCALE_KEYS for the real-sheet end card) and, for every base shot,
 * LOCALE_SHOT_KEYS under `shots.<id>`; also unknown shot ids. `overlay` is the
 * locale overlay with the kit's locale defaults already applied. Pure.
 */
export function checkLocaleOverlay(base, overlay) {
  const where = `the ${overlay.locale ?? '?'} overlay (or the kit's copy/${overlay.locale ?? '?'}.json / voices/cast.json)`;
  const style = overlay.endCard?.style ?? base.endCard?.style;
  const keys = [...LOCALE_KEYS, ...(style === END_CARD_STYLE.REAL_SHEET ? SHEET_LOCALE_KEYS : [])];
  const errors = keys.filter((k) => isAbsent(getPath(overlay, k))).map((k) => `${k}: missing in ${where}`);
  if (!isAbsent(getPath(base, 'endCard.announcer')) || !isAbsent(getPath(overlay, 'endCard.announcer'))) {
    if (isAbsent(getPath(overlay, 'voices.announcer'))) errors.push('voices.announcer: missing (the end card has an announcer line)');
  }
  const ids = new Set((base.shots ?? []).map((s) => s.id));
  for (const id of ids) {
    for (const k of LOCALE_SHOT_KEYS) if (isAbsent(getPath(overlay.shots?.[id], k))) errors.push(`shots.${id}.${k}: missing in ${where}`);
  }
  for (const id of Object.keys(overlay.shots ?? {})) if (!ids.has(id)) errors.push(`shots.${id}: not a shot in the base`);
  return errors;
}

/** Base + locale overlay → one spec (base shot order; overlay text merged per shot id). Pure. */
export function mergeLocale(base, overlay) {
  const { base: _file, shots: shotText = {}, ...rest } = overlay;
  const merged = deepMerge(base, rest);
  merged.shots = base.shots.map((s) => deepMerge(s, shotText[s.id] ?? {}));
  return merged;
}

/**
 * Raw spec with the kit's locale defaults (cast, copy), `base` (locale overlay)
 * and `extends` (subset/override) resolved. Precedence: kit < base < overlay.
 */
async function resolveRaw(abs, k) {
  let raw = await readJson(abs);
  const defaults = raw.locale ? kitLocaleDefaults(k, raw.locale) : {};
  if (raw.base) {
    const base = await readJson(path.resolve(path.dirname(abs), raw.base));
    const overlay = deepMerge(defaults, raw);
    const errors = checkLocaleOverlay(base, overlay);
    if (errors.length) throw new SpecError(abs, errors);
    raw = mergeLocale(deepMerge(defaults, base), raw);
  } else if (!raw.extends) {
    raw = deepMerge(defaults, raw);
  }
  if (raw.extends) raw = mergeExtends(await resolveRaw(path.resolve(path.dirname(abs), raw.extends), k), raw);
  return raw;
}

export async function loadSpec(file, { live, kit = currentKit() }) {
  const abs = path.resolve(file);
  const raw = await resolveRaw(abs, kit);
  const errors = validateSpec(raw);
  if (live && errors.length === 0) errors.push(...validateForLive(raw));
  if (errors.length) throw new SpecError(abs, errors);
  return { ...normalizeSpec(raw), specFile: abs, specDir: path.dirname(abs) };
}
