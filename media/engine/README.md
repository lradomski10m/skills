# ad-video engine

A **composition engine**: one `storyboard.md` (Markdown + YAML) in, one finished 9:16
MP4 out, with no manual editing. Video types are data: **presets** (Markdown + one yaml
block) and **SVG templates**, built in or in the project's media kit. A new kind of video
needs a storyboard, maybe a project preset or template, and no engine change.
The engine is provider-agnostic: it only assembles files generated elsewhere (MCP tools),
and every missing file gets a synthetic stand-in, so it never pays for anything.

Design (as built): `docs/design/2026-11-09-composition-engine.md` in the repository.
Spec: `docs/specs/2026-11-09-composition-engine.md`.

## Layout

```
cli.mjs                 — doctor | run | plan | review | ingest | spend | presets | migrate-kit
fonts/                  — bundled Inter (OFL) + licence
kit-default/            — neutral built-in kit (used without a project kit, and by tests)
presets/*.md            — built-in presets: action-verdict, hook-title, title-card, montage,
                          game-fail, phone-demo, clip, still, dialogue, end-card(-<style>)
templates/*.svg         — neutral example templates: title-card, banner, lower-third,
                          objective, counter, timer, stars, route-map
lib/compose/
  source.mjs            — YAML/Markdown parsing with line numbers; file:line error format
  storyboard.mjs        — storyboard.md: front matter, ## Text, ## Shot blocks, extends, locale overlays
  expr.mjs              — anchor expressions (refs, ??, ?:, comparisons, max/min/clamp, beats)
  presets.mjs           — preset loading (built-in + kit, extends), param validation
  planners.mjs          — generic timing solvers: reveal, hold, clip, montage, endcard, hook, none
  compose.mjs           — storyboard → timeline (segments, overlays, audio, effects)
  builtins.mjs, draw.mjs — built-in graphics and drawing every overlay/card (cached)
  templates.mjs         — SVG templates: {{placeholders|filters}}, fit, keyframes, resvg
  effects.mjs           — windowed effects + transitions (incl. two-layer dissolve/slide), PiP into a quad (+ hold)
  beats.mjs             — music beat / downbeat / drop detection (+ manual override)
  text.mjs              — text table lookup, voice speeds
lib/
  alignment.mjs         — PURE: flash/beat/settle detection; reveal, hook, end-card timing
  timeline.mjs          — PURE: music duck windows, loudness, timeline checks
  endcard-layout.mjs    — PURE: end-card grid geometry
  captions.mjs          — PURE: ASS captions (off by default)
  render.mjs            — ffmpeg argv builders per segment kind + the final pass
  graphics.mjs, fonts.mjs — sharp/Pango built-in graphics (stamps, sheets, bug)
  pipeline.mjs          — assets, analysis, compose, render, review; cache
  kit.mjs               — YAML media kit loader
  migrate.mjs           — 0.1.x JSON kit + specs → YAML kit + storyboard.md
  ingest.mjs            — ingest by role: clip normalisation (CFR, untagged, no audio), voice cuts
  media/ffmpeg.mjs      — ffmpeg/ffprobe wrappers; every call under the -progress stall watchdog
  inputs.mjs, review.mjs, readme.mjs, doctor.mjs, runs.mjs, cache.mjs, hash.mjs
  providers/offline.mjs — synthetic stand-ins (say/espeak, tone clips, solid stills)
test/                   — node:test; fixtures: golden timelines, the anonymized worked
                          example (campaigns/animals) and the all-primitives showcase
```

## Rules

- Video types live in presets and templates, never in engine code. If a pattern can't
  be expressed, extend the generic vocabulary (a planner, an effect, an expression
  function), not a campaign-specific branch.
- No brand, campaign or locale strings in code or config: they come from the kit or the
  storyboard. Literals go in `constants.mjs`, tunables in `config.mjs`.
- Human and agent formats are Markdown/YAML. JSON is internal only (cache, run logs,
  golden fixtures).
- Errors name `file:line shot <id>` and say what to change.
- Never let a model draw branding: logo, stamps, URLs, captions and end cards are drawn
  here.
- Never hand-time anything: times come from planners, anchors and `duckWindows()`.
- Keep `alignment.mjs`, `timeline.mjs`, `endcard-layout.mjs`, `expr.mjs`, `beats.mjs`
  and `paths.mjs` pure and unit-tested.
- Cache keys include every input that changes the output and nothing else. Bump a
  stage's format version (e.g. `ANALYSIS_FORMAT`) when its output changes.
- Overlays stay inside the 9:16 safe area (named areas in `config.mjs`).
- Every clip enters through `ingest`, which normalises it (constant `render.fps`,
  colour tags unspecified, yuv420p, no audio). Mixed colour tags in the concatenated
  base make ffmpeg re-initialise the filter graph mid-stream and reset frame-index
  filters; VFR makes trim/setpts drift.
- Filter graphs on the base: cut by frame index, keep every branch on the base's
  timestamps from t=0, at most two `split` branches per effect (chained 3-way splits
  buffer without end), never `xfade` two trims of one stream. A graph that stalls is
  killed by the watchdog (`render.watchdog.stallSec`).
- Never loop music silently: a short bed plays once and is padded (warned); loop only
  on `music.loop`.
- The A5 golden test (`test/golden.test.mjs`) pins timing to the 0.1.x renders within
  1.5 ms. A timing change that breaks it needs a deliberate fixture refresh
  (`test/tools/capture-golden.mjs`).

## Text rendering

- **SVG templates** render with resvg, with fonts loaded from files only: the bundled
  Inter plus the kit's `font.files`. The output is the same on every OS. resvg ignores
  `pathLength`, so use real path lengths for dash animations.
- **Built-in graphics** (stamps, print sheet, brand bug) still use sharp/Pango.
  `lib/fonts.mjs` writes a fontconfig file and sets `PANGOCAIRO_BACKEND=fc` before sharp
  loads; otherwise macOS Pango would use CoreText and see only installed fonts.
