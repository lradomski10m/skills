// `doctor`: everything the engine needs, checked locally, with the fix for each
// miss. Accounts and MCP sign-in can't be checked from here — the skill checks
// those by calling the MCP tools (see skills/ad-video/references/setup.md).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ENGINE_ROOT, FONTS_DIR, KIT } from './constants.mjs';
import { CONFIG } from './config.mjs';
import { ffmpegBin, ffprobeBin, REQUIRED_FILTERS } from './media/ffmpeg.mjs';

export const STATUS = Object.freeze({ OK: 'ok', FAIL: 'fail', WARN: 'warn', INFO: 'info' });
const MIN_NODE_MAJOR = 22;
const REQUIRED_ENCODERS = Object.freeze(['libx264', 'aac', 'libmp3lame']);
const DEPS = Object.freeze(['sharp', 'qrcode', 'yaml', '@resvg/resvg-js']);

/** Per-OS install hints for ffmpeg with libass. Pure. */
export function ffmpegHint(platform = process.platform) {
  return (
    {
      darwin: 'brew install ffmpeg-full   (the plain `ffmpeg` formula has no libass → no subtitles filter; the engine prefers ffmpeg-full automatically)',
      linux: 'apt install ffmpeg (Debian/Ubuntu builds include libass) — or a static build from https://johnvansickle.com/ffmpeg/; then check `ffmpeg -filters | grep subtitles`',
      win32: 'winget install Gyan.FFmpeg (the "full" build includes libass) — or https://www.gyan.dev/ffmpeg/builds/; or set MEDIA_FFMPEG / MEDIA_FFPROBE',
    }[platform] ?? 'install an ffmpeg build with libass; or set MEDIA_FFMPEG / MEDIA_FFPROBE'
  );
}

const check = (name, status, detail, fix = null) => ({ name, status, detail, fix });

function checkNode(version = process.versions.node) {
  const major = Number(version.split('.')[0]);
  return major >= MIN_NODE_MAJOR
    ? check('Node.js', STATUS.OK, `v${version}`)
    : check('Node.js', STATUS.FAIL, `v${version} (need ≥ ${MIN_NODE_MAJOR})`, 'https://nodejs.org/ (or nvm install 22)');
}

function checkFfmpeg() {
  const bin = ffmpegBin();
  const filters = spawnSync(bin, ['-hide_banner', '-filters'], { encoding: 'utf8' });
  if (filters.error || filters.status !== 0) return [check('ffmpeg', STATUS.FAIL, `not found (${bin})`, ffmpegHint())];
  const missing = REQUIRED_FILTERS.filter((f) => !new RegExp(`\\s${f}\\s`).test(filters.stdout));
  const encoders = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout ?? '';
  const missingEnc = REQUIRED_ENCODERS.filter((e) => !new RegExp(`\\s${e}\\s`).test(encoders));
  const version = (spawnSync(bin, ['-version'], { encoding: 'utf8' }).stdout ?? '').split('\n')[0];
  const probe = spawnSync(ffprobeBin(), ['-version'], { encoding: 'utf8' });
  return [
    missing.length
      ? check('ffmpeg filters', STATUS.FAIL, `${bin} lacks ${missing.join(', ')}`, ffmpegHint())
      : check('ffmpeg', STATUS.OK, `${version} (${bin}) — libass/subtitles present`),
    missingEnc.length ? check('ffmpeg encoders', STATUS.FAIL, `missing ${missingEnc.join(', ')}`, ffmpegHint()) : check('ffmpeg encoders', STATUS.OK, REQUIRED_ENCODERS.join(', ')),
    probe.error || probe.status !== 0 ? check('ffprobe', STATUS.FAIL, `not found (${ffprobeBin()})`, ffmpegHint()) : check('ffprobe', STATUS.OK, ffprobeBin()),
  ];
}

function checkDeps() {
  const req = createRequire(path.join(ENGINE_ROOT, '..', 'package.json'));
  const missing = DEPS.filter((d) => {
    try {
      req.resolve(d);
      return false;
    } catch {
      return true;
    }
  });
  return missing.length
    ? check('engine dependencies', STATUS.FAIL, `missing ${missing.join(', ')}`, `cd "${path.resolve(ENGINE_ROOT, '..')}" && npm ci   (Claude Code installs them automatically with the plugin)`)
    : check('engine dependencies', STATUS.OK, DEPS.join(', '));
}

function checkFonts(kit) {
  const { file } = CONFIG.render.captionFont;
  const bundled = fs.existsSync(path.join(FONTS_DIR, file));
  const out = [bundled ? check('bundled font', STATUS.OK, `${CONFIG.typography.family} (${FONTS_DIR})`) : check('bundled font', STATUS.FAIL, `missing ${file}`, 'reinstall the plugin')];
  if (kit?.fontFamily) {
    const hasFiles = kit.fontDirs.length > 0;
    out.push(
      hasFiles
        ? check('kit font', STATUS.OK, kit.fontFamily)
        : check('kit font', STATUS.WARN, `brand.yaml names "${kit.fontFamily}" but lists no font.files`, 'add font.files (licence permitting) — templates only use fonts loaded from files'),
    );
  }
  return out;
}

function checkKit(kitRoot, kit) {
  if (!kit || kit.isDefault) {
    return [check('media kit', STATUS.WARN, `none at ${kitRoot} — using the neutral built-in kit`, 'the skill creates one (phase 2: media kit); or pass --kit=<dir> / set MEDIA_KIT')];
  }
  const has = (rel) => fs.existsSync(path.join(kitRoot, rel));
  const parts = [KIT.VOICES_FILE, KIT.COPY_DIR, KIT.CAMPAIGNS_DIR];
  const absent = parts.filter((p) => !has(p));
  const campaigns = has(KIT.CAMPAIGNS_DIR) ? fs.readdirSync(path.join(kitRoot, KIT.CAMPAIGNS_DIR)).filter((d) => has(path.join(KIT.CAMPAIGNS_DIR, d, KIT.STORYBOARD))) : [];
  return [
    check('media kit', STATUS.OK, `${kitRoot} (${kit.name ?? 'unnamed'})`),
    check('brand icon', fs.existsSync(kit.iconFile) ? STATUS.OK : STATUS.FAIL, kit.iconFile),
    check('campaigns', campaigns.length ? STATUS.OK : STATUS.INFO, campaigns.length ? campaigns.join(', ') : 'none yet (media-kit/campaigns/<id>/storyboard.md)'),
    ...(absent.length ? [check('kit parts', STATUS.WARN, `not yet: ${absent.join(', ')}`, 'fine to grow over time — the skill adds what a campaign needs')] : []),
  ];
}

function checkWork(workRoot) {
  // Doesn't create anything: checks the folder, or the nearest existing parent it would be created in.
  let dir = workRoot;
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    const state = dir === workRoot ? 'exists' : 'created on first run';
    return check('work folder', STATUS.OK, `${workRoot} (${state}; keep it out of git)`);
  } catch (err) {
    return check('work folder', STATUS.FAIL, `${dir} not writable: ${err.message}`, 'pass --work=<dir> or set MEDIA_WORK');
  }
}

function checkOptional() {
  const say = process.platform === 'darwin' && !spawnSync('say', ['-v', '?'], { encoding: 'utf8' }).error;
  return [check('offline voice', STATUS.INFO, say ? 'macOS `say` (stand-in VO for --offline and missing lines)' : 'silent stand-in VO (no `say` on this OS)')];
}

/** Run every local check. `kit` is the loaded kit (or null). */
export function runDoctor({ kitRoot, workRoot, kit }) {
  return [checkNode(), ...checkFfmpeg(), checkDeps(), ...checkFonts(kit), ...checkKit(kitRoot, kit), checkWork(workRoot), ...checkOptional()];
}

const ICON = { [STATUS.OK]: '✓', [STATUS.FAIL]: '✗', [STATUS.WARN]: '!', [STATUS.INFO]: '·' };

/** Checklist text. Pure. */
export function formatDoctor(results) {
  const lines = results.flatMap((r) => [`${ICON[r.status]} ${r.name.padEnd(34)} ${r.detail}`, ...(r.fix && r.status !== STATUS.OK ? [`    → ${r.fix}`] : [])]);
  const failed = results.filter((r) => r.status === STATUS.FAIL).length;
  lines.push('', failed ? `${failed} required item(s) missing — fix them, then run doctor again.` : 'Ready. (Accounts + MCP sign-in are checked by the skill.)');
  return lines.join('\n');
}
