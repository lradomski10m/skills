// Consumer layout. Two roots in the consuming project (both configurable):
//   media-kit/                  committed, approved, reusable (brand, voices, copy, campaigns)
//   media-work/<campaign>/      scratch: numbered input folders, renders, review
// Pure: every path is derived from (workRoot, campaign, locale).

import path from 'node:path';
import { DEFAULT_ROOTS, ENV, WORK } from './constants.mjs';

/** Kit and work roots: flag → env → ./media-kit, ./media-work (relative to cwd). Pure given env/cwd. */
export function resolveRoots({ kit = null, work = null } = {}, env = process.env, cwd = process.cwd()) {
  return {
    kitRoot: path.resolve(cwd, kit ?? env[ENV.KIT] ?? DEFAULT_ROOTS.KIT),
    workRoot: path.resolve(cwd, work ?? env[ENV.WORK] ?? DEFAULT_ROOTS.WORK),
  };
}

/** Every directory of one campaign's scratch space. Pure. */
export function workPaths({ workRoot, campaign, locale }) {
  const campaignDir = path.join(workRoot, campaign);
  return {
    workRoot,
    campaignDir,
    /** Shared by every campaign: paid outputs are reused across campaigns by content hash. */
    cacheDir: path.join(workRoot, WORK.CACHE),
    runsDir: path.join(campaignDir, WORK.RUNS),
    stateDir: path.join(campaignDir, WORK.STATE),
    tmpDir: path.join(campaignDir, WORK.TMP),
    voiceDir: path.join(campaignDir, WORK.VOICE, locale),
    stillsDir: path.join(campaignDir, WORK.STILLS),
    clipsDir: path.join(campaignDir, WORK.CLIPS),
    musicDir: path.join(campaignDir, WORK.MUSIC),
    rendersDir: path.join(campaignDir, WORK.RENDERS, locale),
    reviewDir: path.join(campaignDir, WORK.REVIEW, locale),
    readme: path.join(campaignDir, WORK.README),
  };
}

/** A campaign's spec files inside the kit: media-kit/campaigns/<campaign>/<locale>.json. Pure. */
export const kitSpecPath = (kitRoot, campaign, locale) => path.join(kitRoot, 'campaigns', campaign, `${locale}.json`);
