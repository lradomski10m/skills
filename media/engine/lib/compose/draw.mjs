// Rendering of timeline graphics to files: built-in graphics (graphics.mjs, sharp),
// SVG templates (resvg; static PNG or a cached animated frame sequence) and PiP masks.
// Every output is cached by a content hash of its inputs.

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CONFIG } from '../config.mjs';
import { END_CARD_STYLE, VERDICT } from '../constants.mjs';
import { endCardSheetLayout, PAPER_STYLE, PRINT_STYLES } from '../endcard-layout.mjs';
import { UserError } from '../errors.mjs';
import * as gfx from '../graphics.mjs';
import { cacheKey } from '../hash.mjs';
import { kit } from '../kit.mjs';
import { animatedFrames, fill, findTemplate, renderSvg, templateMeta } from './templates.mjs';

const R = CONFIG.render;
const SOLVER = { reject: VERDICT.REJECTED, approve: VERDICT.APPROVED, none: VERDICT.APPROVED };
const STAMP_ROTATE = { reject: -8, approve: -6 };

/** Labels for judgement stamps: copy/<locale>.yaml labels, then the storyboard text table. */
function stampLabel(verdict, ctx) {
  const label = ctx.copy?.labels?.[verdict] ?? (ctx.text.has(`labels.${verdict}`) ? ctx.text({ t: `labels.${verdict}` }) : null);
  if (!label) throw new UserError(`no label for the ${verdict} stamp — set labels.${verdict} in media-kit/copy/${ctx.locale}.yaml`);
  return label;
}

/** Text for the real-sheet panel / grid strip. */
function sheetText(params, style) {
  const sheet = params.sheet ?? {};
  if (style === PRINT_STYLES.REAL && !(sheet.tagline && sheet.order && sheet.qrUrl)) {
    throw new UserError(`the ${style} end card needs sheet { tagline, order, qrUrl } (copy/<locale>.yaml endCard.sheet)`);
  }
  return { ...sheet, url: sheet.url ?? `https://${params.url}`, shortUrl: params.url };
}

const stampOf = async (verdict, ctx) =>
  gfx.stampPng({ label: stampLabel(verdict, ctx), brand: kit().stampMark, verdict: SOLVER[verdict], rotateDeg: STAMP_ROTATE[verdict] ?? -6 });

/** PNG buffer for a built-in graphic. */
export async function renderBuiltin(name, p, ctx) {
  switch (name) {
    case 'hook':
      return gfx.hookPng(p.text ?? '');
    case 'brand-bug':
      return gfx.brandChipPng(kit().name);
    case 'rule':
      return gfx.rulePng(p.text ?? '');
    case 'mark':
      return gfx.markPng(SOLVER[p.verdict]);
    case 'stamp': {
      const width = p.on === 'sheet' ? endCardSheetLayout(p.style).stamp.w : p.width ?? CONFIG.layout.stampWidth;
      return gfx.stickerOverlayPng(await stampOf(p.verdict, ctx), width);
    }
    case 'photo-sheet':
      if (p.style === PAPER_STYLE) return gfx.photoSheetPng(p.photos);
      return gfx.printSheetCardPng(p.style, p.photos, { wordmark: p.wordmark ?? kit().name, beforeFile: p.before ?? p.photos[0], text: sheetText(p, p.style) });
    case 'endcard-base': {
      const card = { copy: p.copy, url: p.url, cta: p.cta, ctaHint: p.ctaHint, wordmark: p.wordmark ?? kit().name };
      if (p.grid && p.style === PAPER_STYLE) return gfx.endCardSheetBasePng(card);
      if (p.grid) return gfx.printSheetBasePng(p.style, card);
      return gfx.endCardPng({ ...card, stamp: null, overVideo: Boolean(p.overVideo) });
    }
    case 'endcard-full': {
      const card = { copy: p.copy, url: p.url, cta: p.cta, ctaHint: p.ctaHint, wordmark: p.wordmark ?? kit().name };
      return gfx.endCardPng({ ...card, stamp: await stampOf('approve', ctx), overVideo: Boolean(p.overVideo) });
    }
    default:
      throw new UserError(`unknown built-in graphic ${name}`);
  }
}

/** Template vars: params + kit colours + font family. */
const templateVars = (params) => ({ ...params, colour: { ...CONFIG.colors, ...kit().colours }, font: { family: kit().fontFamily ?? CONFIG.typography.family } });

/**
 * Draw every overlay / graphic segment of a timeline into `gfxDir` (cached under
 * `cacheDir/gfx`), setting `file` (PNG) or `sequence` ({ dir, fps }) on each.
 */
export async function drawTimeline(tl, { gfxDir, cacheDir, ctx, log = () => {} }) {
  await fs.mkdir(gfxDir, { recursive: true });
  const fonts = { fontFiles: kit().fontFiles, family: kit().fontFamily ?? CONFIG.typography.family };
  const cached = async (key, ext, make) => {
    const file = path.join(cacheDir, 'gfx', `${cacheKey('gfx', key).slice(0, 20)}${ext}`);
    if (!fsSync.existsSync(file)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await make(file);
    }
    return file;
  };
  const kitSig = { colours: kit().colours, name: kit().name, stamp: kit().stampMark, icon: kit().iconFile, chip: kit().chip, font: kit().fontFamily, labels: ctx.copy?.labels ?? null };
  for (const [k, o] of tl.overlays.entries()) {
    if (o.kind === 'builtin') {
      o.file = await cached({ b: o.builtin, p: o.params, kitSig, v: 1 }, '.png', async (f) => fs.writeFile(f, await renderBuiltin(o.builtin, o.params, ctx)));
    } else if (o.kind === 'template') {
      const tplFile = findTemplate(o.template, kit().templatesDir);
      const svg = await fs.readFile(tplFile, 'utf8');
      const vars = templateVars(o.params);
      if (o.animate) {
        const dur = o.toSec - o.fromSec;
        const dir = await cached({ svg, vars, a: o.animate, dur, fps: R.fps, fonts: fonts.fontFiles }, '', async (d) => {
          await fs.mkdir(d, { recursive: true });
          const frames = animatedFrames(svg, vars, o.animate, dur, R.fps, o.template);
          for (const [i, s] of frames.entries()) await fs.writeFile(path.join(d, `${String(i).padStart(5, '0')}.png`), renderSvg(s, fonts));
        });
        o.sequence = { dir, fps: R.fps };
        log(`  draw    ${o.template} (${Math.round(dur * R.fps)} frames)`);
      } else {
        o.file = await cached({ svg, vars, fonts: fonts.fontFiles }, '.png', async (f) => fs.writeFile(f, renderSvg(fill(svg, vars, o.template), fonts)));
      }
      const meta = templateMeta(svg);
      if (meta.place && !o.placeFromShot) o.place = { ...meta.place, ...o.place };
    } else if (o.kind === 'pip') {
      const pts = o.quad.map(([x, y]) => `${x},${y}`).join(' ');
      o.mask = await cached({ quad: o.quad, w: R.width, h: R.height }, '.png', async (f) =>
        sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${R.width}" height="${R.height}"><rect width="100%" height="100%" fill="#000"/><polygon points="${pts}" fill="#fff"/></svg>`)).png().toFile(f),
      );
    }
    o.k = k;
  }
  for (const s of tl.segments) {
    if (s.kind === 'card' && !s.backgroundClip) {
      s.graphicFile = await cached({ b: 'endcard-base', p: s.graphic.params, kitSig, v: 1 }, '.png', async (f) => fs.writeFile(f, await renderBuiltin('endcard-base', s.graphic.params, ctx)));
    } else if (s.kind === 'still' && s.graphic) {
      const g = s.graphic;
      s.file = g.template
        ? await cached({ t: g.template, p: g.params }, '.png', async (f) => fs.writeFile(f, renderSvg(fill(await fs.readFile(findTemplate(g.template, kit().templatesDir), 'utf8'), templateVars(g.params), g.template), fonts)))
        : await cached({ b: g.builtin, p: g.params, kitSig }, '.png', async (f) => fs.writeFile(f, await renderBuiltin(g.builtin, g.params, ctx)));
    }
  }
  return tl;
}

export { END_CARD_STYLE };
