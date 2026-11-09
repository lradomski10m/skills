// `migrate-kit`: convert a 0.1.x JSON media kit (brand/brand.json, colours.json,
// voices/cast.json, copy/*.json, campaigns/<id>/{base,<locale>}.json) to the 0.2 YAML
// kit and one storyboard.md per campaign. The JSON files move to _alt/0.1.x/ (never
// deleted). Idempotent: nothing to do once brand.yaml exists.

import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { KIT } from './constants.mjs';
import { UserError } from './errors.mjs';

const ALT = path.join('_alt', '0.1.x');
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const yaml = (o) => stringify(o, { lineWidth: 0 });
const lineText = (l) => (l == null ? null : typeof l === 'string' ? l : l.text);
const lineTts = (l) => (l == null ? null : typeof l === 'string' ? null : l.tts ?? null);
const cellEsc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Old campaign JSON (base + overlays) → storyboard.md text. Pure. */
export function storyboardFromJson(id, base, overlays) {
  const locales = Object.keys(overlays);
  const first = overlays[locales[0]];
  const announcer = locales.some((l) => overlays[l].endCard?.announcer);
  const hookVo = locales.some((l) => overlays[l].hook?.vo);
  const front = {
    campaign: base.campaign ?? id,
    title: (base.title ?? first.title ?? id).replace(/\s*\((pl|en-us|[a-z]{2}(-[a-z]{2})?)\)\s*$/i, ''),
    locales,
    ...(base.source ? { source: base.source } : {}),
    tempo: base.tempo ?? 'snappy',
    cuts: { sfx: 'whoosh' },
    hook: { text: { t: 'hook' }, ...(hookVo ? { line: 'hook' } : {}), duration: base.hook?.durationSec ?? 2 },
    brandBug: { from: 0 },
    ...(base.music !== null && base.music !== undefined ? { music: { bed: base.music.file ? base.music.file.replace(/\.mp3$/, '') : 'bed', ...Object.fromEntries(['levelDb', 'duckDb'].filter((k) => base.music[k] !== undefined).map((k) => [k, base.music[k]])) } } : {}),
    end: {
      preset: base.endCard?.style ? `end-card-${base.endCard.style}` : 'end-card',
      ...(announcer ? { line: 'endcard.announcer' } : {}),
      copy: { t: 'endcard.copy' },
      ...(locales.some((l) => overlays[l].endCard?.stampAtPhrase) ? { stampAtPhrase: { t: 'endcard.stampAtPhrase' } } : {}),
      minDuration: base.endCard?.durationSec ?? 3,
    },
    captions: Boolean(base.captions),
  };
  const rows = [];
  const tts = [];
  const add = (key, get, getTts = null) => {
    const vals = locales.map((l) => get(overlays[l]));
    if (vals.every((v) => v == null)) return;
    rows.push([key, ...vals]);
    if (getTts) {
      const t = locales.map((l) => getTts(overlays[l]));
      if (t.some(Boolean)) tts.push([key, ...t]);
    }
  };
  add('hook', (o) => o.hook?.text);
  if (hookVo) tts.push(['hook', ...locales.map((l) => lineTts(overlays[l].hook?.vo) ?? lineText(overlays[l].hook?.vo))]);
  for (const s of base.shots) {
    add(`${s.id}.caption`, (o) => o.shots?.[s.id]?.caption);
    add(`${s.id}.line`, (o) => lineText(o.shots?.[s.id]?.vo?.line), (o) => lineTts(o.shots?.[s.id]?.vo?.line));
    add(`${s.id}.quip`, (o) => lineText(o.shots?.[s.id]?.vo?.quip), (o) => lineTts(o.shots?.[s.id]?.vo?.quip));
  }
  add('endcard.announcer', (o) => lineText(o.endCard?.announcer), (o) => lineTts(o.endCard?.announcer));
  add('endcard.copy', (o) => o.endCard?.copy);
  add('endcard.stampAtPhrase', (o) => o.endCard?.stampAtPhrase);
  const table = (header, list) => [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...list.map((r) => `| ${r.map(cellEsc).join(' | ')} |`)];
  const out = ['---', yaml(front).trim(), '---', '', `# ${front.title}`, '', 'Migrated from the 0.1.x JSON specs. Prose is for people and agents; the engine reads the front matter, the `## Text` table and each shot\'s yaml block.', ''];
  out.push('## Text', '', ...table(['key', ...locales], rows), '');
  if (tts.length) out.push('## Voice scripts', '', 'Generation text for each line (emotion tags, spoken URLs) — used when generating voices; the engine ignores this table.', '', ...table(['key', ...locales], tts), '');
  for (const s of base.shots) {
    const title = locales.map((l) => overlays[l].shots?.[s.id]?.caption).find(Boolean) ?? s.id;
    const fields = {
      preset: s.verdict === 'approved' ? 'action-verdict' : 'action-verdict',
      // 0.1.x joined `action` parts (even a single one) frame-accurately; a list keeps that.
      clip: s.action?.length ? s.action.map((p) => (p.in || p.out != null ? { file: p.file.replace(/\.mp4$/, ''), ...(p.in ? { in: p.in } : {}), ...(p.out != null ? { out: p.out } : {}) } : p.file.replace(/\.mp4$/, ''))) : s.id,
      ...(s.result !== false ? { result: `${s.id}.result` } : {}),
      ...(s.beat && s.beat !== 'action' ? { beat: s.beat } : {}),
      ...(s.flash && s.flash !== 'auto' ? { flash: s.flash } : {}),
      ...(s.verdict === 'approved' ? { verdict: 'approve' } : {}),
      line: `${s.id}.line`,
      ...(locales.some((l) => overlays[l].shots?.[s.id]?.vo?.quip) ? { quip: `${s.id}.quip` } : {}),
      caption: { t: `${s.id}.caption` },
      ...(base.ruleCaptions ? { rulePill: true } : {}),
    };
    out.push(`## Shot ${s.id} — ${title}`, '');
    if (s.subject) out.push(`Subject: ${s.subject}.`, '');
    if (s.videoPrompt) out.push(`Clip prompt: ${s.videoPrompt}`, '');
    out.push('```yaml', yaml(fields).trim(), '```', '');
  }
  return out.join('\n');
}

const copyYaml = (c) => {
  const { labels, clerkLines, endCard, ...rest } = c;
  return {
    ...(labels ? { labels: { reject: labels.rejected ?? labels.reject, approve: labels.approved ?? labels.approve } } : {}),
    ...(clerkLines ? { clerk: { reject: clerkLines.rejected, approve: clerkLines.approved } } : {}),
    ...(endCard ? { endCard } : {}),
    ...rest,
  };
};

export async function migrateKit({ kitRoot, log = console.log }) {
  const at = (...p) => path.join(kitRoot, ...p);
  if (fs.existsSync(at(KIT.BRAND_FILE))) {
    log(`${at(KIT.BRAND_FILE)} exists — nothing to migrate.`);
    return { migrated: false };
  }
  if (!fs.existsSync(at('brand', 'brand.json'))) throw new UserError(`no 0.1.x kit at ${kitRoot} (brand/brand.json missing)`);
  const moved = [];
  const retire = (rel) => {
    const dst = at(ALT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(at(rel), dst);
    moved.push(rel);
  };
  const brand = readJson(at('brand', 'brand.json'));
  const colours = fs.existsSync(at('brand', 'colours.json')) ? readJson(at('brand', 'colours.json')) : {};
  const rel = (f) => (f ? path.posix.join('brand', f) : null);
  const brandYaml = {
    name: brand.name,
    stampMark: brand.stampMark,
    url: brand.url,
    icon: rel(brand.icon),
    chip: brand.chip ? { file: rel(brand.chip.file), ...(brand.chip.iconBox ? { iconBox: brand.chip.iconBox } : {}) } : null,
    ...(brand.font ? { font: { family: brand.font.family, files: [] } } : {}),
    endCard: brand.endCard ?? { style: 'grid' },
    colours,
  };
  fs.writeFileSync(at(KIT.BRAND_FILE), `# Brand identity for videos (engine: media@lradomski-skills). Migrated from brand/brand.json + colours.json.\n${yaml(brandYaml)}`);
  retire(path.join('brand', 'brand.json'));
  if (fs.existsSync(at('brand', 'colours.json'))) retire(path.join('brand', 'colours.json'));
  if (fs.existsSync(at('voices', 'cast.json'))) {
    fs.writeFileSync(at(KIT.VOICES_FILE), `# Voice cast per locale ("*" = every locale). Migrated from voices/cast.json.\n${yaml(readJson(at('voices', 'cast.json')))}`);
    retire(path.join('voices', 'cast.json'));
  }
  if (fs.existsSync(at('copy'))) {
    for (const f of fs.readdirSync(at('copy')).filter((x) => x.endsWith('.json'))) {
      fs.writeFileSync(at('copy', f.replace(/\.json$/, '.yaml')), yaml(copyYaml(readJson(at('copy', f)))));
      retire(path.join('copy', f));
    }
  }
  if (fs.existsSync(at(KIT.CAMPAIGNS_DIR))) {
    for (const id of fs.readdirSync(at(KIT.CAMPAIGNS_DIR))) {
      const dir = at(KIT.CAMPAIGNS_DIR, id);
      if (!fs.existsSync(path.join(dir, 'base.json'))) continue;
      const base = readJson(path.join(dir, 'base.json'));
      const overlays = Object.fromEntries(
        fs.readdirSync(dir).filter((f) => /^[a-z]{2}(-[a-z]{2})?\.json$/.test(f)).map((f) => [f.replace(/\.json$/, ''), readJson(path.join(dir, f))]),
      );
      fs.writeFileSync(path.join(dir, KIT.STORYBOARD), storyboardFromJson(id, base, overlays));
      retire(path.join(KIT.CAMPAIGNS_DIR, id, 'base.json'));
      for (const l of Object.keys(overlays)) retire(path.join(KIT.CAMPAIGNS_DIR, id, `${l}.json`));
      log(`  campaign ${id}: storyboard.md (${Object.keys(overlays).join(', ')})`);
    }
  }
  log(`migrated ${kitRoot}: brand.yaml, voices.yaml, copy/*.yaml, campaigns/*/storyboard.md; old files in ${ALT}/ (${moved.length})`);
  return { migrated: true, moved };
}
