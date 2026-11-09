// Burned-in VO captions. Pure: ElevenLabs-style character alignment →
// words → short chunks → an ASS script rendered by libass (`subtitles` filter).

import { CONFIG } from './config.mjs';

const BREAK_AFTER_RE = /[.,:;?!…]$/;

/**
 * @param {{characters: string[], character_start_times_seconds: number[], character_end_times_seconds: number[]}} alignment
 * @returns {{text: string, start: number, end: number}[]}
 */
export function wordsFromAlignment(alignment) {
  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words = [];
  let cur = null;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: '', start: starts[i], end: ends[i] };
    cur.text += ch;
    cur.end = ends[i];
  });
  if (cur) words.push(cur);
  return words;
}

/** Group words into chunks of ≤maxWords / ≤maxChars, breaking after punctuation. */
export function chunkWords(words, { maxWords, maxChars } = CONFIG.captions) {
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) chunks.push({ text: cur.map((w) => w.text).join(' '), start: cur[0].start, end: cur.at(-1).end });
    cur = [];
  };
  for (const w of words) {
    const len = [...cur, w].map((x) => x.text).join(' ').length;
    if (cur.length && (cur.length >= maxWords || len > maxChars)) flush();
    cur.push(w);
    if (BREAK_AFTER_RE.test(w.text)) flush();
  }
  flush();
  return chunks;
}

/** Shift a line's chunks onto the global timeline. */
export function placeChunks(chunks, offsetSec) {
  return chunks.map((c) => ({ ...c, start: c.start + offsetSec, end: c.end + offsetSec }));
}

/** Each chunk stays up until the next starts (or a short tail hold), never overlapping. */
export function settleChunkTimes(chunks, tailHoldSec = CONFIG.captions.tailHoldSec) {
  const sorted = [...chunks].sort((a, b) => a.start - b.start);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    const end = next ? Math.min(Math.max(c.end, next.start - 0.01), next.start) : c.end + tailHoldSec;
    return { ...c, end: Math.max(end, c.start + 0.2) };
  });
}

export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function escapeAss(text) {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
}

/**
 * @param {{text: string, start: number, end: number}[]} chunks — global times
 * @param {{fontName: string, width: number, height: number}} opts
 */
export function buildAss(chunks, { fontName, width = CONFIG.render.width, height = CONFIG.render.height }) {
  const { captionFontSize, captionMarginV, sideMargin } = CONFIG.layout;
  // ASS colours are &HAABBGGRR; alpha 00 = opaque.
  const style = [
    'Caption', fontName, captionFontSize, '&H00FFFFFF', '&H00FFFFFF', '&H00000000', '&H64000000',
    -1, 0, 0, 0, 100, 100, 0, 0, 1, 6, 2, 2, sideMargin, sideMargin, captionMarginV, 1,
  ].join(',');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: ${style}`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...chunks.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Caption,,0,0,0,,${escapeAss(c.text)}`),
    '',
  ].join('\n');
}

/** Approximate alignment for offline VO: characters spread over the duration, pauses on punctuation. */
export function approximateAlignment(text, durationSec, { leadSec = 0.05, tailSec = 0.1 } = {}) {
  const chars = [...text];
  const weight = (ch) => (/\s/.test(ch) ? 0.6 : BREAK_AFTER_RE.test(ch) ? 3 : 1);
  const total = chars.reduce((s, ch) => s + weight(ch), 0);
  const span = Math.max(0.1, durationSec - leadSec - tailSec);
  let t = leadSec;
  const starts = [];
  const ends = [];
  for (const ch of chars) {
    const d = (weight(ch) / total) * span;
    starts.push(t);
    t += d;
    ends.push(t);
  }
  // Flagged: phrase timing derived from it (e.g. the end-card stamp) must not be trusted.
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends, approximate: true };
}
