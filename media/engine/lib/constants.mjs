// Every shared literal of the engine. Tunable numbers live in config.mjs;
// this file holds names, enums and endpoints that must not drift. Nothing here
// is brand-specific: brand, voices and copy come from the project's media kit.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Bundled OFL fonts (Inter) — the default text face on every OS. */
export const FONTS_DIR = path.join(ENGINE_ROOT, 'fonts');
/** Neutral stand-in kit used when the project has none (tests, first offline runs). */
export const DEFAULT_KIT_DIR = path.join(ENGINE_ROOT, 'kit-default');
/** Test fixtures (example campaign specs). */
export const FIXTURES_DIR = path.join(ENGINE_ROOT, 'test', 'fixtures');

/** Consumer roots, relative to the working directory unless set by flag / env. */
export const DEFAULT_ROOTS = Object.freeze({ KIT: 'media-kit', WORK: 'media-work' });

/**
 * media-work/<campaign>/ layout: numbered input folders in production order,
 * renders and review per locale; dot-folders are engine internals.
 */
export const WORK = Object.freeze({
  VOICE: '1-voice',
  STILLS: '2-stills',
  CLIPS: '3-clips',
  MUSIC: '4-music',
  RENDERS: '5-renders',
  REVIEW: 'review',
  README: 'README.md',
  CACHE: '.cache',
  RUNS: '.runs',
  STATE: '.state',
  TMP: '.tmp',
});

/** media-kit/ layout (the parts the engine reads). */
export const KIT = Object.freeze({
  BRAND_FILE: 'brand.yaml',
  VOICES_FILE: 'voices.yaml',
  COPY_DIR: 'copy',
  PRESETS_DIR: 'presets',
  TEMPLATES_DIR: 'templates',
  CAMPAIGNS_DIR: 'campaigns',
  STORYBOARD: 'storyboard.md',
  HOOKS: 'hooks.mjs',
  /** voices.yaml key used for every locale. */
  ANY_LOCALE: '*',
});

/** Built-in presets and templates shipped with the engine. */
export const BUILTIN_PRESETS_DIR = path.join(ENGINE_ROOT, 'presets');
export const BUILTIN_TEMPLATES_DIR = path.join(ENGINE_ROOT, 'templates');
/** Template names with this prefix are drawn in code (graphics.mjs), not from SVG. */
export const BUILTIN_GRAPHIC = 'builtin:';

/** Homebrew's keg-only ffmpeg build that includes libass (preferred when present). */
export const FFMPEG_FULL_BIN_DIR = '/opt/homebrew/opt/ffmpeg-full/bin';

export const ENV = Object.freeze({
  FFMPEG: 'MEDIA_FFMPEG',
  FFPROBE: 'MEDIA_FFPROBE',
  KIT: 'MEDIA_KIT',
  WORK: 'MEDIA_WORK',
});

/**
 * End-card styles. `grid*` and `real-sheet` show the 2×2 grid of "perfect"
 * photos (needs one per shot, 4 shots); `classic` is logo + copy + CTA.
 */
export const END_CARD_STYLE = Object.freeze({
  REAL_SHEET: 'real-sheet',
  GRID: 'grid',
  GRID_STRIP: 'grid-strip',
  TILTED: 'tilted',
  CLASSIC: 'classic',
});

/** Flash source for result shots: the clip's own flash if any, else synthetic; or always synthetic. */
export const FLASH_MODE = Object.freeze({ AUTO: 'auto', SYNTHETIC: 'synthetic' });

/** What the shot's beat is: an ACTION burst (grin, tilt) or the animal SETTLING into stillness (posing). */
export const BEAT_MODE = Object.freeze({ ACTION: 'action', SETTLE: 'settle' });

export const VERDICT = Object.freeze({ REJECTED: 'rejected', APPROVED: 'approved' });
export const SHOT_STATUS = Object.freeze({ OK: 'ok', FAILED: 'failed' });

/**
 * Inputs inside media-work/<campaign>/ (see WORK). Files are dropped in by
 * `ingest` (or by hand); anything absent falls back to the offline stand-in.
 */
export const INPUTS = Object.freeze({
  STILL_EXT: '.png',
  CLIP_EXT: '.mp4',
  VO_EXT: '.mp3',
  MUSIC_BED: 'bed.mp3',
  /** Clip id of the optional end-card background (3-clips/endcard.mp4). */
  ENDCARD_ID: 'endcard',
  /** VO keys: <shot>.line, <shot>.quip, endcard.announcer, clerk.<verdict>. */
  VO_LINE: 'line',
  VO_QUIP: 'quip',
  VO_ANNOUNCER: 'announcer',
  VO_CLERK: 'clerk',
  /** 1-voice/<locale>/hook.mp3 — the spoken hook title. */
  VO_HOOK: 'hook',
  /** Intro (subject in context before the action): 2-stills/<shot>.intro.png or 3-clips/<shot>.intro.mp4. */
  INTRO_SUFFIX: '.intro',
  /** Result still (the "taken" photo on a plain background): 2-stills/<shot>.result.png. */
  RESULT_SUFFIX: '.result',
  /** Perfect photos for the grid end card: 2-stills/perfect/<shot>.png. */
  PERFECT_DIR: 'perfect',
});

/** Audio buses — voice ducks the music; sfx does not. */
export const BUS = Object.freeze({ VOICE: 'voice', SFX: 'sfx' });

export const SFX = Object.freeze({ THUD: 'thud', DING: 'ding', SHUTTER: 'shutter', WHOOSH: 'whoosh' });

/** What plays before an animal clip. */
export const INTRO_KIND = Object.freeze({ STILL: 'still', CLIP: 'clip' });

export const OFFLINE = Object.freeze({
  /** macOS `say` voices for --offline stand-in VO (absent `say` → silent stand-ins). */
  SAY_VOICE_BY_LOCALE: Object.freeze({ pl: 'Zosia', 'en-us': 'Samantha', 'en-gb': 'Daniel', de: 'Anna', fr: 'Thomas', es: 'Mónica' }),
  SAY_BIN: 'say',
});

export const FILE = Object.freeze({
  STILL: 'still.png',
  CLIP: 'clip.mp4',
  SPED_AUDIO: 'audio.sped.wav',
  AUDIO_MP3: 'audio.mp3',
  AUDIO_WAV: 'audio.wav',
  ALIGNMENT: 'alignment.json',
  META: 'meta.json',
  ANALYSIS: 'analysis.json',
  CAPTIONS: 'captions.ass',
  CONCAT_LIST: 'concat.txt',
  BASE_VIDEO: 'base.mp4',
  TIMELINE: 'timeline.json',
  STATE: 'state.json',
  COST: 'cost.json',
});

/** Where a run's media came from (also the run-name suffix). */
export const PROVIDER = Object.freeze({ OFFLINE: 'offline', INPUTS: 'inputs' });

/** `ingest --as <kind>:<target>` roles → inputs layout. `music` takes no target. */
export const INGEST_KIND = Object.freeze({
  CLIP: 'clip',
  STILL: 'still',
  RESULT: 'result',
  PERFECT: 'perfect',
  INTRO: 'intro',
  VO: 'vo',
  MUSIC: 'music',
});
/** Superseded inputs are moved here (never deleted): <dir>/_alt/<name>.prev<N><ext>. */
export const ALT_DIR = '_alt';

export const CLI = Object.freeze({
  COMMAND_RUN: 'run',
  COMMAND_INGEST: 'ingest',
  COMMAND_REVIEW: 'review',
  COMMAND_DOCTOR: 'doctor',
  COMMAND_PLAN: 'plan',
  COMMAND_SPEND: 'spend',
  COMMAND_PRESETS: 'presets',
  COMMAND_MIGRATE: 'migrate-kit',
  COMMAND_HELP: 'help',
  FLAG: Object.freeze({
    ONLY: 'only',
    DRY_RUN: 'dry-run',
    OFFLINE: 'offline',
    INPUTS: 'inputs',
    AS: 'as',
    LOCALE: 'locale',
    KIT: 'kit',
    WORK: 'work',
    CAMPAIGN: 'campaign',
    UNTIL: 'until',
    FIRST_UTTERANCE: 'first-utterance',
    KEEP_AUDIO: 'keep-audio',
    INSTALL_FONTS: 'install-fonts',
  }),
});

