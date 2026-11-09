// Text rendering uses fontconfig with the engine's bundled OFL fonts (Inter) plus
// any kit fonts. Must run before sharp renders its first text: it points
// fontconfig at a generated config and forces Pango's fontconfig backend (on
// macOS Pango would otherwise use CoreText and ignore fonts that aren't
// installed system-wide).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FONTS_DIR } from './constants.mjs';

/** Platform font dirs kept as fallbacks (system and user fonts still resolve). */
const SYSTEM_FONT_DIRS = Object.freeze({
  darwin: ['/System/Library/Fonts', '/Library/Fonts', path.join(os.homedir(), 'Library', 'Fonts')],
  linux: ['/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.local', 'share', 'fonts')],
  win32: [path.join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts')],
});

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** fonts.conf text: bundled fonts, extra (kit) dirs, then the system dirs. Pure. */
export function fontsConf(dirs, cacheDir) {
  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    ...dirs.map((d) => `  <dir>${xml(d)}</dir>`),
    `  <cachedir>${xml(cacheDir)}</cachedir>`,
    '</fontconfig>',
    '',
  ].join('\n');
}

let configured = null;

/** Point fontconfig/Pango at bundled + kit fonts. Idempotent; returns the conf path. */
export function setupFonts({ extraDirs = [], cacheDir = path.join(os.tmpdir(), 'media-engine-fontconfig') } = {}) {
  if (configured) return configured;
  const dirs = [FONTS_DIR, ...extraDirs.filter((d) => fs.existsSync(d)), ...(SYSTEM_FONT_DIRS[process.platform] ?? []).filter((d) => fs.existsSync(d))];
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, 'fonts.conf');
  fs.writeFileSync(file, fontsConf(dirs, path.join(cacheDir, 'cache')));
  process.env.FONTCONFIG_FILE = file;
  process.env.PANGOCAIRO_BACKEND = 'fc';
  configured = file;
  return file;
}
