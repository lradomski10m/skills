// Inputs inside media-work/<campaign>/ (paths.mjs): voice per locale, visuals
// and music shared by every locale. Paths are pure; `find*` checks the disk. A
// missing file is not an error — the caller falls back to the offline stand-in
// (or skips, for roles marked ifMissing: "skip").

import fs from 'node:fs';
import path from 'node:path';
import { INPUTS } from './constants.mjs';

/** Absolute path of an input, by kind, for one campaign/locale (`paths` from workPaths). Pure. */
export function inputPath(paths) {
  return Object.freeze({
    still: (shotId) => path.join(paths.stillsDir, `${shotId}${INPUTS.STILL_EXT}`),
    clip: (clipId) => path.join(paths.clipsDir, `${clipId}${INPUTS.CLIP_EXT}`),
    /** `<owner>.<part>.mp3` (quokka.line, endcard.announcer, clerk.rejected) or `<owner>.mp3` (hook). */
    vo: (owner, part = null) => path.join(paths.voiceDir, `${owner}${part ? `.${part}` : ''}${INPUTS.VO_EXT}`),
    introStill: (shotId) => path.join(paths.stillsDir, `${shotId}${INPUTS.INTRO_SUFFIX}${INPUTS.STILL_EXT}`),
    introClip: (shotId) => path.join(paths.clipsDir, `${shotId}${INPUTS.INTRO_SUFFIX}${INPUTS.CLIP_EXT}`),
    resultStill: (shotId) => path.join(paths.stillsDir, `${shotId}${INPUTS.RESULT_SUFFIX}${INPUTS.STILL_EXT}`),
    perfectPhoto: (shotId) => path.join(paths.stillsDir, INPUTS.PERFECT_DIR, `${shotId}${INPUTS.STILL_EXT}`),
    music: () => path.join(paths.musicDir, INPUTS.MUSIC_BED),
  });
}

/** Resolver over one campaign's work folders; null = no inputs (every lookup misses). */
export function createInputs(paths) {
  const at = paths ? inputPath(paths) : null;
  const find = (abs) => (abs && fs.existsSync(abs) ? abs : null);
  const lookup = (kind) => (...args) => (at ? find(at[kind](...args)) : null);
  return {
    dir: paths?.campaignDir ?? null,
    enabled: Boolean(paths),
    /** Any file under 3-clips/ (multi-part action parts). */
    clipFile: (rel) => (paths ? find(path.join(paths.clipsDir, rel)) : null),
    still: lookup('still'),
    clip: lookup('clip'),
    vo: lookup('vo'),
    introStill: lookup('introStill'),
    introClip: lookup('introClip'),
    resultStill: lookup('resultStill'),
    perfectPhoto: lookup('perfectPhoto'),
    music: lookup('music'),
  };
}
