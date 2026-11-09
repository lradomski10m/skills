#!/usr/bin/env node
// ad-video engine CLI — one campaign spec in, one finished 9:16 MP4 out.
//
//   cli.mjs doctor
//   cli.mjs run <spec.json | campaign> [--locale=<code>] [--inputs | --offline] [--dry-run]
//        [--only=<shotId>] [--stage=<stage>] [--max-cost=<usd>] [--reroll=<shotId>]
//   cli.mjs ingest <url|file> --campaign=<id> --as=<kind>:<target> [--locale=<code>]
//   cli.mjs review <spec.json | campaign> [--locale=<code>] [--inputs | --offline]
//   cli.mjs spend --campaign=<id> --item="<what>" --usd=<n> [--via=<tool>]
// Common: --kit=<dir> (default ./media-kit, env MEDIA_KIT), --work=<dir> (default ./media-work, env MEDIA_WORK)
//
// Fonts are configured (fonts.mjs) before any module that loads sharp is imported.

import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { CONFIG } from './lib/config.mjs';
import { CLI, STAGES } from './lib/constants.mjs';
import { UserError } from './lib/errors.mjs';
import { setupFonts } from './lib/fonts.mjs';
import { loadKit, setKit } from './lib/kit.mjs';
import { kitSpecPath, resolveRoots, workPaths } from './lib/paths.mjs';

const F = CLI.FLAG;
const SPEND = 'spend';

const USAGE = `Usage: cli.mjs <command> [options]

  doctor                                   check Node, ffmpeg (+libass), deps, fonts, media kit, work folder
  run <spec.json | campaign>               assemble (or generate + assemble) one video
      --${F.LOCALE}=<code>                     locale overlay when a campaign id is given (media-kit/campaigns/<id>/<code>.json)
      --${F.INPUTS}                           assemble from media-work/<campaign>/ (no API keys, never pays)
      --${F.OFFLINE}                          synthetic stand-ins for everything (free)
      --${F.DRY_RUN}                          validate + show cache hits/misses and the cost a live run would incur
      --${F.ONLY}=<shotId>  --${F.STAGE}=<${STAGES.join('|')}>  --${F.MAX_COST}=<usd>  --${F.REROLL}=<shotId>
  ingest <url|file> --${F.CAMPAIGN}=<id> --${F.AS}=<kind>:<target> [--${F.LOCALE}=<code>]
      kinds: clip:<id> | still:<shot> | result:<shot> | perfect:<shot> | intro:<shot> | vo:<owner>[.<part>] | music
      → 1-voice/<locale>/, 2-stills/, 3-clips/, 4-music/; a replaced file moves to _alt/
  review <spec.json | campaign> [--${F.LOCALE}=<code>] [--${F.INPUTS} | --${F.OFFLINE}]
      rebuild media-work/<campaign>/review/<locale>/ (numbered shot folders, flash frames, end card, video)
  ${SPEND} --${F.CAMPAIGN}=<id> --item="<what>" --usd=<n> [--via=<tool>]
      log a generation paid through an MCP tool (shown in the campaign README)

  --${F.KIT}=<dir>   media kit (default ./media-kit, env MEDIA_KIT)
  --${F.WORK}=<dir>  scratch root (default ./media-work, env MEDIA_WORK)`;

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      [F.OFFLINE]: { type: 'boolean', default: false },
      [F.INPUTS]: { type: 'boolean', default: false },
      [F.DRY_RUN]: { type: 'boolean', default: false },
      [F.ONLY]: { type: 'string' },
      [F.STAGE]: { type: 'string' },
      [F.MAX_COST]: { type: 'string' },
      [F.REROLL]: { type: 'string' },
      [F.AS]: { type: 'string' },
      [F.LOCALE]: { type: 'string' },
      [F.KIT]: { type: 'string' },
      [F.WORK]: { type: 'string' },
      [F.CAMPAIGN]: { type: 'string' },
      item: { type: 'string' },
      usd: { type: 'string' },
      via: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, target] = positionals;
  const commands = [CLI.COMMAND_RUN, CLI.COMMAND_INGEST, CLI.COMMAND_REVIEW, CLI.COMMAND_DOCTOR, SPEND];
  if (values.help || !commands.includes(command)) return { help: true };
  if ([CLI.COMMAND_RUN, CLI.COMMAND_INGEST, CLI.COMMAND_REVIEW].includes(command) && !target) return { help: true };
  const stage = values[F.STAGE];
  if (stage && !STAGES.includes(stage)) throw new UserError(`--${F.STAGE} must be one of ${STAGES.join(', ')}`);
  const maxCostUsd = values[F.MAX_COST] === undefined ? CONFIG.budget.maxCostUsd : Number(values[F.MAX_COST]);
  if (!(maxCostUsd >= 0)) throw new UserError(`--${F.MAX_COST} must be a non-negative number`);
  return { command, target, values, stage, maxCostUsd };
}

/** A spec path, or a campaign id resolved inside the kit (needs --locale). */
function resolveSpecFile(target, kitRoot, locale) {
  if (fs.existsSync(target)) return target;
  if (!locale) throw new UserError(`"${target}" is not a file; for a campaign id pass --${F.LOCALE}=<code>`);
  const file = kitSpecPath(kitRoot, target, locale);
  if (!fs.existsSync(file)) throw new UserError(`no spec at ${file}`);
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
  const kit = setKit(loadKit(kitRoot));
  setupFonts({ extraDirs: kit.fontDirs });

  if (command === CLI.COMMAND_DOCTOR) {
    const { runDoctor, formatDoctor, STATUS } = await import('./lib/doctor.mjs');
    const results = runDoctor({ kitRoot, workRoot, kit });
    console.log(formatDoctor(results));
    return results.some((r) => r.status === STATUS.FAIL) ? 1 : 0;
  }
  if (command === SPEND) {
    if (!values[F.CAMPAIGN] || !values.item || !(Number(values.usd) >= 0)) throw new UserError(`${SPEND} needs --${F.CAMPAIGN}, --item and --usd`);
    const { appendSpend } = await import('./lib/readme.mjs');
    await appendSpend(workPaths({ workRoot, campaign: values[F.CAMPAIGN], locale: '' }), [{ item: values.item, usd: Number(values.usd), via: values.via ?? 'mcp' }]);
    console.log(`logged $${Number(values.usd).toFixed(3)} · ${values.item}`);
    return 0;
  }
  if (command === CLI.COMMAND_INGEST) {
    if (!values[F.CAMPAIGN]) throw new UserError(`ingest needs --${F.CAMPAIGN}=<id>`);
    const { ingest } = await import('./lib/ingest.mjs');
    const paths = workPaths({ workRoot, campaign: values[F.CAMPAIGN], locale: values[F.LOCALE] ?? '' });
    if (String(values[F.AS] ?? '').startsWith('vo:') && !values[F.LOCALE]) throw new UserError(`ingest of a voice line needs --${F.LOCALE}=<code>`);
    await ingest({ source: target, paths, as: values[F.AS] });
    return 0;
  }

  const { loadSpec } = await import('./lib/spec.mjs');
  const specFile = resolveSpecFile(target, kitRoot, values[F.LOCALE]);
  const live = !values[F.OFFLINE] && !values[F.DRY_RUN] && !values[F.INPUTS];
  const spec = await loadSpec(specFile, { live: command === CLI.COMMAND_RUN && live, kit });
  const paths = workPaths({ workRoot, campaign: spec.campaign, locale: spec.locale });

  if (command === CLI.COMMAND_REVIEW) {
    const { buildReview } = await import('./lib/review.mjs');
    await buildReview({ spec, paths, inputs: values[F.INPUTS], offline: values[F.OFFLINE] });
    return 0;
  }
  const { runPipeline } = await import('./lib/pipeline.mjs');
  const mode = values[F.INPUTS] ? ` — INPUTS ${paths.campaignDir}` : values[F.OFFLINE] ? ' — OFFLINE' : '';
  console.log(`spec ${spec.id} (${spec.locale}) — ${spec.shots.length} shot(s)${mode}${values[F.DRY_RUN] ? ' — DRY RUN' : ''}${kit.isDefault ? ' — built-in kit' : ` — kit ${kit.root}`}`);
  const result = await runPipeline(spec, {
    offline: values[F.OFFLINE],
    inputs: values[F.INPUTS],
    dryRun: values[F.DRY_RUN],
    onlyShot: values[F.ONLY],
    stopAfter: parsed.stage,
    maxCostUsd: parsed.maxCostUsd,
    reroll: values[F.REROLL],
    paths,
  });
  if (result.error) {
    console.error(`\n${result.error}`);
    return 2;
  }
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
