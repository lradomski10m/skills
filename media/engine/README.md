# ad-video engine

One campaign spec (base + locale overlay) in, one finished 9:16 MP4 out, with no manual
editing. Provider-agnostic: in `--inputs` mode it only assembles files generated
elsewhere (MCP tools). Brand, voices and copy come from the project's media kit.

## Layout

```
cli.mjs                 — doctor | run | ingest | review | spend
fonts/                  — bundled Inter (OFL) + licence; fontconfig is pointed here (lib/fonts.mjs)
kit-default/            — neutral built-in kit (used without a project kit, and by tests)
lib/
  constants.mjs         — every shared literal: layouts, roles, stages, endpoints, env names
  config.mjs            — every tunable: timing, tempo, layout, mix, models, prices
  paths.mjs             — PURE: media-kit / media-work roots and campaign folders
  kit.mjs               — load the media kit; kit locale defaults (cast, copy)
  spec.mjs              — load base + locale overlay + extends; validate; missing-text check
  alignment.mjs         — PURE: flash/beat/settle detection; shot, hook, end-card planning
  timeline.mjs          — PURE: plans → segments / audio / overlays; music duck windows
  captions.mjs          — PURE: alignment → ASS captions (off by default)
  endcard-layout.mjs    — PURE: end-card grid geometry (shared by graphics + timeline)
  render.mjs            — ffmpeg argv builders (pure) + the render passes
  graphics.mjs          — every branded graphic, drawn with sharp from the kit
  pipeline.mjs          — stage orchestration, cache, budget, re-rolls
  inputs.mjs, ingest.mjs, review.mjs, readme.mjs, doctor.mjs, runs.mjs
  cache.mjs, hash.mjs, cost.mjs, secrets.mjs, errors.mjs, fonts.mjs
  providers/            — fal + ElevenLabs (live mode), offline stand-ins
  media/                — ffmpeg/ffprobe wrappers, WAV reader
test/                   — node:test (`npm test` in the plugin folder); fixtures incl. an example campaign
```

## Rules

- Never put API keys in a repo: env or `~/.config/media-skills.env` (`MEDIA_SECRETS_FILE`).
- Never let a model draw branding: logo, stamps, URLs, captions, end cards are drawn here.
- No brand or locale strings in code or config — they come from the kit or the spec.
- Never re-pay for an unchanged output: paid work goes through `step()` (content-hash
  cache + budget). A cache key includes every input that changes the output, nothing else.
- Keep `alignment.mjs`, `timeline.mjs`, `captions.mjs`, `endcard-layout.mjs`, `paths.mjs`
  pure and unit-tested; timing decisions live there, never in `render.mjs`.
- Literals in `constants.mjs`, tunables in `config.mjs`.
- When a stage's output format changes, bump that stage's version in its cache key
  (e.g. `ANALYSIS_FORMAT`); `CACHE_SCHEMA` invalidates everything (last resort).
- Overlays stay inside the 9:16 safe area (`layout.safeTop..safeBottom`), except the end
  card's bottom rows (`ignoreBottomSafe`).
- Never hand-time anything: shot events come from `planShot()`, the end card from
  `planEndCard()`, music ducking from `duckWindows()`.

## Text rendering

`lib/fonts.mjs` writes a fontconfig file (bundled fonts, kit `brand/fonts/`, then system
font dirs) and sets `PANGOCAIRO_BACKEND=fc` before sharp renders text, so the bundled
font works on every OS without installing it (on macOS Pango would otherwise use CoreText
and only see installed fonts). The CLI calls it before importing anything that loads sharp.
