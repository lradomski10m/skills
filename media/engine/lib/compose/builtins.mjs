// Built-in graphics (drawn in code by graphics.mjs) — metadata only: the overlay
// name used in timelines and the default placement. PURE.

import { CONFIG } from '../config.mjs';
import { endCardSheetLayout } from '../endcard-layout.mjs';

const W = CONFIG.render.width;
const brandAt = () => CONFIG.brandBug.marginPx - CONFIG.brandBug.shadowPadPx;

/** Named placement values usable in `place:` (e.g. `y: stampBottom`). */
export const PLACES = Object.freeze({
  hookTop: () => CONFIG.layout.hookTop,
  ruleTop: () => CONFIG.layout.ruleTop,
  stampBottom: () => CONFIG.render.height - CONFIG.layout.stampBottomGap,
  brandBug: brandAt,
  markY: () => CONFIG.layout.markY,
  safeTop: () => CONFIG.layout.safeTop,
  safeBottom: () => CONFIG.layout.safeBottom,
});

export const BUILTINS = Object.freeze({
  hook: { label: () => 'hook', place: () => ({ anchor: 'top', y: CONFIG.layout.hookTop }) },
  'brand-bug': { label: () => 'brand-bug', place: () => ({ anchor: 'top', x: brandAt(), y: brandAt() }) },
  rule: { label: (p) => `pill-${p.shot ?? 'x'}`, place: () => ({ anchor: 'top', y: CONFIG.layout.ruleTop }) },
  mark: { label: (p) => `mark-${p.verdict}`, place: (p) => ({ anchor: 'center', y: CONFIG.layout.markY, ...(p.verdict === 'reject' ? { dx: CONFIG.layout.markDx } : {}) }) },
  stamp: {
    label: (p) => `stamp-${p.verdict}`,
    place: (p) => {
      if (p.on !== 'sheet') return { anchor: 'bottom', y: CONFIG.render.height - CONFIG.layout.stampBottomGap };
      const L = endCardSheetLayout(p.style);
      return { anchor: 'center', y: L.stamp.cy, dx: L.stamp.cx - W / 2 };
    },
  },
  'photo-sheet': {
    label: () => 'photo-sheet',
    place: (p) => {
      const L = endCardSheetLayout(p.style);
      return { anchor: 'top', x: L.sheet.x - L.pad, y: L.sheet.y - L.pad };
    },
  },
  'endcard-full': { label: () => 'endcard-full', place: () => ({ anchor: 'full', y: 0 }) },
  'endcard-base': { label: () => 'endcard-base', place: () => ({ anchor: 'full', y: 0 }) },
});
