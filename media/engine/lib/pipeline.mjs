// Orchestration: storyboard → assets (media-work files, or free offline stand-ins)
// → analysis → composition → graphics → render → review README. The engine never
// calls a paid API: generation happens through MCP tools in the skill.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { activeTempo, analyzeFrames } from './alignment.mjs';
import { CacheStore } from './cache.mjs';
import { approximateAlignment, buildAss } from './captions.mjs';
import { CONFIG } from './config.mjs';
import { BUILTIN_GRAPHIC, FILE, FONTS_DIR, INPUTS, KIT, OFFLINE, PROVIDER, SFX } from './constants.mjs';
import { UserError } from './errors.mjs';
import { fileHash } from './hash.mjs';
import { deepMerge } from './kit.mjs';
import { actionConcatArgs, renderVideo, sfxArgs } from './render.mjs';
import { createOfflineProviders, offlineClipFilter, offlineActionAt } from './providers/offline.mjs';
import { assertFfmpeg, decodeGrayFrames, durationSec as mediaDuration, ffmpeg, loudnessLufs, probeFps } from './media/ffmpeg.mjs';
import { inputPath } from './inputs.mjs';
import { runNameFor } from './runs.mjs';
import { writeCampaignReadme } from './readme.mjs';
import { checkTimeline, duckWindows, meanLufs, musicGainDb } from './timeline.mjs';
import { analyseBeats, manualBeats } from './compose/beats.mjs';
import { compose } from './compose/compose.mjs';
import { drawTimeline } from './compose/draw.mjs';
import { loadPresets } from './compose/presets.mjs';
import { makeText, voiceSpeed } from './compose/text.mjs';
import { BUS } from './constants.mjs';

/** Version of analysis.json's shape (cache key; free to recompute). */
const ANALYSIS_FORMAT = 3;
const KIT_PREFIX = 'kit:';
const SFX_EXTS = ['.wav', '.mp3'];

/** Tempo profile + storyboard overrides. Pure. */
export const tempoFor = (front) => deepMerge(activeTempo(front.tempo ?? CONFIG.tempo.profile), front.tempoOverrides ?? {});

/** Load campaign hooks (hooks.mjs next to the storyboard), if any. */
async function loadHooks(dir, log) {
  const file = path.join(dir, KIT.HOOKS);
  if (!fsSync.existsSync(file)) return {};
  log(`  custom hooks: ${file}`);
  return import(`file://${file}`);
}

/**
 * The asset/analysis services the composer uses (`ctx`), backed by media-work files
 * with free offline stand-ins for anything missing.
 */
async function makeCtx({ sb, kit, paths, offline, store, log }) {
  const locale = sb.locale;
  const copy = kit.copyFor(locale);
  const text = makeText(sb, locale, copy);
  const tempo = tempoFor(sb.front);
  const voices = kit.voicesFor(locale);
  const at = inputPath(paths);
  const providers = createOfflineProviders({ locale });
  const exists = (f) => (f && fsSync.existsSync(f) ? f : null);
  const fromWork = (f) => (offline ? null : exists(f));
  const kitFile = (rel) => {
    const f = path.resolve(kit.root, rel.slice(rel.startsWith(KIT_PREFIX) ? KIT_PREFIX.length : 0));
    if (!fsSync.existsSync(f)) throw new UserError(`kit file not found: ${f}`);
    return f;
  };
  const cached = async (stage, inputs, label, produce) => {
    const { entry, meta, hit } = await store.getOrCreate(stage, inputs, produce);
    log(`  ${hit ? 'cached' : 'create'}  ${label}`);
    return { entry, meta };
  };
  let standIn = 0;
  const offlineStill = async (label) => {
    const index = standIn++;
    const { entry } = await cached('stills', { provider: PROVIDER.OFFLINE, label, colorIndex: index, option: 0 }, `stand-in still ${label}`, async (e) => {
      await providers.still({ label, index, outFile: e.file(FILE.STILL) });
      return { label };
    });
    return entry.file(FILE.STILL);
  };
  const isVideo = (f) => /\.(mp4|mov|webm|m4v)$/i.test(f);

  const ctx = {
    locale,
    tempo,
    kit,
    copy,
    text,
    async clip(value) {
      if (Array.isArray(value)) {
        // Multi-part: frame-accurate join of 3-clips/ files (the beat is searched in the last part).
        const parts = [];
        let fps = null;
        for (const p of value) {
          const part = typeof p === 'string' ? { file: p } : p;
          const file = exists(path.join(paths.clipsDir, part.file.endsWith('.mp4') ? part.file : `${part.file}.mp4`));
          if (!file) throw new UserError(`clip part not found: 3-clips/${part.file}`);
          const partFps = await probeFps(file);
          if (fps !== null && Math.abs(partFps - fps) > 1e-6) throw new UserError(`clip parts differ in frame rate (${fps} vs ${partFps})`);
          fps = partFps;
          const startFrame = Math.round((part.in ?? 0) * fps);
          const endFrame = part.out == null ? null : Math.round(part.out * fps);
          const frames = (endFrame ?? Math.round((await mediaDuration(file)) * fps)) - startFrame;
          parts.push({ file, startFrame, endFrame, frames, hash: fileHash(await fs.readFile(file)) });
        }
        const beatSearchFromSec = parts.slice(0, -1).reduce((acc, p) => acc + p.frames, 0) / fps;
        const key = { parts: parts.map(({ hash, startFrame, endFrame }) => ({ hash, startFrame, endFrame })), fps };
        const { entry } = await cached('action', key, `clip ${value.map((p) => p.file ?? p).join(' + ')}`, async (e) => {
          await ffmpeg(actionConcatArgs(parts, fps, e.file(FILE.CLIP)));
          return { parts: parts.length, beatSearchFromSec };
        });
        const file = entry.file(FILE.CLIP);
        return { key: String(value[0].file ?? value[0]), file, durationSec: await mediaDuration(file), isClip: true, beatSearchFromSec };
      }
      if (value.startsWith(KIT_PREFIX)) {
        const file = kitFile(value);
        return { key: value, file, durationSec: isVideo(file) ? await mediaDuration(file) : null, isClip: isVideo(file) };
      }
      const file = fromWork(at.clip(value));
      if (file) return { key: value, file, durationSec: await mediaDuration(file), isClip: true };
      // Stand-in: a synthetic clip with a flash and a motion burst over the matching still.
      const still = fromWork(at.still(value)) ?? fromWork(at.still(value.split('.')[0])) ?? (await offlineStill(value));
      const index = standIn++;
      const d = CONFIG.models.clipParams.duration;
      const { entry } = await cached('clips', { provider: PROVIDER.OFFLINE, still: fileHash(await fs.readFile(still)), filter: offlineClipFilter({ actionAtSec: offlineActionAt(index), durationSec: d }) }, `stand-in clip ${value}`, async (e) => {
        await providers.clip({ imageFile: still, outFile: e.file(FILE.CLIP), index });
        return { value };
      });
      const f = entry.file(FILE.CLIP);
      return { key: value, file: f, durationSec: await mediaDuration(f), isClip: true, standIn: true };
    },
    async still(value) {
      if (value.startsWith(KIT_PREFIX)) {
        const file = kitFile(value);
        return { key: value, file, isClip: isVideo(file) };
      }
      const file = fromWork(at.still(value));
      return file ? { key: value, file } : { key: value, file: await offlineStill(value), standIn: true };
    },
    async vo(key, role) {
      const voice = voices[role] ?? {};
      const spoken = text.has(key) ? text({ t: key }) : null;
      let file = fromWork(at.vo(key));
      let raw;
      if (file) raw = await mediaDuration(file);
      else {
        if (voice.ifMissing === 'skip') {
          log(`  skip    vo ${key} [${role}] (no file; ifMissing: skip)`);
          return null;
        }
        const say = (spoken ?? key).replace(/\[[^\]]*\]\s*/g, '');
        const sayVoice = voice.offlineVoice ?? OFFLINE.SAY_VOICE_BY_LOCALE[locale];
        const { entry } = await cached('tts', { provider: PROVIDER.OFFLINE, text: say, sayVoice, rate: voice.offlineRate }, `stand-in vo ${key} [${role}]`, async (e) => {
          const { alignment } = await providers.speak({ text: say, voice, outAudio: e.file(FILE.AUDIO_WAV) });
          return { audio: FILE.AUDIO_WAV, durationSec: alignment.character_end_times_seconds.at(-1) ?? 0 };
        });
        file = entry.file(FILE.AUDIO_WAV);
        raw = await mediaDuration(file);
      }
      const speed = voiceSpeed(tempo, role);
      if (speed !== 1) {
        const src = file;
        const { entry } = await cached('vo-tempo', { audio: fileHash(await fs.readFile(src)), speed }, `vo tempo ${speed}× ${key}`, async (e) => {
          await ffmpeg(['-i', src, '-filter:a', `atempo=${speed}`, e.file(FILE.AUDIO_WAV)]);
          return { speed };
        });
        file = entry.file(FILE.AUDIO_WAV);
      }
      const durationSec = raw / speed;
      return { key, file, durationSec, alignment: approximateAlignment(spoken ?? key, durationSec), text: spoken };
    },
    sfx(name) {
      if (sfxFiles[name]) return sfxFiles[name];
      for (const dir of [path.join(kit.root, 'audio', 'sfx'), paths.musicDir]) {
        for (const ext of SFX_EXTS) {
          const f = path.join(dir, `${name}${ext}`);
          if (fsSync.existsSync(f)) return f;
        }
      }
      throw new UserError(`sound "${name}" not found (built-in: ${Object.values(SFX).join(', ')}; or media-kit/audio/sfx/${name}.wav|mp3)`);
    },
    async music(key) {
      if (key.startsWith(KIT_PREFIX)) return { key, file: kitFile(key) };
      const f = exists(path.join(paths.musicDir, key.endsWith('.mp3') ? key : `${key}.mp3`));
      return f ? { key, file: f } : null;
    },
    async kitFile(rel) {
      return { key: rel, file: kitFile(rel) };
    },
    async analyse(clip, { searchFromSec = 0, searchLastSec = null, beat }) {
      const a = CONFIG.alignment;
      const inputs = { clip: fileHash(await fs.readFile(clip.file)), alignment: a, settle: CONFIG.settle, searchFromSec, searchLastSec, beat, format: ANALYSIS_FORMAT };
      const { entry } = await cached('analyze', inputs, `analysis ${clip.key}`, async (e) => {
        const fps = await probeFps(clip.file);
        const frames = await decodeGrayFrames(clip.file, { fps, width: a.analysisWidth, height: a.analysisHeight });
        await fs.writeFile(e.file(FILE.ANALYSIS), JSON.stringify(analyzeFrames(frames, fps, { searchFromSec, searchLastSec, beat }), null, 2));
        return { ok: true };
      });
      return JSON.parse(await fs.readFile(entry.file(FILE.ANALYSIS), 'utf8'));
    },
    async perfectPhotos() {
      return sb.shots.map((s) => fromWork(at.perfectPhoto(s.id)));
    },
    async beforePhoto() {
      return fromWork(at.still(sb.shots[0]?.id)) ?? fromWork(at.perfectPhoto(sb.shots[0]?.id));
    },
    beats: null,
  };
  // Built-in sounds, synthesised once (the composer looks them up synchronously).
  const sfxFiles = {};
  for (const kind of Object.values(SFX)) {
    const { entry } = await store.getOrCreate('sfx', { kind, args: sfxArgs(kind, '$OUT') }, async (e) => {
      await ffmpeg(sfxArgs(kind, e.file(FILE.AUDIO_WAV)));
      return { kind };
    });
    sfxFiles[kind] = entry.file(FILE.AUDIO_WAV);
  }
  // Music beats: manual override, else analysed from the bed (cached).
  const m = sb.front.music;
  if (m?.beats || m?.bpm) ctx.beats = manualBeats({ beats: m.beats, bpm: m.bpm, offset: m.offset ?? 0, drop: m.drop ?? null });
  else if (m?.bed) {
    const bed = await ctx.music(m.bed);
    if (bed) {
      const { entry } = await cached('beats', { audio: fileHash(await fs.readFile(bed.file)), v: 1 }, `beats ${path.basename(bed.file)}`, async (e) => {
        await fs.writeFile(e.file('beats.json'), JSON.stringify(await analyseBeats(bed.file)));
        return { ok: true };
      });
      ctx.beats = JSON.parse(await fs.readFile(entry.file('beats.json'), 'utf8'));
      log(`  beats   ${ctx.beats.bpm} BPM, ${ctx.beats.beats.length} beats${ctx.beats.drop != null ? `, drop ${ctx.beats.drop}s` : ''}`);
    }
  }
  return ctx;
}

/** Music bed for the final mix (levelled against the run's measured voice, ducked under every line), or null. */
async function planMusic(sb, ctx, tl, log) {
  const m0 = sb.front.music;
  if (!m0?.bed) return null;
  const bed = await ctx.music(m0.bed);
  if (!bed) {
    log(`  music   none (no 4-music/${m0.bed}.mp3)`);
    return null;
  }
  const m = { ...CONFIG.render.music, ...Object.fromEntries(['levelDb', 'duckDb', 'attackSec', 'releaseSec', 'mergeGapSec', 'fadeOutSec'].filter((k) => m0[k] !== undefined).map((k) => [k, m0[k]])) };
  const voiceFiles = [...new Set(tl.audio.filter((a) => a.bus === BUS.VOICE).map((a) => a.file))];
  if (!voiceFiles.length) log('  music   no voice lines — levelled against −20 LUFS');
  const voiceLufs = voiceFiles.length ? meanLufs(await Promise.all(voiceFiles.map(loudnessLufs))) : -20;
  const bedLufs = await loudnessLufs(bed.file);
  const bedSec = await mediaDuration(bed.file);
  const gainDb = musicGainDb({ bedLufs, voiceLufs, levelDb: m.levelDb });
  const windows = duckWindows(tl.audio, m);
  log(
    `  music   ${path.basename(bed.file)} ${bedSec.toFixed(1)}s, bed ${bedLufs.toFixed(1)} LUFS → ${gainDb.toFixed(1)} dB ` +
      `(VO ref ${voiceLufs.toFixed(1)} LUFS, level ${m.levelDb} dB, duck ${m.duckDb} dB, ${windows.length} VO windows)` +
      (bedSec < tl.totalSec ? ` — bed shorter than the video (${tl.totalSec.toFixed(1)}s): looping` : ''),
  );
  return { file: bed.file, gainDb, windows, duckDb: m.duckDb, attackSec: m.attackSec, releaseSec: m.releaseSec, fadeOutSec: m.fadeOutSec };
}

/** Plan (and unless planOnly, render) one campaign/locale. */
export async function runCampaign(sb, { kit, paths, offline = false, dryRun = false, planOnly = false, only = null, log = console.log }) {
  if (!dryRun) assertFfmpeg();
  const store = new CacheStore(paths.cacheDir);
  const presets = loadPresets(kit.presetsDir);
  const hooks = await loadHooks(sb.dir, log);
  log(`[assets + analysis]${offline ? ' (offline stand-ins)' : ''}`);
  const ctx = await makeCtx({ sb, kit, paths, offline, store, log });
  for (const [name, fn] of Object.entries(hooks.analysers ?? {})) ctx[name] = (file) => fn(file, ctx);
  log('[compose]');
  let tl = await compose(sb, { presets, ctx, only, withEnd: !only });
  if (hooks.transform) tl = (await hooks.transform(tl, ctx)) ?? tl;
  const problems = checkTimeline(tl);
  if (problems.length) throw new UserError(`timeline problems:\n  ${problems.join('\n  ')}`);
  const runName = runNameFor(`${sb.front.campaign}-${sb.locale}`, { onlyShot: only, inputs: !offline, offline });
  const runDir = path.join(paths.runsDir, runName);
  await fs.mkdir(runDir, { recursive: true });
  for (const s of tl.segments) log(`  ${String(s.startSec.toFixed(2)).padStart(6)}s  ${s.id.padEnd(14)} ${s.kind.padEnd(8)} ${s.durationSec.toFixed(2)}s`);
  log(`  total ${tl.totalSec.toFixed(2)}s · ${tl.overlays.length} overlays · ${tl.audio.length} audio events · ${tl.effects.length} effects`);
  if (dryRun || planOnly) {
    await fs.writeFile(path.join(runDir, FILE.TIMELINE), JSON.stringify(tl, null, 2));
    return { timeline: tl, runDir };
  }
  log('[graphics]');
  await drawTimeline(tl, { gfxDir: path.join(runDir, 'gfx'), cacheDir: paths.cacheDir, ctx, log });
  await fs.writeFile(path.join(runDir, FILE.TIMELINE), JSON.stringify(tl, null, 2));
  log('[render]');
  const font = sb.front.captions ? { file: path.join(FONTS_DIR, CONFIG.render.captionFont.file), family: CONFIG.render.captionFont.family } : null;
  const outFile = path.join(paths.rendersDir, `${runName}.mp4`);
  await fs.mkdir(paths.rendersDir, { recursive: true });
  const music = await planMusic(sb, ctx, tl, log);
  await renderVideo({
    tl,
    runDir,
    captionsAss: font ? buildAss(tl.captions, { fontName: font.family }) : null,
    font,
    music,
    outFile,
    customEffects: hooks.effects ?? {},
    log,
  });
  log(`\n→ ${outFile}  (${tl.totalSec.toFixed(2)} s)`);
  await writeCampaignReadme({ sb, paths, tl, lastRender: { file: outFile, totalSec: tl.totalSec } });
  return { outFile, timeline: tl, runDir };
}

export { BUILTIN_GRAPHIC, INPUTS };
