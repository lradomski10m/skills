// ffmpeg rendering. The argv/filtergraph builders are pure (unit-tested);
// `renderVideo` runs them: per-segment encode → concat → one final pass for
// overlays, captions and the audio mix.

import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from './config.mjs';
import { BUS, FILE, INTRO_KIND, SFX } from './constants.mjs';
import { durationSec, ffmpeg, probe } from './media/ffmpeg.mjs';
import { ANCHOR, GRAPHIC } from './timeline.mjs';

const R = CONFIG.render;
const FONTS_SUBDIR = 'fonts';
/** Freeze padding is over-requested then trimmed, so frame rounding never leaves a segment short. */
const PAD_SLACK_SEC = 0.5;
/** Near-lossless intermediate for the assembled action clip (it is re-encoded once more at render). */
const ACTION_CRF = 12;

const fmt = (x) => Number(x).toFixed(3);

const normalizeVideo = () =>
  `fps=${R.fps},scale=${R.width}:${R.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${R.width}:${R.height},setsar=1,format=yuv420p`;

const videoEncodeArgs = () => ['-c:v', 'libx264', '-crf', String(R.crf), '-preset', R.preset, '-pix_fmt', 'yuv420p', '-r', String(R.fps)];

/**
 * A still as a short video with a subtle Ken Burns push-in centred on the face.
 * It is first cropped to the clip's aspect (as the i2v model crops its source
 * still) and cover-scaled like the clip, so framing matches across a cut.
 * Config offsets/scale correct a still that is framed differently.
 */
export function stillKenBurnsFilter(inputIdx, durationSec, clipAspect, pushIn, outLabel) {
  const I = CONFIG.intro;
  const frames = Math.max(1, Math.round(durationSec * R.fps));
  const sw = R.width * I.supersample;
  const sh = R.height * I.supersample;
  const a = clipAspect.toFixed(6);
  return (
    `[${inputIdx}:v]crop=w='min(iw,ih*${a})/${I.scale}':h='min(ih,iw/${a})/${I.scale}':` +
    `x='(iw-ow)/2+${I.offsetX}*iw':y='(ih-oh)/2+${I.offsetY}*ih',` +
    `scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${sw}:${sh},` +
    `zoompan=z='1+${pushIn}*on/${Math.max(1, frames - 1)}':x='(iw-iw/zoom)*${I.focusX}':y='(ih-ih/zoom)*${I.focusY}':` +
    `d=${frames}:s=${R.width}x${R.height}:fps=${R.fps},setsar=1,format=yuv420p[${outLabel}]`
  );
}

/** Habitat intro as input `inputIdx` → [i]: a Ken Burns still, or the TAIL of an intro clip. */
export function introFilter(intro, introSec, clipAspect, introClipDur = introSec, inputIdx = 1) {
  if (intro.kind === INTRO_KIND.CLIP) {
    // The tail ends on the intro's last frame (the one aligned with the clip).
    // If the planner held the intro longer than the clip, freeze its first used frame.
    const start = Math.max(0, introClipDur - introSec);
    const hold = Math.max(0, introSec - introClipDur);
    return (
      `[${inputIdx}:v]trim=start=${fmt(start)},setpts=PTS-STARTPTS,${normalizeVideo()},` +
      `tpad=start_duration=${fmt(hold)}:start_mode=clone:stop_duration=${fmt(PAD_SLACK_SEC)}:stop_mode=clone,` +
      `trim=duration=${fmt(introSec)},setpts=PTS-STARTPTS[i]`
    );
  }
  return stillKenBurnsFilter(inputIdx, introSec, clipAspect, CONFIG.intro.pushIn, 'i');
}

/**
 * Synthetic camera flash at output-local `atSec`: one white full-frame box per
 * frame with decaying alpha (config), drawn on the normalised clip. Pure.
 */
export function syntheticFlashFilter(atSec, alphas = CONFIG.result.syntheticFlash.alphas) {
  const frame = 1 / R.fps;
  // Snap to the nearest frame time, then centre each window on a frame (±half a
  // frame): a flash time between frames, or rounding, can never skip the brightest frame.
  const first = Math.round(atSec * R.fps) / R.fps;
  return alphas
    .map((alpha, k) => {
      const centre = first + k * frame;
      return `drawbox=x=0:y=0:w=iw:h=ih:color=white@${alpha}:t=fill:enable='between(t,${fmt(centre - frame / 2)},${fmt(centre + frame / 2 - 0.001)})'`;
    })
    .join(',');
}

/**
 * Multi-part action clip → one file, frame-accurate: each part is cut by frame
 * index ([startFrame, endFrame) — the end frame is excluded, so a next part
 * that starts on that exact frame joins without a duplicate). Pure.
 * @param {{file: string, startFrame: number, endFrame: number|null}[]} parts
 */
export function actionConcatArgs(parts, fps, outFile) {
  const chains = parts.map(
    (p, k) =>
      `[${k}:v]trim=start_frame=${p.startFrame}${p.endFrame === null ? '' : `:end_frame=${p.endFrame}`},` +
      `setpts=PTS-STARTPTS,fps=${fps},setsar=1,format=yuv420p[p${k}]`,
  );
  const labels = parts.map((_, k) => `[p${k}]`).join('');
  return [
    ...parts.flatMap((p) => ['-i', p.file]),
    '-filter_complex', `${chains.join(';')};${labels}concat=n=${parts.length}:v=1:a=0[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', String(ACTION_CRF), '-preset', R.preset, '-pix_fmt', 'yuv420p', '-r', String(fps), outFile,
  ];
}

/**
 * Time-remap from source pieces [{inSec, outSec, speed}] → [j]: each piece is
 * trimmed and retimed (speed > 1 = faster), then concatenated. Pure.
 */
export function piecesChain(pieces) {
  const n = pieces.length;
  const split = n > 1 ? `[0:v]split=${n}${pieces.map((_, k) => `[s${k}]`).join('')};` : '';
  const src = (k) => (n > 1 ? `[s${k}]` : '[0:v]');
  const trims = pieces
    .map((pc, k) => `${src(k)}trim=start=${fmt(pc.inSec)}:end=${fmt(pc.outSec)},setpts=(PTS-STARTPTS)/${fmt(pc.speed)}[q${k}]`)
    .join(';');
  return `${split}${trims};${pieces.map((_, k) => `[q${k}]`).join('')}concat=n=${n}:v=1:a=0[j]`;
}

/** Input order for a shot segment: clip, then intro, then result still (when used). Pure. */
export function shotInputs(plan, { intro = null, result = null } = {}) {
  const useIntro = Boolean(intro) && plan.introSec > 0;
  const useResult = Boolean(result) && plan.resultSec > 0;
  return { useIntro, useResult, introIdx: 1, resultIdx: useIntro ? 2 : 1 };
}

/**
 * Filtergraph for one shot: [intro →] clip (trim, slowed run-up, freezes) [→
 * result still], scaled to 1080×1920, joined with hard cuts.
 */
export function shotSegmentFilter(plan, { intro = null, result = null, clipAspect = R.width / R.height, introClipDur } = {}) {
  const { useIntro, useResult, introIdx, resultIdx } = shotInputs(plan, { intro, result });
  const { inSec, beatSec, outSec, pieces } = plan.source;
  const head = pieces
    ? piecesChain(pieces)
    : beatSec === null
      ? `[0:v]trim=start=${fmt(inSec)}:end=${fmt(outSec)},setpts=PTS-STARTPTS[j]`
      : [
          '[0:v]split=2[a][b]',
          `[a]trim=start=${fmt(inSec)}:end=${fmt(beatSec)},setpts=(PTS-STARTPTS)/${fmt(plan.speed)}[pre]`,
          `[b]trim=start=${fmt(beatSec)}:end=${fmt(outSec)},setpts=PTS-STARTPTS[post]`,
          '[pre][post]concat=n=2:v=1:a=0[j]',
        ].join(';');
  const pad =
    `tpad=start_duration=${fmt(plan.freezeHeadSec)}:start_mode=clone:` +
    `stop_duration=${fmt(plan.freezeTailSec + PAD_SLACK_SEC)}:stop_mode=clone`;
  const finish = `trim=duration=${fmt(plan.durationSec)},setpts=PTS-STARTPTS[v]`;
  // Synthetic flash is drawn on the clip part, in its own (post-intro) time.
  const flash = plan.syntheticFlashAt != null ? `,${syntheticFlashFilter(plan.syntheticFlashAt - plan.introSec)}` : '';
  if (!useIntro && !useResult) return `${head};[j]${normalizeVideo()},${pad}${flash},${finish}`;
  // With a result still the clip is cut exactly at its end (no tail padding).
  const clipLen = plan.durationSec - plan.introSec - (useResult ? plan.resultSec : 0);
  const parts = [head, `[j]${normalizeVideo()},${pad}${flash},trim=duration=${fmt(clipLen)},setpts=PTS-STARTPTS[c]`];
  const order = [];
  if (useIntro) {
    parts.push(introFilter(intro, plan.introSec, clipAspect, introClipDur, introIdx));
    order.push('[i]');
  }
  order.push('[c]');
  if (useResult) {
    parts.push(stillKenBurnsFilter(resultIdx, plan.resultSec, clipAspect, CONFIG.result.pushIn, 'r'));
    order.push('[r]');
  }
  parts.push(`${order.join('')}concat=n=${order.length}:v=1:a=0,${finish}`);
  return parts.join(';');
}

export function shotSegmentArgs(plan, clipFile, outFile, { intro = null, result = null, clipAspect, introClipDur } = {}) {
  const { useIntro, useResult } = shotInputs(plan, { intro, result });
  return [
    '-i', clipFile,
    ...(useIntro ? ['-i', intro.file] : []),
    ...(useResult ? ['-i', result.file] : []),
    '-filter_complex', shotSegmentFilter(plan, { intro, result, clipAspect, introClipDur }),
    '-map', '[v]', '-an', ...videoEncodeArgs(), outFile,
  ];
}

export function stillSegmentArgs(pngFile, durationSec, outFile) {
  return [
    '-loop', '1', '-t', fmt(durationSec + PAD_SLACK_SEC), '-i', pngFile,
    '-filter_complex', `[0:v]${normalizeVideo()},trim=duration=${fmt(durationSec)},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-an', ...videoEncodeArgs(), outFile,
  ];
}

/** End-card background: the clip looped to the card's length (dimming is the overlay's scrim). */
export function loopedClipSegmentArgs(clipFile, durationSec, outFile) {
  return [
    '-stream_loop', '-1', '-i', clipFile,
    '-filter_complex', `[0:v]${normalizeVideo()},trim=duration=${fmt(durationSec)},setpts=PTS-STARTPTS[v]`,
    '-map', '[v]', '-an', ...videoEncodeArgs(), outFile,
  ];
}

/** Segment-encode argv for any timeline segment. */
export function segmentArgs(seg, graphicFile, outFile, { clipAspect, introClipDur } = {}) {
  if (seg.kind === 'shot') return shotSegmentArgs(seg.plan, seg.clipFile, outFile, { intro: seg.intro, result: seg.result, clipAspect, introClipDur });
  if (seg.backgroundClip) return loopedClipSegmentArgs(seg.backgroundClip, seg.durationSec, outFile);
  return stillSegmentArgs(graphicFile(GRAPHIC.ENDCARD_BASE), seg.durationSec, outFile);
}

export const concatList = (files) => `${files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')}\n`;

/**
 * Music duck as a per-frame gain expression: 1 outside VO, duckDb inside each
 * window, linear ramps attackSec before / releaseSec after it. Pure.
 */
export function musicDuckExpr(windows, { duckDb, attackSec, releaseSec }) {
  if (!windows.length) return '1';
  const depth = 1 - 10 ** (duckDb / 20);
  const inside = windows.map(
    ({ fromSec, toSec }) => `min(clip((t-${fmt(fromSec - attackSec)})/${fmt(attackSec)},0,1),clip((${fmt(toSec + releaseSec)}-t)/${fmt(releaseSec)},0,1))`,
  );
  const any = inside.reduce((acc, e) => `max(${acc},${e})`);
  return `1-${fmt(depth)}*${any}`;
}

/**
 * Final pass: inputs are [0] base video, then one looped PNG per overlay, then
 * one input per audio event, then the optional looped music bed.
 * @param {{overlays: object[], audio: object[], totalSec: number}} tl
 * @param {{graphicFile: (key: string) => string, captionsFile: string|null, music?: {file: string, gainDb: number, duckDb: number, windows: {fromSec: number, toSec: number}[], attackSec: number, releaseSec: number, fadeOutSec: number}|null}} files
 */
export function finalPassArgs(tl, { graphicFile, captionsFile, music = null }, outFile) {
  const inputs = [];
  const graph = [];
  const total = fmt(tl.totalSec);

  // Video: overlays chained on the base, then captions (libass).
  let v = '0:v';
  tl.overlays.forEach((o, k) => {
    const idx = k + 1;
    inputs.push('-loop', '1', '-t', total, '-i', graphicFile(o.graphic));
    const x = o.anchor === ANCHOR.FULL ? '0' : o.x !== undefined ? `${o.x}` : `(main_w-overlay_w)/2${o.dx ? `+${o.dx}` : ''}`;
    let y = { [ANCHOR.FULL]: '0', [ANCHOR.TOP]: `${o.y}`, [ANCHOR.CENTER]: `${o.y}-overlay_h/2`, [ANCHOR.BOTTOM]: `${o.y}-overlay_h` }[o.anchor];
    if (y === undefined) throw new Error(`overlay ${o.graphic}: unknown anchor ${o.anchor}`);
    // Entrance animation: alpha fade on the input, ease-out (quadratic) slide on the overlay position.
    let src = `${idx}:v`;
    if (o.fadeIn) {
      graph.push(`[${idx}:v]format=rgba,fade=t=in:st=${fmt(o.fadeIn.startSec)}:d=${fmt(o.fadeIn.durSec)}:alpha=1[fi${k}]`);
      src = `fi${k}`;
    }
    if (o.slide) {
      const { startSec, durSec, dyPx } = o.slide;
      y = `'${y}+${dyPx}*pow(max(0,1-(t-${fmt(startSec)})/${fmt(durSec)}),2)'`;
    }
    graph.push(`[${v}][${src}]overlay=x=${x}:y=${y}:enable='between(t,${fmt(o.fromSec)},${fmt(o.toSec)})'[ov${k}]`);
    v = `ov${k}`;
  });
  const subtitles = captionsFile ? `subtitles=filename=${captionsFile}:fontsdir=${FONTS_SUBDIR},` : '';
  graph.push(`[${v}]${subtitles}format=yuv420p[vout]`);

  // Audio: each event delayed onto the timeline, summed per bus.
  const audioBase = 1 + tl.overlays.length;
  const busLabels = { [BUS.VOICE]: [], [BUS.SFX]: [] };
  tl.audio.forEach((a, k) => {
    inputs.push('-i', a.file);
    const ms = Math.round(a.atSec * 1000);
    graph.push(
      `[${audioBase + k}:a]aresample=${R.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `volume=${a.gain},adelay=${ms}:all=1[a${k}]`,
    );
    busLabels[a.bus].push(`[a${k}]`);
  });
  const silence = (label) => graph.push(`anullsrc=r=${R.audioRate}:cl=stereo,atrim=duration=${total}[${label}]`);
  for (const bus of Object.values(BUS)) {
    const labels = busLabels[bus];
    if (labels.length === 0) silence(bus);
    else graph.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[${bus}]`);
  }

  const mixInputs = [`[${BUS.VOICE}]`, `[${BUS.SFX}]`];
  if (music) {
    // Looped bed: level against the voice, duck under every VO window, fade out with the video.
    inputs.push('-stream_loop', '-1', '-i', music.file);
    const musicIdx = audioBase + tl.audio.length;
    const fadeSt = fmt(Math.max(0, tl.totalSec - music.fadeOutSec));
    graph.push(
      `[${musicIdx}:a]aresample=${R.audioRate},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${total},` +
        `volume=${fmt(music.gainDb)}dB,volume='${musicDuckExpr(music.windows, music)}':eval=frame,` +
        `afade=t=out:st=${fadeSt}:d=${fmt(music.fadeOutSec)}[music]`,
    );
    mixInputs.push('[music]');
  }
  const L = R.loudness;
  graph.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0:duration=longest,apad,atrim=duration=${total},` +
      `loudnorm=I=${L.I}:TP=${L.TP}:LRA=${L.LRA},aresample=${R.audioRate}[aout]`,
  );

  return [
    '-i', FILE.BASE_VIDEO,
    ...inputs,
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    ...videoEncodeArgs(),
    '-c:a', 'aac', '-b:a', R.audioBitrate, '-ar', String(R.audioRate),
    '-movflags', '+faststart', '-t', total, outFile,
  ];
}

async function videoAspect(file) {
  const v = (await probe(file)).streams.find((s) => s.codec_type === 'video');
  return v.width / v.height;
}

/** Synthesised stamp SFX (no external assets needed). */
export function sfxArgs(kind, outFile) {
  const rate = R.audioRate;
  if (kind === SFX.THUD) {
    return [
      '-f', 'lavfi', '-i', `sine=frequency=58:sample_rate=${rate}:duration=0.45`,
      '-f', 'lavfi', '-i', `anoisesrc=color=brown:sample_rate=${rate}:duration=0.15:amplitude=0.9`,
      '-filter_complex',
      '[0:a]afade=t=out:st=0.03:d=0.42:curve=exp,volume=1.6[lo];[1:a]lowpass=f=700,afade=t=out:st=0:d=0.15:curve=exp[hit];' +
        '[lo][hit]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]',
      '-map', '[a]', outFile,
    ];
  }
  if (kind === SFX.DING) {
    return [
      '-f', 'lavfi', '-i', `sine=frequency=1568:sample_rate=${rate}:duration=0.9`,
      '-f', 'lavfi', '-i', `sine=frequency=2093:sample_rate=${rate}:duration=0.9`,
      '-filter_complex', '[0:a][1:a]amix=inputs=2:normalize=0,volume=0.35,afade=t=out:st=0.02:d=0.88:curve=exp[a]',
      '-map', '[a]', outFile,
    ];
  }
  if (kind === SFX.SHUTTER) {
    // Two short high clicks ~70 ms apart: a mechanical shutter (open, close).
    return [
      '-f', 'lavfi', '-i', `anoisesrc=color=white:sample_rate=${rate}:duration=0.035:amplitude=0.9`,
      '-f', 'lavfi', '-i', `anoisesrc=color=white:sample_rate=${rate}:duration=0.03:amplitude=0.7`,
      '-filter_complex',
      '[0:a]highpass=f=1800,afade=t=out:st=0:d=0.035:curve=exp[o];[1:a]highpass=f=2400,afade=t=out:st=0:d=0.03:curve=exp,adelay=70:all=1[c];' +
        '[o][c]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]',
      '-map', '[a]', outFile,
    ];
  }
  if (kind === SFX.WHOOSH) {
    // Band-passed pink noise swelling into the cut and dying away fast.
    return [
      '-f', 'lavfi', '-i', `anoisesrc=color=pink:sample_rate=${rate}:duration=0.42:amplitude=0.8`,
      '-filter_complex',
      '[0:a]bandpass=f=1400:width_type=o:w=2,afade=t=in:st=0:d=0.26:curve=qsin,afade=t=out:st=0.26:d=0.16:curve=exp,alimiter=limit=0.9[a]',
      '-map', '[a]', outFile,
    ];
  }
  throw new Error(`unknown sfx ${kind}`);
}

/** Run the three render passes inside `runDir` (relative paths keep filter escaping trivial). */
export async function renderVideo({ tl, runDir, graphicFile, captionsAss, font, music, outFile, log }) {
  const segDir = path.join(runDir, 'segments');
  await fs.mkdir(segDir, { recursive: true });
  // Burned-in captions are optional (spec `captions`); libass needs the font next to the ASS file.
  if (captionsAss) {
    await fs.mkdir(path.join(runDir, FONTS_SUBDIR), { recursive: true });
    const fontCopy = path.join(runDir, FONTS_SUBDIR, path.basename(font.file));
    await fs.rm(fontCopy, { force: true });
    await fs.copyFile(font.file, fontCopy);
    await fs.writeFile(path.join(runDir, FILE.CAPTIONS), captionsAss);
  }

  const segFiles = [];
  for (const [i, seg] of tl.segments.entries()) {
    const out = path.join(segDir, `${String(i).padStart(2, '0')}-${seg.kind === 'shot' ? seg.shotId : 'endcard'}.mp4`);
    log(`render segment ${path.basename(out)}`);
    const clipAspect = seg.intro || seg.result ? await videoAspect(seg.clipFile) : undefined;
    const introClipDur = seg.intro?.kind === INTRO_KIND.CLIP ? await durationSec(seg.intro.file) : undefined;
    await ffmpeg(segmentArgs(seg, graphicFile, out, { clipAspect, introClipDur }));
    segFiles.push(out);
  }
  await fs.writeFile(path.join(runDir, FILE.CONCAT_LIST), concatList(segFiles));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', FILE.CONCAT_LIST, '-c', 'copy', FILE.BASE_VIDEO], { cwd: runDir });
  log(`render final pass (overlays${captionsAss ? ', captions' : ''}, audio mix)`);
  await ffmpeg(finalPassArgs(tl, { graphicFile, captionsFile: captionsAss ? FILE.CAPTIONS : null, music }, outFile), { cwd: runDir });
}
