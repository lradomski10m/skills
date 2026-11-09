// The project's media kit (media-kit/ by default), in YAML: brand identity +
// colours + fonts (brand.yaml), voice cast (voices.yaml), per-locale copy
// (copy/<locale>.yaml), project presets (presets/*.md) and templates
// (templates/*.svg). The engine reads only these; the skill uses the rest. Without
// a kit the neutral built-in kit is used, so offline runs and tests work anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_KIT_DIR, FONTS_DIR, KIT } from './constants.mjs';
import { UserError } from './errors.mjs';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const readYaml = (file, fallback) => {
  if (!fs.existsSync(file)) return fallback;
  try {
    return parseYaml(fs.readFileSync(file, 'utf8')) ?? fallback;
  } catch (err) {
    throw new UserError(`media kit: ${file} is not valid YAML (${err.message.split('\n')[0]})`);
  }
};

/** Plain objects merge recursively; arrays and scalars from `over` replace. Pure. */
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

const fontFilesIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(dir, f)) : []);

/** Load a kit directory; anything missing falls back to the built-in kit. */
export function loadKit(root) {
  const useDefault = !root || !fs.existsSync(path.join(root, KIT.BRAND_FILE));
  const dir = useDefault ? DEFAULT_KIT_DIR : root;
  if (!useDefault && fs.existsSync(path.join(root, 'brand', 'brand.json'))) {
    throw new UserError(`media kit at ${root} still has brand/brand.json (0.1.x JSON kit) — convert it with \`cli.mjs migrate-kit\``);
  }
  const fallback = readYaml(path.join(DEFAULT_KIT_DIR, KIT.BRAND_FILE), {});
  const brand = deepMerge(fallback, readYaml(path.join(dir, KIT.BRAND_FILE), {}));
  const at = (rel, base = dir) => (rel ? path.resolve(base, rel) : null);
  const iconFile = brand.icon && fs.existsSync(at(brand.icon)) ? at(brand.icon) : at(fallback.icon, DEFAULT_KIT_DIR);
  const chipFile = brand.chip?.file ? at(brand.chip.file) : null;
  if (chipFile && !fs.existsSync(chipFile)) throw new UserError(`media kit: brand.yaml chip.file not found: ${chipFile}`);
  const fontFiles = (brand.font?.files ?? []).map((f) => at(f));
  for (const f of fontFiles) if (!fs.existsSync(f)) throw new UserError(`media kit: brand.yaml font file not found: ${f}`);
  const voices = readYaml(path.join(dir, KIT.VOICES_FILE), {});
  const copyFor = (locale) => readYaml(path.join(dir, KIT.COPY_DIR, `${locale}.yaml`), {});
  return {
    root: dir,
    isDefault: useDefault,
    brand,
    name: brand.name,
    stampMark: brand.stampMark ?? brand.name?.toLowerCase(),
    url: brand.url ?? null,
    iconFile,
    chip: chipFile ? { file: chipFile, iconBox: brand.chip.iconBox ?? null } : null,
    fontFamily: brand.font?.family ?? null,
    /** Every font file templates may use: the bundled ones, then the kit's. */
    fontFiles: [...fontFilesIn(FONTS_DIR), ...fontFiles],
    /** Directories for the Pango-rendered built-in graphics (fontconfig). */
    fontDirs: [...new Set(fontFiles.map((f) => path.dirname(f)))],
    endCardStyle: brand.endCard?.style ?? null,
    colours: brand.colours ?? {},
    /** Voice roles for a locale: voices["*"] under voices[locale]. */
    voicesFor: (locale) => deepMerge(voices[KIT.ANY_LOCALE] ?? {}, voices[locale] ?? {}),
    copyFor,
    presetsDir: path.join(dir, KIT.PRESETS_DIR),
    templatesDir: path.join(dir, KIT.TEMPLATES_DIR),
    campaignsDir: path.join(root ?? dir, KIT.CAMPAIGNS_DIR),
  };
}

let current = null;
/** The kit graphics/pipeline draw with; the built-in kit until one is set. */
export const kit = () => current ?? (current = loadKit(null));
export const setKit = (k) => {
  current = k;
  return k;
};
