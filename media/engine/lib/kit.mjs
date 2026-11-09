// The project's media kit (media-kit/ by default): brand identity, colours,
// fonts, voice cast and per-locale copy. The engine reads only these parts; the
// skill uses the rest (overlays, lines, music, footage, characters). Without a
// kit the neutral built-in kit is used, so offline runs and tests work anywhere.

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_KIT_DIR, KIT } from './constants.mjs';
import { UserError } from './errors.mjs';

const readJson = (file, fallback) => {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UserError(`media kit: ${file} is not valid JSON (${err.message})`);
  }
};

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Plain objects merge recursively; arrays and scalars from `over` replace. Pure. */
export function deepMerge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/**
 * Load a kit directory. Missing brand files fall back to the built-in kit, so a
 * project can start with just brand/brand.json + an icon.
 */
export function loadKit(root) {
  const useDefault = !root || !fs.existsSync(path.join(root, KIT.BRAND_DIR, KIT.BRAND_FILE));
  const dir = useDefault ? DEFAULT_KIT_DIR : root;
  const brandDir = path.join(dir, KIT.BRAND_DIR);
  const fallbackBrand = readJson(path.join(DEFAULT_KIT_DIR, KIT.BRAND_DIR, KIT.BRAND_FILE), {});
  const brand = { ...fallbackBrand, ...readJson(path.join(brandDir, KIT.BRAND_FILE), {}) };
  const colours = {
    ...readJson(path.join(DEFAULT_KIT_DIR, KIT.BRAND_DIR, KIT.COLOURS_FILE), {}),
    ...readJson(path.join(brandDir, KIT.COLOURS_FILE), {}),
  };
  const resolve = (rel, base = brandDir) => (rel ? path.resolve(base, rel) : null);
  const iconFile = fs.existsSync(resolve(brand.icon) ?? '') ? resolve(brand.icon) : resolve(fallbackBrand.icon, path.join(DEFAULT_KIT_DIR, KIT.BRAND_DIR));
  const chipFile = brand.chip?.file ? resolve(brand.chip.file) : null;
  if (chipFile && !fs.existsSync(chipFile)) throw new UserError(`media kit: brand.chip.file not found: ${chipFile}`);
  const cast = readJson(path.join(dir, KIT.CAST_FILE), {});
  const copyFor = (locale) => readJson(path.join(dir, KIT.COPY_DIR, `${locale}.json`), {});
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
    fontDirs: [path.join(brandDir, KIT.FONTS_DIR), ...(brand.font?.dir ? [resolve(brand.font.dir)] : [])],
    endCardStyle: brand.endCard?.style ?? null,
    colours,
    /** Voice roles for a locale: cast["*"] under cast[locale]. */
    voicesFor: (locale) => deepMerge(cast[KIT.ANY_LOCALE] ?? {}, cast[locale] ?? {}),
    /** Engine-relevant copy defaults for a locale (labels, clerkLines, endCard). */
    copyFor,
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

/**
 * Locale defaults a campaign overlay inherits from the kit: the voice cast, and
 * the copy keys the engine renders (labels, clerkLines, endCard CTA/hint/sheet). Pure given kit.
 */
export function kitLocaleDefaults(k, locale) {
  const copy = k.copyFor(locale);
  const pick = (obj, keys) => Object.fromEntries(keys.filter((key) => obj?.[key] !== undefined).map((key) => [key, obj[key]]));
  return {
    voices: k.voicesFor(locale),
    labels: { brand: k.stampMark, ...copy.labels },
    ...(copy.clerkLines ? { clerkLines: copy.clerkLines } : {}),
    endCard: {
      ...(k.url ? { url: k.url } : {}),
      ...(k.name ? { wordmark: k.name } : {}),
      ...(k.endCardStyle ? { style: k.endCardStyle } : {}),
      ...pick(copy.endCard, ['cta', 'ctaHint', 'copy', 'sheet', 'stampAtPhrase']),
    },
  };
}
