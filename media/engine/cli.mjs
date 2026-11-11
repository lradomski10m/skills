#!/usr/bin/env node
// Composition engine CLI — a campaign storyboard in, a finished 9:16 MP4 out.
//
//   cli.mjs doctor
//   cli.mjs run <campaign | storyboard.md> --locale=<l> [--offline] [--dry-run] [--only=<shot>]
//   cli.mjs plan <campaign | storyboard.md> --locale=<l>          resolve the timeline, print it, no render
//   cli.mjs review <campaign | storyboard.md> --locale=<l> [--offline]
//   cli.mjs ingest <url|file> --campaign=<id> --as=<kind>:<target> [--locale=<l>] [--until=<sec>] [--first-utterance] [--keep-audio]
//   cli.mjs spend --campaign=<id> --item="<what>" --usd=<n> [--via=<tool>]
//   cli.mjs presets                                               built-in + kit presets with their params
//   cli.mjs migrate-kit                                           0.1.x JSON kit + specs → YAML + storyboard.md
// Common: --kit=<dir> (default ./media-kit, env MEDIA_KIT), --work=<dir> (default ./media-work, env MEDIA_WORK)
//
// Fonts are configured (fonts.mjs) before any module that loads sharp is imported.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CLI, KIT } from './lib/constants.mjs';
import { UserError } from './lib/errors.mjs';
import { setupFonts } from './lib/fonts.mjs';
import { loadKit, setKit } from './lib/kit.mjs';
import { resolveRoots, workPaths } from './lib/paths.mjs';

const F = CLI.FLAG;
const C = CLI;

const USAGE = `Usage: cli.mjs <command> [options]

  doctor                                    check Node, ffmpeg (+libass), deps, fonts, media kit, work folder
  run <campaign | storyboard.md>            assemble one video from media-work/<campaign>/ (free; missing inputs → stand-ins)
      --${F.LOCALE}=<code>  --${F.OFFLINE} (stand-ins for everything)  --${F.DRY_RUN} (validate + plan only)  --${F.ONLY}=<shot>
  plan <campaign | storyboard.md> --${F.LOCALE}=<code>   resolve the timeline and print it (no render)
  review <campaign | storyboard.md> --${F.LOCALE}=<code> [--${F.OFFLINE}]
      rebuild media-work/<campaign>/review/<locale>/ (numbered shot folders, key frames, end card, video)
  ingest <url|file> --${F.CAMPAIGN}=<id> --${F.AS}=<kind>:<target> [--${F.LOCALE}=<code>]
      kinds: clip:<id> | still:<key> | result:<shot> | perfect:<shot> | intro:<shot> | vo:<key> | music[:<name>]
      → 1-voice/<locale>/, 2-stills/, 3-clips/, 4-music/; a replaced file moves to _alt/
      clips are normalised (CFR at the render fps, untagged colour, yuv420p, no audio; --${F.KEEP_AUDIO} keeps a dialogue clip's sound)
      vo only: --${F.UNTIL}=<sec> (cut + fade)  --${F.FIRST_UTTERANCE} (keep the first reading of a repeated line)
  spend --${F.CAMPAIGN}=<id> --item="<what>" --usd=<n> [--via=<tool>]   log a generation paid through an MCP tool
  presets                                   list presets (built-in + media-kit/presets) with their params
  migrate-kit                               convert a 0.1.x JSON media kit + campaign specs to YAML + storyboard.md

  --${F.KIT}=<dir>   media kit (default ./media-kit, env MEDIA_KIT)
  --${F.WORK}=<dir>  scratch root (default ./media-work, env MEDIA_WORK)`;

const COMMANDS = [C.COMMAND_RUN, C.COMMAND_PLAN, C.COMMAND_INGEST, C.COMMAND_REVIEW, C.COMMAND_DOCTOR, C.COMMAND_SPEND, C.COMMAND_PRESETS, C.COMMAND_MIGRATE];
const NEEDS_TARGET = [C.COMMAND_RUN, C.COMMAND_PLAN, C.COMMAND_INGEST, C.COMMAND_REVIEW];

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      [F.OFFLINE]: { type: 'boolean', default: false },
      [F.INPUTS]: { type: 'boolean', default: false },
      [F.DRY_RUN]: { type: 'boolean', default: false },
      [F.ONLY]: { type: 'string' },
      [F.AS]: { type: 'string' },
      [F.LOCALE]: { type: 'string' },
      [F.KIT]: { type: 'string' },
      [F.WORK]: { type: 'string' },
      [F.CAMPAIGN]: { type: 'string' },
      [F.UNTIL]: { type: 'string' },
      [F.FIRST_UTTERANCE]: { type: 'boolean', default: false },
      [F.KEEP_AUDIO]: { type: 'boolean', default: false },
      item: { type: 'string' },
      usd: { type: 'string' },
      via: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, target] = positionals;
  if (values.help || !COMMANDS.includes(command) || (NEEDS_TARGET.includes(command) && !target)) return { help: true };
  return { command, target, values };
}

/** A storyboard path, or a campaign id resolved inside the kit. */
function resolveStoryboard(target, kitRoot) {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  const file = path.join(kitRoot, KIT.CAMPAIGNS_DIR, target, KIT.STORYBOARD);
  if (!fs.existsSync(file)) throw new UserError(`no storyboard at ${file} (pass a campaign id from media-kit/campaigns/ or a storyboard.md path)`);
  return file;
}

async function main() {
  const parsed = parse(process.argv.slice(2));
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  const { command, target, values } = parsed;
  const { kitRoot, workRoot } = resolveRoots({ kit: values[F.KIT], work: values[F.WORK] });

  if (command === C.COMMAND_MIGRATE) {
    const { migrateKit } = await import('./lib/migrate.mjs');
    await migrateKit({ kitRoot });
    return 0;
  }
  const kit = setKit(loadKit(kitRoot));
  setupFonts({ extraDirs: kit.fontDirs });

  if (command === C.COMMAND_DOCTOR) {
    const { runDoctor, formatDoctor, STATUS } = await import('./lib/doctor.mjs');
    const results = runDoctor({ kitRoot, workRoot, kit });
    console.log(formatDoctor(results));
    return results.some((r) => r.status === STATUS.FAIL) ? 1 : 0;
  }
  if (command === C.COMMAND_PRESETS) {
    const { describePresets, loadPresets } = await import('./lib/compose/presets.mjs');
    console.log(describePresets(loadPresets(kit.presetsDir)));
    return 0;
  }
  if (command === C.COMMAND_SPEND) {
    if (!values[F.CAMPAIGN] || !values.item || !(Number(values.usd) >= 0)) throw new UserError(`spend needs --${F.CAMPAIGN}, --item and --usd`);
    const { appendSpend } = await import('./lib/readme.mjs');
    await appendSpend(workPaths({ workRoot, campaign: values[F.CAMPAIGN], locale: '' }), [{ item: values.item, usd: Number(values.usd), via: values.via ?? 'mcp' }]);
    console.log(`logged $${Number(values.usd).toFixed(3)} · ${values.item}`);
    return 0;
  }
  if (command === C.COMMAND_INGEST) {
    if (!values[F.CAMPAIGN]) throw new UserError(`ingest needs --${F.CAMPAIGN}=<id>`);
    const { ingest } = await import('./lib/ingest.mjs');
    if (String(values[F.AS] ?? '').startsWith('vo:') && !values[F.LOCALE]) throw new UserError(`ingest of a voice line needs --${F.LOCALE}=<code>`);
    const until = values[F.UNTIL] === undefined ? null : Number(values[F.UNTIL]);
    await ingest({
      source: target,
      paths: workPaths({ workRoot, campaign: values[F.CAMPAIGN], locale: values[F.LOCALE] ?? '' }),
      as: values[F.AS],
      until,
      firstUtterance: values[F.FIRST_UTTERANCE],
      keepAudio: values[F.KEEP_AUDIO],
    });
    return 0;
  }

  const { loadStoryboard } = await import('./lib/compose/storyboard.mjs');
  const file = resolveStoryboard(target, kitRoot);
  const peek = loadStoryboard(file, { locale: null });
  const locale = values[F.LOCALE] ?? (peek.front.locales?.length === 1 ? peek.front.locales[0] : null);
  if (!locale) throw new UserError(`--${F.LOCALE}=<code> required (one of ${peek.front.locales?.join(', ')})`);
  const sb = loadStoryboard(file, { locale });
  const paths = workPaths({ workRoot, campaign: sb.front.campaign, locale });

  if (command === C.COMMAND_REVIEW) {
    const { buildReview } = await import('./lib/review.mjs');
    await buildReview({ sb, paths, offline: values[F.OFFLINE] });
    return 0;
  }
  const { runCampaign } = await import('./lib/pipeline.mjs');
  const mode = values[F.OFFLINE] ? ' — OFFLINE (stand-ins)' : ` — inputs ${paths.campaignDir}`;
  console.log(`campaign ${sb.front.campaign} (${locale}) — ${sb.shots.length} shot(s)${mode}${values[F.DRY_RUN] ? ' — DRY RUN' : ''}${kit.isDefault ? ' — built-in kit' : ` — kit ${kit.root}`}`);
  await runCampaign(sb, { kit, paths, offline: values[F.OFFLINE], dryRun: values[F.DRY_RUN], planOnly: command === C.COMMAND_PLAN, only: values[F.ONLY] ?? null });
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UserError) console.error(err.message);
    else console.error(err);
    process.exit(1);
  },
);
