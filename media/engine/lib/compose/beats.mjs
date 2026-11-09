// Beat analysis of a music bed: onset envelope → tempo (autocorrelation with a
// prior around 120 BPM) → beat grid phase → downbeats (every 4) and the drop (the
// biggest rise in loudness). PURE on PCM samples; `analyseBeats` decodes with ffmpeg.
// A storyboard can override everything (`music: { beats: [...] }` or `{ bpm, offset }`).

import { run, ffmpegBin } from '../media/ffmpeg.mjs';

export const BEATS = Object.freeze({ sampleRate: 22050, hop: 256, minBpm: 70, maxBpm: 180, priorBpm: 120, priorWidth: 0.9, dropMinSec: 3, smoothSec: 1 });

/** Onset strength per hop: positive change of log energy of the differenced signal. Pure. */
export function onsetEnvelope(samples, { hop } = BEATS) {
  const n = Math.floor(samples.length / hop);
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * hop + 1; j < (i + 1) * hop; j++) {
      const d = samples[j] - samples[j - 1];
      e += d * d;
    }
    energy[i] = Math.log(1e-9 + e / hop);
  }
  const env = new Float64Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, energy[i] - energy[i - 1]);
  return env;
}

/** Tempo period (in hops, fractional) by autocorrelation with a log-normal BPM prior. Pure. */
export function tempoPeriod(env, sr, { hop, minBpm, maxBpm, priorBpm, priorWidth } = BEATS) {
  const fps = sr / hop;
  const lo = Math.floor((60 / maxBpm) * fps);
  const hi = Math.ceil((60 / minBpm) * fps);
  const ac = (lag) => {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    return s / (env.length - lag);
  };
  let best = lo;
  let bestScore = -Infinity;
  const scores = [];
  for (let lag = lo; lag <= hi; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / priorBpm) / priorWidth) ** 2);
    const score = ac(lag) * prior;
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement around the peak.
  const a = scores[best - 1] ?? scores[best];
  const b = scores[best];
  const c = scores[best + 1] ?? scores[best];
  const denom = a - 2 * b + c;
  return denom < 0 ? best + (0.5 * (a - c)) / denom : best;
}

/** Beats, downbeats, bpm and drop from mono PCM. Pure. */
export function detectBeats(samples, sr = BEATS.sampleRate, opts = BEATS) {
  const env = onsetEnvelope(samples, opts);
  const fps = sr / opts.hop;
  const durationSec = samples.length / sr;
  if (env.length < fps * 2) return { bpm: null, beats: [], downbeats: [], drop: null, durationSec };
  const period = tempoPeriod(env, sr, opts);
  // Phase: the offset whose grid collects the most onset strength (±1 hop tolerance).
  const strengthAt = (pos) => {
    const i = Math.round(pos);
    return Math.max(env[i - 1] ?? 0, env[i] ?? 0, env[i + 1] ?? 0);
  };
  let bestPhase = 0;
  let bestSum = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let p = ph; p < env.length; p += period) s += strengthAt(p);
    if (s > bestSum) {
      bestSum = s;
      bestPhase = ph;
    }
  }
  // Snap each grid point to the local onset peak (±2 hops) for sample-accurate beats.
  const beats = [];
  for (let p = bestPhase; p < env.length; p += period) {
    let k = Math.round(p);
    for (let d = -2; d <= 2; d++) if ((env[Math.round(p) + d] ?? -1) > (env[k] ?? -1)) k = Math.round(p) + d;
    beats.push(Math.round((k / fps) * 1000) / 1000);
  }
  // Downbeats: the 4-phase with the strongest beats.
  let bestBar = 0;
  let barScore = -1;
  for (let o = 0; o < 4; o++) {
    let s = 0;
    for (let i = o; i < beats.length; i += 4) s += strengthAt(beats[i] * fps);
    if (s > barScore) {
      barScore = s;
      bestBar = o;
    }
  }
  const downbeats = beats.filter((_, i) => i % 4 === bestBar);
  // Drop: biggest rise of 1 s smoothed loudness after dropMinSec, snapped to a beat.
  const win = Math.round(opts.smoothSec * fps);
  const loud = [];
  for (let i = 0; i + win < env.length; i += Math.max(1, Math.round(win / 4))) {
    let e = 0;
    for (let j = i * opts.hop; j < (i + win) * opts.hop && j < samples.length; j++) e += samples[j] * samples[j];
    loud.push({ t: i / fps, e: Math.log(1e-9 + e) });
  }
  let drop = null;
  let rise = 0;
  for (let i = 1; i < loud.length; i++) {
    const d = loud[i].e - loud[i - 1].e;
    if (loud[i].t >= opts.dropMinSec && d > rise) {
      rise = d;
      drop = loud[i].t + opts.smoothSec / 2;
    }
  }
  if (drop !== null && beats.length) drop = beats.reduce((a, b) => (Math.abs(b - drop) < Math.abs(a - drop) ? b : a));
  return { bpm: Math.round(((60 * fps) / period) * 10) / 10, beats, downbeats, drop, durationSec };
}

/** Manual grid: `{ beats: [...] }` or `{ bpm, offset, duration }`. Pure. */
export function manualBeats({ beats, bpm, offset = 0, durationSec = 120, drop = null }) {
  const list = beats ?? Array.from({ length: Math.floor(((durationSec - offset) * bpm) / 60) + 1 }, (_, i) => Math.round((offset + (i * 60) / bpm) * 1000) / 1000);
  return { bpm: bpm ?? null, beats: list, downbeats: list.filter((_, i) => i % 4 === 0), drop, durationSec };
}

/** Decode a file to mono float PCM and detect beats. */
export async function analyseBeats(file) {
  const buf = await run(ffmpegBin(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(BEATS.sampleRate), '-f', 'f32le', '-']);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return detectBeats(samples, BEATS.sampleRate);
}
