// Orchestrator: stills → clips → voice → analyze (+auto re-roll) → render.
// Every paid output goes through the content-hash cache, and every paid call
// is authorised against the run budget first.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { activeTempo, analyzeFrames, planHook, planShot } from './alignment.mjs';
import { CacheStore } from './cache.mjs';
import { buildAss } from './captions.mjs';
import { CONFIG } from './config.mjs';
import { BEAT_MODE, BUS, CACHE_STAGE, END_CARD_STYLE, FILE, FONTS_DIR, INPUTS, INTRO_KIND, OFFLINE, SFX, SHOT_STATUS, STAGE, STAGES, VERDICT, VOICE_ROLE, PROVIDER } from './constants.mjs';
import { runNameFor } from './runs.mjs';
import { UserError } from './errors.mjs';
import { CostLedger, estimateClipCost, estimateStillCost, estimateTtsCost } from './cost.mjs';
import * as gfx from './graphics.mjs';
import { cacheKey, fileHash } from './hash.mjs';
import { assertFfmpeg, decodeGrayFrames, durationSec as mediaDuration, ffmpeg, loudnessLufs, probeFps } from './media/ffmpeg.mjs';
import { createElevenLabsProvider } from './providers/elevenlabs.mjs';
import { createFalProviders } from './providers/fal.mjs';
import { createOfflineProviders, offlineActionAt, offlineClipFilter } from './providers/offline.mjs';
import { actionConcatArgs, renderVideo, sfxArgs } from './render.mjs';
import { loadSecrets } from './secrets.mjs';
import { isSkippable, normalizeLine, plainSpoken, stillPromptFor, ttsText } from './spec.mjs';
import { approximateAlignment } from './captions.mjs';
import { createInputs } from './inputs.mjs';
import { buildTimeline, checkTimeline, duckWindows, GRAPHIC, meanLufs, musicGainDb } from './timeline.mjs';
import { PAPER_STYLE, PRINT_STYLES, endCardSheetLayout } from './endcard-layout.mjs';
import { writeCampaignReadme } from './readme.mjs';

const SEEDS_FILE = 'seeds.json';
/**
 * Version of analysis.json's shape. Bump when analyzeSeries() output changes —
 * free to recompute, unlike CACHE_SCHEMA which would also re-pay paid stages.
 */
const ANALYSIS_FORMAT = 3;
/** The photo sheet is a 2×2 grid. */
const PHOTO_SHEET_CELLS = 4;

const stageReached = (stopAfter, stage) => STAGES.indexOf(stage) <= STAGES.indexOf(stopAfter);

/** Burned-in caption font for libass: the bundled bold face. */
export function resolveFont() {
  const { file, family } = CONFIG.render.captionFont;
  return { file: path.join(FONTS_DIR, file), family };
}

/** Re-roll offsets are keyed by shot id + video prompt, so specs sharing a shot share its re-rolls. */
const seedKey = (shot) => `${shot.id}:${cacheKey('seed', shot.videoPrompt).slice(0, 8)}`;

async function loadSeeds(stateDir) {
  try {
    return JSON.parse(await fs.readFile(path.join(stateDir, SEEDS_FILE), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

async function saveSeeds(stateDir, seeds) {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, SEEDS_FILE), `${JSON.stringify(seeds, null, 2)}\n`);
}

export async function runPipeline(spec, opts, log = console.log) {
  const { dryRun, onlyShot, stopAfter = STAGE.RENDER, maxCostUsd, reroll, paths } = opts;
  // --inputs assembles from the files in media-work/<campaign>/; anything missing
  // uses the free offline stand-in. It never calls a paid provider.
  const inputFiles = createInputs(opts.inputs ? paths : null);
  const offline = opts.offline || inputFiles.enabled;
  const mode = offline ? PROVIDER.OFFLINE : PROVIDER.LIVE;
  if (inputFiles.enabled) log(`inputs: ${paths.campaignDir} (missing items fall back to offline stand-ins)`);
  const store = new CacheStore(paths.cacheDir);
  const ledger = new CostLedger({ maxUsd: maxCostUsd, enforce: !offline });
  // Offline clips are synthesised by ffmpeg; live runs need it from analysis on.
  const needsFfmpeg = !dryRun && stageReached(stopAfter, offline ? STAGE.CLIPS : STAGE.ANALYZE);
  if (needsFfmpeg) assertFfmpeg();

  const secrets = offline || dryRun ? null : loadSecrets({ required: true });
  const providers = offline
    ? createOfflineProviders({ locale: spec.locale })
    : secrets && { ...createFalProviders({ key: secrets.falKey, log }), ...createElevenLabsProvider({ key: secrets.elevenLabsKey }) };

  const allShots = spec.shots.map((shot, index) => ({ shot, index }));
  const selected = onlyShot ? allShots.filter((s) => s.shot.id === onlyShot) : allShots;
  if (onlyShot && selected.length === 0) throw new UserError(`--only: no shot "${onlyShot}" in ${spec.id} (have: ${spec.shots.map((s) => s.id).join(', ')})`);
  const withEndCard = !onlyShot;
  const tempo = activeTempo(spec.tempo);
  log(`tempo: ${tempo.name}`);

  const seeds = await loadSeeds(paths.stateDir);
  if (reroll) {
    const target = spec.shots.find((s) => s.id === reroll);
    if (!target) throw new UserError(`--reroll: no shot "${reroll}" in ${spec.id}`);
    seeds[seedKey(target)] = (seeds[seedKey(target)] ?? 0) + 1;
    log(`re-roll ${reroll}: seed offset now ${seeds[seedKey(target)]}`);
    if (!dryRun) await saveSeeds(paths.stateDir, seeds);
  }

  /** Cache-or-produce for a (possibly paid) step. Returns null meta on a dry-run miss. */
  async function step(stage, inputs, label, usd, produce) {
    const entry = store.entry(stage, inputs);
    const cached = await store.readMeta(entry);
    if (cached) {
      log(`  cached  ${label}`);
      return { entry, meta: cached };
    }
    if (dryRun) {
      ledger.record(label, offline ? 0 : usd, { paid: false });
      log(`  would   ${label}${offline ? '' : `  (~$${usd.toFixed(3)})`}`);
      return { entry, meta: null };
    }
    if (!offline) ledger.authorize(label, usd);
    await store.prepare(entry);
    log(`  create  ${label}`);
    const meta = await produce(entry);
    await store.commit(entry, meta);
    if (!offline) ledger.record(label, usd, { paid: true });
    return { entry, meta };
  }

  // ── 1. stills ────────────────────────────────────────────────────────────
  log(`[${STAGE.STILLS}]`);
  const stills = new Map();
  for (const { shot, index } of selected) {
    const providedStill = inputFiles.still(shot.id);
    if (providedStill) {
      stills.set(shot.id, { file: providedStill, remoteUrl: null });
      log(`  input   still ${shot.id}: ${providedStill}`);
      continue;
    }
    if (shot.still.file) {
      const file = path.resolve(spec.specDir, shot.still.file);
      stills.set(shot.id, { file, remoteUrl: null });
      log(`  file    ${shot.id}: ${file}`);
      continue;
    }
    const prompt = stillPromptFor(spec, shot);
    const options = [];
    for (let i = 0; i < shot.still.options; i++) {
      const seed = shot.seed + i;
      const inputs = offline
        ? { provider: mode, label: shot.id, colorIndex: index, option: i }
        : { provider: mode, model: CONFIG.models.still, params: CONFIG.models.stillParams, prompt, seed };
      const { entry, meta } = await step(STAGE.STILLS, inputs, `still ${shot.id} #${i}`, estimateStillCost(), async (e) => {
        const res = await providers.still({ prompt, seed, label: `${shot.id} #${i}`, index, outFile: e.file(FILE.STILL) });
        return { ...res, prompt, seed };
      });
      options.push(meta && { file: entry.file(FILE.STILL), remoteUrl: meta.remoteUrl });
    }
    if (options.every(Boolean) && options.length > 1) log(`  options ${shot.id} (pick=${shot.still.pick}): ${options.map((o) => o.file).join('  ')}`);
    stills.set(shot.id, options[shot.still.pick]);
  }
  if (!stageReached(stopAfter, STAGE.CLIPS)) return finish();

  // ── 2. clips ─────────────────────────────────────────────────────────────
  log(`[${STAGE.CLIPS}]`);
  const clipUsd = estimateClipCost(CONFIG.models.clipParams.duration);
  /**
   * Multi-part action (spec `action`): parts resolved under <inputs>/clips/
   * (or the spec dir), cut by frame and joined into one cached clip. The beat
   * search later starts at the last part (`beatSearchFromSec`).
   */
  async function assembleAction(shot) {
    const parts = [];
    let fps = null;
    for (const part of shot.action) {
      const file = (inputFiles.enabled && inputFiles.clipFile(part.file)) || path.resolve(spec.specDir, part.file);
      if (!fsSync.existsSync(file)) throw new UserError(`${shot.id}: action part not found: ${file}`);
      const partFps = await probeFps(file);
      if (fps !== null && Math.abs(partFps - fps) > 1e-6) throw new UserError(`${shot.id}: action parts differ in frame rate (${fps} vs ${partFps})`);
      fps = partFps;
      const startFrame = Math.round(part.in * fps);
      const endFrame = part.out === null ? null : Math.round(part.out * fps);
      const frames = (endFrame ?? Math.round((await mediaDuration(file)) * fps)) - startFrame;
      parts.push({ file, startFrame, endFrame, frames, hash: fileHash(await fs.readFile(file)) });
    }
    const beatSearchFromSec = parts.slice(0, -1).reduce((acc, p) => acc + p.frames, 0) / fps;
    const key = { parts: parts.map(({ hash, startFrame, endFrame }) => ({ hash, startFrame, endFrame })), fps };
    const { entry } = await step(CACHE_STAGE.ACTION, key, `action ${shot.id} (${parts.length} parts, joins at ${beatSearchFromSec.toFixed(2)}s)`, 0, async (e) => {
      await ffmpeg(actionConcatArgs(parts, fps, e.file(FILE.CLIP)));
      return { parts: parts.length, beatSearchFromSec };
    });
    return { file: entry.file(FILE.CLIP), meta: { source: CACHE_STAGE.ACTION }, beatSearchFromSec };
  }

  async function makeClip(shot, index) {
    // --offline (no inputs): action parts are real footage, so use the synthetic stand-in clip instead.
    if (shot.action && !(offline && !inputFiles.enabled)) return assembleAction(shot);
    const providedClip = inputFiles.clip(shot.id);
    if (providedClip) {
      log(`  input   clip ${shot.id}: ${providedClip}`);
      return { file: providedClip, meta: { source: PROVIDER.INPUTS } };
    }
    const still = stills.get(shot.id);
    const offset = seeds[seedKey(shot)] ?? 0;
    const seed = shot.seed + offset;
    if (!still) {
      // Dry run with the still not generated yet: the clip is necessarily a miss.
      ledger.record(`clip ${shot.id} (seed ${seed})`, offline ? 0 : clipUsd, { paid: false });
      log(`  would   clip ${shot.id} (seed ${seed}) after its still${offline ? '' : `  (~$${clipUsd.toFixed(3)})`}`);
      return null;
    }
    const stillHash = fileHash(await fs.readFile(still.file));
    const durationSec = CONFIG.models.clipParams.duration;
    const inputs = offline
      ? { provider: mode, still: stillHash, filter: offlineClipFilter({ actionAtSec: offlineActionAt(index), durationSec }) }
      : { provider: mode, model: CONFIG.models.clip, params: CONFIG.models.clipParams, prompt: shot.videoPrompt, still: stillHash, seed };
    const { entry, meta } = await step(STAGE.CLIPS, inputs, `clip ${shot.id} (seed ${seed})`, clipUsd, async (e) => {
      const res = await providers.clip({ imageUrl: still.remoteUrl, imageFile: still.file, prompt: shot.videoPrompt, seed, index, outFile: e.file(FILE.CLIP) });
      return { ...res, prompt: shot.videoPrompt, seed };
    });
    return meta && { file: entry.file(FILE.CLIP), meta };
  }
  const clips = new Map();
  for (const { shot, index } of selected) clips.set(shot.id, await makeClip(shot, index));
  if (!stageReached(stopAfter, STAGE.VOICE)) return finish();

  // ── 3. voice ─────────────────────────────────────────────────────────────
  log(`[${STAGE.VOICE}]`);
  /**
   * One spoken line → { file, alignment, durationSec }, or null when the role is
   * explicitly skippable (ifMissing: "skip") and has no provided file / voice id.
   * Order: provided file (--inputs) → skip → generate (offline `say` or live TTS).
   */
  /** Spoken line at the tempo's playback speed for its role (atempo, pitch kept; cached by content). */
  async function speak(lineIn, role, key) {
    const said = await speakRaw(lineIn, role, key);
    const speed = tempo.voSpeedRoles?.includes(role) ? tempo.voSpeed : 1;
    if (!said || speed === 1) return said;
    const { entry } = await step(CACHE_STAGE.VO_TEMPO, { audio: fileHash(await fs.readFile(said.file)), speed }, `vo tempo ${speed}× ${path.basename(said.file)}`, 0, async (e) => {
      await ffmpeg(['-i', said.file, '-filter:a', `atempo=${speed}`, e.file(FILE.AUDIO_WAV)]);
      return { speed };
    });
    return { ...said, file: entry.file(FILE.AUDIO_WAV), alignment: scaleAlignment(said.alignment, 1 / speed), durationSec: said.durationSec / speed };
  }

  async function speakRaw(lineIn, role, [owner, part]) {
    const line = normalizeLine(lineIn);
    const voice = spec.voices[role];
    const provided = inputFiles.vo(owner, part);
    if (provided) {
      // Captions are off by default, so a duration-spread alignment is enough here.
      const dur = await mediaDuration(provided);
      log(`  input   vo [${role}] ${provided} (${dur.toFixed(2)}s)`);
      return { file: provided, alignment: approximateAlignment(line.text, dur), durationSec: dur, text: line.text };
    }
    if (isSkippable(voice) && (inputFiles.enabled || (!offline && !voice.voiceId))) {
      log(`  skip    vo [${role}] "${line.text}" (no ${inputFiles.enabled ? 'provided file' : 'voice id'}; ifMissing: skip)`);
      return null;
    }
    const text = offline ? plainSpoken(line) : ttsText(line);
    const postSpeed = offline ? null : voice.postSpeed ?? null;
    const cacheInputs = offline
      ? { provider: mode, text, sayVoice: voice.offlineVoice ?? OFFLINE.SAY_VOICE_BY_LOCALE[spec.locale], rate: voice.offlineRate }
      : {
          provider: mode,
          text,
          voiceId: voice.voiceId,
          modelId: voice.modelId ?? CONFIG.models.tts.modelId,
          settings: voice.settings,
          languageCode: voice.languageCode,
          seed: voice.seed,
          format: CONFIG.models.tts.outputFormat,
          postSpeed,
        };
    const { entry, meta } = await step(CACHE_STAGE.TTS, cacheInputs, `vo [${role}] "${text}"`, estimateTtsCost(text), async (e) => {
      const raw = providers.audioFile === 'mp3' ? FILE.AUDIO_MP3 : FILE.AUDIO_WAV;
      let { alignment } = await providers.speak({ text, voice, outAudio: e.file(raw) });
      let audio = raw;
      if (postSpeed && postSpeed !== 1) {
        // e.g. the announcer: generated at natural pace, sped up afterwards (pitch kept).
        await ffmpeg(['-i', e.file(raw), '-filter:a', `atempo=${postSpeed}`, e.file(FILE.SPED_AUDIO)]);
        alignment = scaleAlignment(alignment, 1 / postSpeed);
        audio = FILE.SPED_AUDIO;
      }
      await fs.writeFile(e.file(FILE.ALIGNMENT), JSON.stringify(alignment));
      return { audio, text, durationSec: alignment.character_end_times_seconds.at(-1) ?? 0 };
    });
    if (!meta) return null;
    const alignment = JSON.parse(await fs.readFile(entry.file(FILE.ALIGNMENT), 'utf8'));
    return { file: entry.file(meta.audio), alignment, durationSec: meta.durationSec, text: line.text };
  }
  const lines = new Map();
  for (const { shot } of selected) {
    lines.set(shot.id, {
      line: await speak(shot.vo.line, VOICE_ROLE.NARRATOR, [shot.id, INPUTS.VO_LINE]),
      quip: shot.vo.quip ? await speak(shot.vo.quip, VOICE_ROLE.NARRATOR, [shot.id, INPUTS.VO_QUIP]) : null,
    });
  }
  const clerk = {};
  const verdictsUsed = new Set(selected.map((s) => s.shot.verdict).filter((v) => v === VERDICT.REJECTED));
  if (withEndCard) verdictsUsed.add(VERDICT.APPROVED);
  for (const v of verdictsUsed) clerk[v] = await speak(spec.clerkLines[v], VOICE_ROLE.CLERK, [INPUTS.VO_CLERK, v]);
  const hookVo = spec.hook.vo ? await speak(spec.hook.vo, VOICE_ROLE.NARRATOR, [INPUTS.VO_HOOK, null]) : null;
  const announcer =
    withEndCard && spec.endCard.announcer
      ? await speak(spec.endCard.announcer, VOICE_ROLE.ANNOUNCER, [INPUTS.ENDCARD_ID, INPUTS.VO_ANNOUNCER])
      : null;
  const endCardBackground = withEndCard
    ? (spec.endCard.backgroundClip ? path.resolve(spec.specDir, spec.endCard.backgroundClip) : inputFiles.clip(INPUTS.ENDCARD_ID))
    : null;
  if (endCardBackground) log(`  input   end-card background: ${endCardBackground}`);
  if (!stageReached(stopAfter, STAGE.ANALYZE) || dryRun) return finish();

  // ── 4. analyze + plan (auto re-roll on a missing action beat) ─────────────
  log(`[${STAGE.ANALYZE}]`);
  const a = CONFIG.alignment;
  async function analyze(clipFile, searchFromSec = 0, searchLastSec = null, beat = BEAT_MODE.ACTION) {
    const inputs = { clip: fileHash(await fs.readFile(clipFile)), alignment: a, settle: CONFIG.settle, searchFromSec, searchLastSec, beat, format: ANALYSIS_FORMAT };
    const { entry, meta } = await step(STAGE.ANALYZE, inputs, `analysis ${path.basename(path.dirname(clipFile))}`, 0, async (e) => {
      // Native frame rate: resampling 24 → 30 fps duplicates every 5th frame (zero motion).
      const fps = await probeFps(clipFile);
      const frames = await decodeGrayFrames(clipFile, { fps, width: a.analysisWidth, height: a.analysisHeight });
      const result = analyzeFrames(frames, fps, { searchFromSec, searchLastSec, beat });
      if (result.strayFlashesSec.length) log(`  note    flash(es) after the opening window in ${path.basename(clipFile)} at ${result.strayFlashesSec.join(', ')}s (the beat anchor in result shots; otherwise ignored, still visible)`);
      await fs.writeFile(e.file(FILE.ANALYSIS), JSON.stringify(result, null, 2));
      return { ok: true };
    });
    return meta && JSON.parse(await fs.readFile(entry.file(FILE.ANALYSIS), 'utf8'));
  }
  /** Habitat intro for a shot: spec path or --inputs file; a provided clip wins over a still. */
  function resolveIntro(shot) {
    if (!shot.intro.enabled) return null;
    const fromSpec = (p) => (p ? path.resolve(spec.specDir, p) : null);
    const clip = fromSpec(shot.intro.clip) ?? inputFiles.introClip(shot.id);
    if (clip) return { kind: INTRO_KIND.CLIP, file: clip };
    const still = fromSpec(shot.intro.still) ?? inputFiles.introStill(shot.id);
    return still ? { kind: INTRO_KIND.STILL, file: still } : null;
  }
  /** Result still for a shot (spec path or --inputs file), or null → classic structure. */
  function resolveResult(shot) {
    if (!shot.result.enabled || shot.verdict !== VERDICT.REJECTED) return null;
    const file = shot.result.still ? path.resolve(spec.specDir, shot.result.still) : inputFiles.resultStill(shot.id);
    return file ? { file } : null;
  }
  // A spoken hook delays the first shot's rule line (planHook → minVoStartSec).
  const hookPlan = planHook({ hookVoDur: hookVo?.durationSec ?? 0, titleDurationSec: spec.hook.durationSec, tempo });
  const planned = [];
  const failures = [];
  for (const { shot, index } of selected) {
    const intro = resolveIntro(shot);
    const result = resolveResult(shot);
    let attempt = 0;
    for (;;) {
      const clip = clips.get(shot.id);
      // A multi-part action searches its last part; a single continuous clip in a
      // result shot searches its final stretch (the beat is the final burst).
      const multiPart = (clip.beatSearchFromSec ?? 0) > 0;
      const tailSearch = result && !multiPart ? CONFIG.result.syntheticFlash.finalBeatSearchSec : null;
      const analysis = await analyze(clip.file, clip.beatSearchFromSec ?? 0, tailSearch, shot.beat);
      const vo = lines.get(shot.id);
      const plan = planShot(shot, {
        analysis,
        clipDur: analysis.durationSec,
        voDur: vo.line.durationSec,
        quipDur: vo.quip?.durationSec ?? 0,
        clerkDur: clerk[VERDICT.REJECTED]?.durationSec ?? 0,
        introDur: !intro ? 0 : intro.kind === INTRO_KIND.CLIP ? CONFIG.intro.clipDurationSec : CONFIG.intro.durationSec,
        result: Boolean(result),
        flashMode: shot.flash,
        beatPartStartSec: clip.beatSearchFromSec ?? 0,
        continuous: !multiPart,
        minVoStartSec: planned.length === 0 && failures.length === 0 ? hookPlan.minFirstVoStartSec : 0,
        tempo,
      });
      if (plan.status === SHOT_STATUS.OK) {
        log(`  plan    ${shot.id}: ${describePlan(plan, analysis)}`);
        if (intro) log(`  intro   ${shot.id}: ${intro.kind} ${intro.file}`);
        if (result) log(`  result  ${shot.id}: ${result.file}`);
        planned.push({ shot, plan, clipFile: clip.file, line: vo.line, quip: vo.quip, intro, result });
        break;
      }
      log(`  FAILED  ${shot.id}: ${plan.reason}`);
      if (offline || attempt >= CONFIG.budget.maxAutoRerolls) {
        failures.push({ shotId: shot.id, reason: plan.reason });
        break;
      }
      attempt++;
      seeds[seedKey(shot)] = (seeds[seedKey(shot)] ?? 0) + 1;
      await saveSeeds(seeds);
      log(`  re-roll ${shot.id} automatically (${attempt}/${CONFIG.budget.maxAutoRerolls})`);
      clips.set(shot.id, await makeClip(shot, index));
    }
  }
  if (failures.length) {
    return finish({ failures, error: `Shot(s) without a usable action beat: ${failures.map((f) => f.shotId).join(', ')}. Re-roll with --reroll=<shotId>.` });
  }
  if (!stageReached(stopAfter, STAGE.RENDER)) return finish();

  // ── 5. render ────────────────────────────────────────────────────────────
  log(`[${STAGE.RENDER}]`);
  const sfx = {};
  for (const kind of Object.values(SFX)) {
    const { entry } = await step(CACHE_STAGE.SFX, { kind, args: sfxArgs(kind, '$OUT') }, `sfx ${kind}`, 0, async (e) => {
      await ffmpeg(sfxArgs(kind, e.file(FILE.AUDIO_WAV)));
      return { kind };
    });
    sfx[kind] = entry.file(FILE.AUDIO_WAV);
  }
  // Grid end card: a grid style is chosen and every shot's perfect photo fills the 2×2 sheet.
  const perfectPhotos = planned.map(({ shot }) => inputFiles.perfectPhoto(shot.id));
  const gridStyle = spec.endCard.style !== END_CARD_STYLE.CLASSIC;
  const endCardSheet = withEndCard && gridStyle && planned.length === PHOTO_SHEET_CELLS && perfectPhotos.every(Boolean);
  if (endCardSheet) log(`  end     ${spec.endCard.style} end card with ${perfectPhotos.length} perfect photos`);
  else if (withEndCard) log(`  end     classic end card${gridStyle ? ` (${spec.endCard.style} needs a perfect photo for each of ${PHOTO_SHEET_CELLS} shots)` : ''}`);
  const tl = buildTimeline({ spec, shots: planned, clerk, sfx, withEndCard, announcer, endCardBackground, hookVo, endCardSheet });
  const problems = checkTimeline(tl);
  if (problems.length) throw new Error(`timeline problems:\n  ${problems.join('\n  ')}`);

  const runName = runNameFor(spec.id, { onlyShot, inputs: inputFiles.enabled, offline });
  const runDir = path.join(paths.runsDir, runName);
  const gfxDir = path.join(runDir, 'gfx');
  await fs.mkdir(gfxDir, { recursive: true });
  const graphicFile = (key) => path.join(gfxDir, `${key}.png`);
  await writeGraphics(spec, selected.map((s) => s.shot), graphicFile, withEndCard, Boolean(endCardBackground), endCardSheet ? { photos: perfectPhotos, beforeFile: inputFiles.still(planned[0].shot.id) ?? perfectPhotos[0] } : null);
  await fs.writeFile(path.join(runDir, FILE.TIMELINE), JSON.stringify(tl, null, 2));

  const font = spec.captions ? resolveFont() : null;
  const outFile = path.join(paths.rendersDir, `${runName}.mp4`);
  await fs.mkdir(paths.rendersDir, { recursive: true });
  const music = await planMusic(spec, inputFiles, tl, log);
  await renderVideo({
    tl,
    runDir,
    graphicFile,
    captionsAss: spec.captions ? buildAss(tl.captions, { fontName: font.family }) : null,
    font,
    music,
    outFile,
    log,
  });
  log(`\n→ ${outFile}  (${tl.totalSec.toFixed(2)} s)`);
  await writeCampaignReadme({ spec, paths, inputFiles: createInputs(paths), lastRender: { file: outFile, totalSec: tl.totalSec }, ledger });
  return finish({ outFile, timeline: tl });

  function finish(extra = {}) {
    log(`\n[cost${dryRun ? ' — dry run, cache misses only' : ''}]\n${ledger.summary()}`);
    if (dryRun && !offline) {
      const worst = selected.length * CONFIG.budget.maxAutoRerolls * estimateClipCost(CONFIG.models.clipParams.duration);
      log(`  would spend: $${ledger.plannedUsd.toFixed(3)} (+ up to $${worst.toFixed(2)} if every clip needs ${CONFIG.budget.maxAutoRerolls} auto re-rolls)`);
    }
    return { ledger, ...extra };
  }
}

/**
 * Music bed for the final mix, or null. `spec.music: null` = none; otherwise
 * `spec.music.file` (relative to the spec) or the inputs bed (music/bed.mp3).
 * The bed is levelled against the run's own VO (measured loudness), so the
 * VO-to-music ratio holds whatever the source levels are.
 */
async function planMusic(spec, inputFiles, tl, log) {
  if (!spec.music) return null;
  const file = spec.music.file ? path.resolve(spec.specDir, spec.music.file) : inputFiles.music();
  if (!file) {
    log('  music   none (no music.file and no 4-music/bed.mp3)');
    return null;
  }
  const m = { ...CONFIG.render.music, ...pick(spec.music, ['levelDb', 'duckDb']) };
  const voiceFiles = [...new Set(tl.audio.filter((a) => a.bus === BUS.VOICE).map((a) => a.file))];
  const voiceLufs = meanLufs(await Promise.all(voiceFiles.map(loudnessLufs)));
  const bedLufs = await loudnessLufs(file);
  const bedSec = await mediaDuration(file);
  const gainDb = musicGainDb({ bedLufs, voiceLufs, levelDb: m.levelDb });
  const windows = duckWindows(tl.audio, m);
  log(
    `  music   ${path.basename(file)} ${bedSec.toFixed(1)}s, bed ${bedLufs.toFixed(1)} LUFS → ${gainDb.toFixed(1)} dB ` +
      `(VO ref ${voiceLufs.toFixed(1)} LUFS, level ${m.levelDb} dB, duck ${m.duckDb} dB, ${windows.length} VO windows)` +
      (bedSec < tl.totalSec ? ` — bed shorter than the video (${tl.totalSec.toFixed(1)}s): looping` : ''),
  );
  return { file, gainDb, windows, duckDb: m.duckDb, attackSec: m.attackSec, releaseSec: m.releaseSec, fadeOutSec: m.fadeOutSec };
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/** Rescale an ElevenLabs-style alignment's times (e.g. after atempo). Pure. */
export function scaleAlignment(alignment, factor) {
  const scale = (xs) => xs.map((t) => t * factor);
  return {
    ...alignment,
    character_start_times_seconds: scale(alignment.character_start_times_seconds),
    character_end_times_seconds: scale(alignment.character_end_times_seconds),
  };
}

function describePlan(plan, analysis) {
  const parts = [`${plan.durationSec.toFixed(2)}s`];
  if (plan.resultSec) {
    parts.push(plan.syntheticFlashAt != null ? `synthetic flash at ${plan.syntheticFlashAt.toFixed(2)}s (grin onset src ${plan.source.beatSec.toFixed(2)}s)` : `flash (beat) src ${plan.source.beatSec.toFixed(2)}s`, `in ${plan.source.inSec.toFixed(2)}s`, `result still ${plan.resultSec.toFixed(2)}s`);
  } else if (plan.verdict === VERDICT.REJECTED) {
    parts.push(`flash ${analysis.flash.t.toFixed(2)}s`, `beat ${analysis.action.t.toFixed(2)}s` + (analysis.action.contrast != null ? ` (${analysis.action.contrast.toFixed(1)}× run-up)` : ''));
  }
  if (plan.introSec > 0) parts.push(`intro ${plan.introSec.toFixed(2)}s`);
  if (plan.speed < 1) parts.push(`pre-action ${plan.speed.toFixed(2)}×`);
  if (plan.freezeHeadSec > 0) parts.push(`freeze head ${plan.freezeHeadSec.toFixed(2)}s`);
  if (plan.freezeTailSec > 0) parts.push(`freeze tail ${plan.freezeTailSec.toFixed(2)}s`);
  return parts.join(', ');
}

/**
 * Text for the real-sheet panel / grid strip: endCard.sheet (tagline, order line,
 * QR URL; `url` defaults to https://<endCard.url>) + the short URL.
 */
function sheetText(spec, style) {
  const sheet = spec.endCard.sheet ?? {};
  if (style === PRINT_STYLES.REAL && !(sheet.tagline && sheet.order && sheet.qrUrl)) {
    throw new UserError(`${spec.id}: endCard.sheet { tagline, order, qrUrl } is required for the '${style}' end card`);
  }
  return { ...sheet, url: sheet.url ?? `https://${spec.endCard.url}`, shortUrl: spec.endCard.url };
}

async function writeGraphics(spec, shots, graphicFile, withEndCard, overVideo, sheetInputs = null) {
  const write = (key, buf) => fs.writeFile(graphicFile(key), buf);
  await write(GRAPHIC.HOOK, await gfx.hookPng(spec.hook.text));
  await write(GRAPHIC.BRAND, await gfx.brandChipPng(spec.endCard.wordmark ?? spec.labels.brand));
  if (spec.ruleCaptions) for (const shot of shots) await write(GRAPHIC.PILL(shot.id), await gfx.rulePng(shot.caption));
  const stamps = {};
  for (const verdict of Object.values(VERDICT)) {
    stamps[verdict] = await gfx.stampPng({ label: spec.labels[verdict], brand: spec.labels.brand, verdict, rotateDeg: verdict === VERDICT.REJECTED ? -8 : -6 });
    if (spec.marks) await write(GRAPHIC.MARK(verdict), await gfx.markPng(verdict));
    await write(GRAPHIC.STAMP(verdict), await gfx.stickerOverlayPng(stamps[verdict]));
  }
  if (withEndCard) {
    const { copy, url, cta, ctaHint, wordmark } = spec.endCard;
    const card = { copy, url, cta, ctaHint, wordmark: wordmark ?? spec.labels.brand };
    if (sheetInputs) {
      // Grid card: base (logo row, CTA, hint) + the animated sheet + a sheet-sized approve stamp.
      const style = spec.endCard.style;
      const paper = style === PAPER_STYLE;
      await write(GRAPHIC.ENDCARD_BASE, paper ? await gfx.endCardSheetBasePng(card) : await gfx.printSheetBasePng(style, card));
      await write(
        GRAPHIC.PHOTO_SHEET,
        paper ? await gfx.photoSheetPng(sheetInputs.photos) : await gfx.printSheetCardPng(style, sheetInputs.photos, { wordmark: card.wordmark, beforeFile: sheetInputs.beforeFile, text: sheetText(spec, style) }),
      );
      await write(GRAPHIC.STAMP(VERDICT.APPROVED), await gfx.stickerOverlayPng(stamps[VERDICT.APPROVED], endCardSheetLayout(style).stamp.w));
    } else {
      await write(GRAPHIC.ENDCARD_BASE, await gfx.endCardPng({ ...card, stamp: null, overVideo }));
      await write(GRAPHIC.ENDCARD_FULL, await gfx.endCardPng({ ...card, stamp: stamps[VERDICT.APPROVED], overVideo }));
    }
  }
}

