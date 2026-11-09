import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CONFIG } from '../lib/config.mjs';
import { endCardSheetLayout, PRINT_STYLES, photoSheetLayout, printSheetLayout } from '../lib/endcard-layout.mjs';

describe('photo-sheet end card layout', () => {
  const L = photoSheetLayout();
  const { width: W, height: H } = CONFIG.render;
  const ps = CONFIG.photoSheet;

  it('makes the sheet (the group photo) the majority of the screen: wide and as tall as fits', () => {
    assert.ok(L.sheet.w / W >= 0.8 && L.sheet.w / W <= ps.maxWidthFrac + 0.001, `width ${(L.sheet.w / W).toFixed(2)}`);
    assert.ok(L.sheet.h / H >= 0.65, `height ${(L.sheet.h / H).toFixed(2)}`);
    assert.ok(Math.abs(L.sheet.w / L.sheet.h - 2 / 3) < 0.01, '10×15 portrait');
    assert.equal(L.sheet.x, Math.round((W - L.sheet.w) / 2));
  });

  it('starts near the top, below a small logo row', () => {
    assert.ok(L.logo.y < 100);
    assert.ok(L.sheet.y >= L.logo.y + L.logo.h && L.sheet.y < 220, `sheet top ${L.sheet.y}`);
  });

  it('lays out a 2×2 grid of 35×45 cells inside the sheet margins, no overlaps', () => {
    assert.equal(L.cells.length, 4);
    for (const c of L.cells) {
      assert.ok(Math.abs(c.w / c.h - 35 / 45) < 0.01, 'passport proportions');
      assert.ok(c.x >= ps.marginPx && c.y >= ps.marginPx && c.x + c.w <= L.sheet.w - ps.marginPx && c.y + c.h <= L.sheet.h - ps.marginPx);
    }
    assert.ok(L.cells[0].x + L.cells[0].w < L.cells[1].x && L.cells[0].y + L.cells[0].h < L.cells[2].y);
  });

  it('puts the approve stamp across the sheet bottom edge, below the faces of the bottom row', () => {
    const bottomRow = L.cells[2];
    const facesEnd = L.sheet.y + bottomRow.y + bottomRow.h * 0.6;
    assert.ok(L.stamp.cy - L.stamp.h / 2 > facesEnd, `stamp top ${L.stamp.cy - L.stamp.h / 2} vs faces ${facesEnd}`);
    assert.ok(L.stamp.cy < L.sheet.y + L.sheet.h && L.stamp.cy + L.stamp.h / 2 > L.sheet.y + L.sheet.h, 'straddles the edge');
    assert.ok(Math.abs(L.stamp.w - ps.stampWidthFrac * L.sheet.w) <= 1, 'stamp scales with the sheet');
  });

  it('keeps CTA + hint compact below the stamp, down to bottomMarginPx above the frame edge', () => {
    assert.ok(L.cta.y >= L.stamp.cy + L.stamp.h / 2, 'CTA below the stamp overhang');
    assert.ok(L.hint.y >= L.cta.y + L.cta.h);
    assert.equal(L.bottomLimit, H - ps.bottomMarginPx, 'end card ignores the bottom platform-UI zone (config)');
    assert.ok(L.bottom <= L.bottomLimit, `bottom ${L.bottom}`);
  });

  it('respects the bottom safe line when ignoreBottomSafe is off (smaller sheet)', () => {
    const safe = photoSheetLayout({ ...ps, ignoreBottomSafe: false });
    assert.equal(safe.bottomLimit, CONFIG.layout.safeBottom);
    assert.ok(safe.bottom <= CONFIG.layout.safeBottom);
    assert.ok(safe.sheet.h < L.sheet.h);
  });
});

describe('printSheetLayout (real print-sheet styles, untilted)', () => {
  const styles = Object.values(PRINT_STYLES);
  const R = CONFIG.render;

  it('every style fits: CTA above the bottom margin, sheet inside the frame', () => {
    for (const s of styles) {
      const L = printSheetLayout(s);
      assert.ok(L.cta.y + L.cta.h <= L.bottomLimit, s);
      assert.ok(L.sheet.x >= 0 && L.sheet.x + L.sheet.w <= R.width, s);
      assert.ok(L.cta.y >= L.sheet.y + L.sheet.h, `${s}: CTA below the sheet`);
    }
  });

  it('cells are 35×45 (±1 px) and inside the sheet', () => {
    for (const s of styles) {
      const L = printSheetLayout(s);
      for (const c of L.cells) {
        assert.ok(Math.abs(c.h - c.w * 45 / 35) <= 1, s);
        assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= L.sheet.w && c.y + c.h <= L.sheet.h, s);
      }
    }
  });

  it('the stamp straddles the bottom of the photo grid (below the faces)', () => {
    for (const s of styles) {
      const L = printSheetLayout(s);
      const gridBottom = L.sheet.y + Math.max(...L.cells.map((c) => c.y + c.h));
      assert.equal(L.stamp.cy, gridBottom, s);
    }
  });

  it('real has no logo row (the panel carries the brand); clean/strip do', () => {
    assert.equal(printSheetLayout(PRINT_STYLES.REAL).logo, null);
    assert.equal(printSheetLayout(PRINT_STYLES.REAL).panel.kind, 'panel');
    assert.equal(printSheetLayout(PRINT_STYLES.CLEAN).panel, null);
    assert.equal(printSheetLayout(PRINT_STYLES.STRIP).panel.kind, 'strip');
    assert.ok(printSheetLayout(PRINT_STYLES.CLEAN).logo);
  });

  it('with a brand band, the stamp sits right of the left-aligned wordmark', () => {
    for (const s of [PRINT_STYLES.REAL, PRINT_STYLES.STRIP]) {
      const L = printSheetLayout(s);
      assert.ok(L.stamp.cx - L.stamp.w / 2 > L.sheet.x + L.sheet.w * 0.4, s);
    }
  });

  it('rejects an unknown style', () => {
    assert.throws(() => printSheetLayout('tilted'), /unknown print-sheet style/);
  });
});

describe('endCardSheetLayout', () => {
  it('serves the paper layout or a print-sheet layout with a shadow pad', () => {
    assert.deepEqual(endCardSheetLayout('tilted').sheet, photoSheetLayout().sheet);
    const L = endCardSheetLayout('real-sheet');
    assert.equal(L.style, 'real-sheet');
    assert.ok(L.pad > 0 && L.sheet.x - L.pad >= 0);
  });
});
