// Photo-sheet end card layout. PURE: the one source of positions for both the
// graphics (sharp) and the timeline (overlay coordinates).
//
// Top to bottom: small logo row → the sheet, as tall as fits (≤ maxWidthFrac
// of the width) → CTA → hint, which may reach bottomMarginPx above the frame
// edge when ignoreBottomSafe (else layout.safeBottom). The approve stamp straddles
// the sheet's bottom edge; the CTA starts below its overhang.

import { CONFIG } from './config.mjs';
import { END_CARD_STYLE } from './constants.mjs';

/**
 * Rows have fixed configured heights; graphics centres the rendered text in
 * them. So the sheet geometry used by the timeline (sheet + stamp overlays) and
 * by the card base is always the same.
 */
export function photoSheetLayout(ps = CONFIG.photoSheet, r = CONFIG.render, layout = CONFIG.layout) {
  const ctaH = ps.ctaRowPx;
  const hintH = ps.hintRowPx;
  const logo = { y: ps.logoTopPx, h: ps.logoRowPx };
  const bottomLimit = ps.ignoreBottomSafe ? r.height - ps.bottomMarginPx : layout.safeBottom;

  const sheetY = logo.y + logo.h + ps.logoToSheetGapPx;
  // Everything below the sheet: the stamp's overhang past the bottom edge, then CTA + hint.
  const overhangFrac = (h) => Math.max(0, ps.stampCenterFrac * h + (ps.stampWidthFrac * h * ps.aspect * ps.stampAspect) / 2 - h);
  const below = ps.ctaGapPx + ctaH + ps.hintGapPx + hintH;
  // Tallest sheet with sheetY + h + overhang(h) + below ≤ bottomLimit, and width ≤ maxWidthFrac·W.
  const perH = 1 + overhangFrac(1);
  let sheetH = Math.floor((bottomLimit - sheetY - below) / perH);
  sheetH = Math.min(sheetH, Math.floor((ps.maxWidthFrac * r.width) / ps.aspect));
  const sheetW = Math.round(sheetH * ps.aspect);
  const sheet = { x: Math.round((r.width - sheetW) / 2), y: sheetY, w: sheetW, h: sheetH };

  // 2×2 grid of 35×45 cells, as large as the sheet allows, centred.
  const innerW = sheetW - 2 * ps.marginPx;
  const innerH = sheetH - 2 * ps.marginPx;
  let cellW = (innerW - ps.gapPx) / 2;
  let cellH = cellW / ps.cellAspect;
  if (2 * cellH + ps.gapPx > innerH) {
    cellH = (innerH - ps.gapPx) / 2;
    cellW = cellH * ps.cellAspect;
  }
  cellW = Math.floor(cellW);
  cellH = Math.floor(cellH);
  const gx = Math.round((sheetW - (2 * cellW + ps.gapPx)) / 2);
  const gy = Math.round((sheetH - (2 * cellH + ps.gapPx)) / 2);
  const cells = [0, 1, 2, 3].map((k) => ({
    x: gx + (k % 2) * (cellW + ps.gapPx),
    y: gy + Math.floor(k / 2) * (cellH + ps.gapPx),
    w: cellW,
    h: cellH,
  }));

  const stampW = Math.round(ps.stampWidthFrac * sheetW);
  const stamp = { cx: Math.round(r.width / 2), cy: Math.round(sheet.y + sheet.h * ps.stampCenterFrac), w: stampW, h: Math.round(stampW * ps.stampAspect) };
  const ctaY = Math.max(sheet.y + sheet.h, stamp.cy + stamp.h / 2) + ps.ctaGapPx;
  const hintY = ctaY + ctaH + ps.hintGapPx;

  return {
    sheet,
    cells,
    pad: ps.padPx,
    stamp,
    logo,
    cta: { y: Math.round(ctaY), h: ctaH },
    hint: { y: Math.round(hintY), h: hintH },
    bottom: Math.round(hintY + hintH),
    bottomLimit,
  };
}

const PRINT_STYLES = Object.freeze({ REAL: END_CARD_STYLE.REAL_SHEET, CLEAN: END_CARD_STYLE.GRID, STRIP: END_CARD_STYLE.GRID_STRIP });
export { PRINT_STYLES };

/**
 * Real-print-sheet end card layouts (styles real / clean / strip), never
 * tilted. Pure. Positions: card-absolute for sheet/stamp/rows, sheet-relative
 * for cells and the panel/strip.
 */
/** Narrowing step when the sheet doesn't fit above the CTA (widthFrac shrinks until it does). */
const FIT_STEP = 0.01;

export function printSheetLayout(style, ps = CONFIG.printSheet, r = CONFIG.render) {
  if (!Object.values(PRINT_STYLES).includes(style)) throw new Error(`unknown print-sheet style ${style}`);
  // Largest sheet (≤ widthFrac) whose CTA still ends above the bottom margin.
  for (let frac = ps.widthFrac; frac > 0.5; frac -= FIT_STEP) {
    const L = layoutAt(style, frac, ps, r);
    if (L.cta.y + L.cta.h <= L.bottomLimit) return L;
  }
  throw new Error(`print-sheet style ${style} does not fit the frame`);
}

function layoutAt(style, widthFrac, ps, r) {
  const hasLogoRow = style !== PRINT_STYLES.REAL;
  const logo = hasLogoRow ? { y: ps.logoTopPx, h: ps.logoRowPx } : null;
  const sheetW = Math.round(widthFrac * r.width);
  const cellW = Math.floor((sheetW - 2 * ps.marginPx - ps.gapPx) / 2);
  const cellH = Math.floor(cellW / ps.cellAspect);
  const gridW = 2 * cellW + ps.gapPx;
  const gx = Math.round((sheetW - gridW) / 2);
  const gy = ps.marginPx;
  const cells = [0, 1, 2, 3].map((k) => ({ x: gx + (k % 2) * (cellW + ps.gapPx), y: gy + Math.floor(k / 2) * (cellH + ps.gapPx), w: cellW, h: cellH }));
  const gridBottom = gy + 2 * cellH + ps.gapPx;
  const band =
    style === PRINT_STYLES.REAL ? { kind: 'panel', h: ps.panel.heightPx } : style === PRINT_STYLES.STRIP ? { kind: 'strip', h: ps.strip.heightPx } : null;
  const panel = band ? { kind: band.kind, x: gx, y: gridBottom + ps.gapPx, w: gridW, h: band.h } : null;
  const sheetH = (panel ? panel.y + panel.h : gridBottom) + ps.marginPx;
  const sheetY = hasLogoRow ? logo.y + logo.h + ps.logoToSheetGapPx : ps.topPxNoLogo;
  const sheet = { x: Math.round((r.width - sheetW) / 2), y: sheetY, w: sheetW, h: sheetH };

  // the approve stamp straddles the photo grid's bottom edge (below every face).
  const st = ps.stampByStyle?.[style] ?? { widthFrac: ps.stampWidthFrac, cxFrac: 0.5 };
  const stampW = Math.round(st.widthFrac * sheetW);
  const stamp = { cx: Math.round(sheet.x + st.cxFrac * sheetW), cy: sheet.y + gridBottom, w: stampW, h: Math.round(stampW * ps.stampAspect) };
  const ctaY = Math.max(sheet.y + sheet.h, stamp.cy + stamp.h / 2) + ps.ctaGapPx;
  const bottomLimit = r.height - ps.bottomMarginPx;
  const hintY = ctaY + ps.ctaRowPx + ps.hintGapPx;
  // The hint is dropped when it would cross the bottom margin (the real sheet is tall).
  const hint = hintY + ps.hintRowPx <= bottomLimit ? { y: hintY, h: ps.hintRowPx } : null;
  const cta = { y: ctaY, h: ps.ctaRowPx };
  // pad = transparent shadow margin around the sheet graphic (the overlay is placed at sheet - pad).
  return { style, pad: Math.ceil(ps.shadowBlur * 3), logo, sheet, cells, panel, stamp, cta, hint, bottom: hint ? hint.y + hint.h : cta.y + cta.h, bottomLimit };
}

/** The tilted 10×15 photo sheet (photoSheetLayout); the other grid styles are untilted print sheets. */
export const PAPER_STYLE = END_CARD_STYLE.TILTED;

/** End-card sheet geometry for a grid style: { sheet, pad, stamp{cx,cy,w} } in every case. Pure. */
export function endCardSheetLayout(style = CONFIG.endCardStyle) {
  return style === PAPER_STYLE ? photoSheetLayout() : printSheetLayout(style);
}
