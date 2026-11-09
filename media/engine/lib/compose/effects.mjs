// Effect and transition catalogue → ffmpeg filter chains on the full-frame base video
// (global time windows). PURE: each builder returns filtergraph text that maps an
// input label to an output label. Transitions are timing-neutral effects centred on a
// cut (`transition:<name>`, params.atSec), so segments never overlap.

import { CONFIG } from '../config.mjs';

const R = CONFIG.render;
const fmt = (x) => Number(x).toFixed(3);
const between = (a, b) => `between(t,${fmt(a)},${fmt(b)})`;

/** Windowed chain via split → process → overlay (for filters without timeline support). */
const windowed = (inL, outL, k, chain, from, to) =>
  `[${inL}]split[m${k}][e${k}];[e${k}]${chain}[x${k}];[m${k}][x${k}]overlay=enable='${between(from, to)}'[${outL}]`;

/** White flash: one full-frame box per frame with decaying alpha, from `at`. */
export function flashChain(at, alphas = CONFIG.result.syntheticFlash.alphas) {
  const frame = 1 / R.fps;
  const first = Math.round(at * R.fps) / R.fps;
  return alphas
    .map((alpha, k) => {
      const c = first + k * frame;
      return `drawbox=x=0:y=0:w=iw:h=ih:color=white@${alpha}:t=fill:enable='between(t,${fmt(c - frame / 2)},${fmt(c + frame / 2 - 0.001)})'`;
    })
    .join(',');
}

/**
 * Builders: (effect, inLabel, outLabel, k) → filtergraph text. `k` keeps labels unique.
 * Params documented in the spec (§8); defaults from config.effects.
 */
export const EFFECTS = Object.freeze({
  flash: (e, i, o) => `[${i}]${flashChain(e.fromSec, e.params.alphas)}[${o}]`,
  'grey-wash': (e, i, o) => {
    const p = { ...CONFIG.effects.greyWash, ...e.params };
    const a = e.fromSec;
    const ramp = Math.max(0.01, p.rampSec);
    return (
      `[${i}]hue=s='if(${between(a, e.toSec)},max(${p.saturation},1-(t-${fmt(a)})/${fmt(ramp)}*(1-${p.saturation})),1)',` +
      `eq=brightness='if(${between(a, e.toSec)},-${p.darken}*min(1,(t-${fmt(a)})/${fmt(ramp)}),0)':eval=frame[${o}]`
    );
  },
  shake: (e, i, o, k) => {
    const p = { ...CONFIG.effects.shake, ...e.params };
    const A = Math.round(p.amp);
    return windowed(i, o, k, `crop=w=iw-${2 * A}:h=ih-${2 * A}:x='${A}+${A}*sin(2*PI*${p.freq}*t)':y='${A}+${A}*cos(2*PI*${p.freq * 1.3}*t)',scale=${R.width}:${R.height}`, e.fromSec, e.toSec);
  },
  'zoom-punch': (e, i, o, k) => {
    const p = { ...CONFIG.effects.zoomPunch, ...e.params };
    const a = e.fromSec;
    // Envelope: up over attack, back over release.
    const env = `if(lt(t,${fmt(a + p.attackSec)}),(t-${fmt(a)})/${fmt(p.attackSec)},max(0,1-(t-${fmt(a + p.attackSec)})/${fmt(p.releaseSec)}))`;
    const z = `(1+${p.amount}*${env})`;
    return windowed(i, o, k, `scale=w='trunc(iw*${z}/2)*2':h='trunc(ih*${z}/2)*2':eval=frame,crop=${R.width}:${R.height}`, a, e.toSec);
  },
  grade: (e, i, o) => {
    const p = e.params;
    const en = `enable='${between(e.fromSec, e.toSec)}'`;
    const parts = [];
    if (p.lut) parts.push(`lut3d=file='${p.lut.replace(/'/g, "\\'")}':${en}`);
    const eq = ['contrast', 'saturation', 'gamma', 'brightness'].filter((x) => p[x] !== undefined).map((x) => `${x}=${p[x]}`);
    if (eq.length) parts.push(`eq=${eq.join(':')}:${en}`);
    if (p.tint) parts.push(`colorbalance=rm=${p.tint[0] ?? 0}:gm=${p.tint[1] ?? 0}:bm=${p.tint[2] ?? 0}:${en}`);
    return parts.length ? `[${i}]${parts.join(',')}[${o}]` : `[${i}]null[${o}]`;
  },
  cctv: (e, i, o, k) => {
    const p = { ...CONFIG.effects.cctv, ...e.params };
    return windowed(i, o, k, `hue=s=${p.saturation},noise=alls=${p.noise}:allf=t,vignette=${p.vignette},fps=${p.fps},fps=${R.fps}`, e.fromSec, e.toSec);
  },
  vhs: (e, i, o, k) => {
    const p = { ...CONFIG.effects.vhs, ...e.params };
    return windowed(i, o, k, `rgbashift=rh=${p.shift}:bh=-${p.shift},noise=alls=${p.noise}:allf=t,eq=saturation=${p.saturation},gblur=sigma=${p.blur}`, e.fromSec, e.toSec);
  },
  blur: (e, i, o) => `[${i}]gblur=sigma=${e.params.sigma ?? 12}:enable='${between(e.fromSec, e.toSec)}'[${o}]`,
  vignette: (e, i, o) => `[${i}]vignette=${e.params.angle ?? 'PI/4'}:enable='${between(e.fromSec, e.toSec)}'[${o}]`,
  'transition:flash-cut': (e, i, o) => `[${i}]${flashChain(e.params.atSec, e.params.alphas)}[${o}]`,
  'transition:dip': (e, i, o) => {
    const c = e.params.atSec;
    const h = Math.max(0.02, (e.toSec - e.fromSec) / 2);
    return `[${i}]eq=brightness='-min(1,max(0,1-abs(t-${fmt(c)})/${fmt(h)}))':eval=frame[${o}]`;
  },
  'transition:dip-white': (e, i, o) => {
    const c = e.params.atSec;
    const h = Math.max(0.02, (e.toSec - e.fromSec) / 2);
    return `[${i}]eq=brightness='min(1,max(0,1-abs(t-${fmt(c)})/${fmt(h)}))':eval=frame[${o}]`;
  },
  'transition:whip': (e, i, o) => `[${i}]avgblur=sizeX=${e.params.blur ?? 48}:sizeY=1:enable='${between(e.fromSec, e.toSec)}'[${o}]`,
});

/** Chain every effect window over `[base]` → `[fx]`. Unknown names throw (validated earlier). Pure. */
export function effectsGraph(effects, base = 'base', out = 'fx', custom = {}) {
  if (!effects.length) return `[${base}]null[${out}]`;
  const parts = [];
  let cur = base;
  effects.forEach((e, k) => {
    const b = custom[e.name] ?? EFFECTS[e.name];
    if (!b) throw new Error(`unknown effect "${e.name}" (have: ${Object.keys(EFFECTS).join(', ')})`);
    const next = k === effects.length - 1 ? out : `f${k}`;
    parts.push(b(e, cur, next, k));
    cur = next;
  });
  return parts.join(';');
}

/**
 * Picture-in-picture into a quad (e.g. a phone screen): the clip is scaled to the
 * frame, perspective-warped so its corners land on `quad` (TL, TR, BR, BL in canvas
 * px), and masked by the quad polygon. Pure; `maskIdx` is a gray mask input.
 */
export function pipChain(o, clipIdx, maskIdx, outL) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = o.quad;
  return (
    `[${clipIdx}:v]trim=start=${fmt(o.inSec ?? 0)},setpts=(PTS-STARTPTS)/${fmt(o.speed ?? 1)}+${fmt(o.fromSec)}/TB,` +
    `scale=${R.width}:${R.height},format=rgba,` +
    `perspective=x0=${x0}:y0=${y0}:x1=${x1}:y1=${y1}:x2=${x3}:y2=${y3}:x3=${x2}:y3=${y2}:sense=destination[pw${outL}];` +
    `[${maskIdx}:v]format=gray[pm${outL}];[pw${outL}][pm${outL}]alphamerge[${outL}]`
  );
}
