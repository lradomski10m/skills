// Run naming, shared by `run` (output names) and `review` (finding a run's output).

import { PROVIDER } from './constants.mjs';

/** <spec-id>[.<shot>][.inputs|.offline] — the work/out/*.mp4 and work/runs/* name. Pure. */
export function runNameFor(specId, { onlyShot = null, inputs = false, offline = false } = {}) {
  const suffix = [onlyShot, inputs ? PROVIDER.INPUTS : offline && PROVIDER.OFFLINE].filter(Boolean).join('.');
  return suffix ? `${specId}.${suffix}` : specId;
}
