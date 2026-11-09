# Composition engine — every video as data (analysis)

Status: **analysis, awaiting approval**. No code yet.

Decisions this analysis follows (from the user, 2026-11-08):
1. A new kind of video must **not** require a change to this repo. The engine ships
   generic primitives; each video is data, in the consuming project.
2. The skill is generic: any product, any brand, any ad style, not A5-shaped.
3. Formats that humans and agents read or write are **Markdown/YAML**. JSON exists only
   as an internal, generated artefact.

## 1. Problem

The engine today is a *planner for one ad shape*. `planShot` knows "action → verdict"
(rule line → action → synthetic flash → cut to the result still → reject stamp + quip).
`planHook` knows a title. The end card knows five styles. Each new concept means new
planners, new graphics functions and new tests in this repo, which violates decision 1.

T6 v2 (snap4id-static `docs/analysis/2026-10-14-viral-video-ads.md` §T6) shows the gap.
It needs:
- a mission title card
- a beat-cut montage (8 s of 0.5–1.5 s slices of several clips, cut on the music beat)
- a game HUD drawn by us: a minimap with a route, a 5-star "frustration" meter filling
  up, a clock and a cash-style counter, and an objective line
- a booth flash, then the A5 reject stamp
- a grey-wash slow-motion freeze with **WASTED** and a failure-reason line
- a phone-screen composite of a real app recording (D0), plus a timer HUD
- the approve stamp, then a **MISSION PASSED** banner with a reward line and a "respect" bar
- the existing end card, and a sting, HUD blips and a jingle on cues

The other concepts need the same small set of things:

| Concept | Needs |
|---|---|
| A1 Security cam | CCTV look (grade, noise, low fps, vignette), timestamp overlay, flash, result still, stamp, payoff, end card |
| A2 Street interview | dialogue shots (lip-sync clips are inputs; timing follows their audio), lower thirds, a photo reveal on a drawn ID card |
| A3 Next 10 years | montage of 5+ scenes, title cards, one dialogue line, end card |
| A4 Glam vs. microwaved | statistic card, two action → verdict beats with a custom stamp colour, payoff |
| T1 Gen Z stare | reaction shots, dialogue, an *approved* verdict |
| T2 Crush POV | rewind effect (reverse + VHS wash), a composited card |
| T3 Phonk edit | beat-cut montage, speed ramps, shake/zoom-punch on beats, flash on the drop, AURA card |
| T4 Picture day | trailer cards, montage, whisper hook, flash, black card, payoff |
| T5 Trapped | talking photo composited into a card (lip-sync input), float-away move |

**Generic primitives that cover all of them** (none is concept-specific):

| Primitive | Covers |
|---|---|
| Clip segment: `in/out`, `speed` or a speed ramp, `reverse`, `freeze` (hold a frame), `crop/scale/position` keyframes | montage slices, slow-mo, rewind, push-in, held result |
| Still segment with Ken Burns (keyframed scale/position) | result stills, title backgrounds, intro push-in |
| Overlay layer from a **template** (SVG/HTML + params) with keyframed transform/opacity and optional per-frame params | stamps, HUD (minimap, stars, clock, counter, objective), lower thirds, cards, banners, brand bug, end card |
| Picture-in-picture: a clip into a quad or rect (screen replacement) | phone-screen app recording, ID-card face, TV/CCTV monitor |
| Effects on a time range: `flash`, `grey-wash`, `grade` (LUT or curves), `cctv`, `vhs`, `shake`, `zoom-punch`, `blur`, `vignette` | WASTED freeze, CCTV, rewind, phonk hits |
| Transitions: `cut`, `whip`, `fade`, `flash-cut`, `dip-to-black` | montage, trailer |
| Audio: VO lines, SFX cues, music bed with ducking, `dialogue` from a clip's own audio | every concept |
| **Anchors**: time expressions resolved against events | everything that today lives in planners |
| **Analysers**: action onset/peak/complete, settle, flash frame, music beats/downbeats/drop, VO word timings, silence | synthetic flash, cut-on-beat, stamp on a phrase |

## 2. Composition model

One timeline of **tracks**, all in seconds, resolved by the engine into one ffmpeg graph:

- **video**: an ordered list of segments (clip | still | colour | card). Segments carry
  their own effects and transitions.
- **overlays**: layers with a `from`/`to` window, a z-order, a placement in a named
  **safe area**, template params, and keyframes.
- **audio**: `vo` (lines per locale), `sfx` (cues), `music` (bed, ducked under `vo` and
  `dialogue`), `dialogue` (a clip's own audio, kept).
- **text**: never free-floating. Text is a template param, so it is styled by the kit
  and localized by the locale table.

**Anchors** replace hand-written timing logic. Any `at`, `from`, `to`, `in` or `out`
accepts an expression:

| Form | Meaning |
|---|---|
| `2.4` | absolute seconds in the video (or in the segment, inside a segment) |
| `shot:quokka.start + 0.1` | start/end of another segment |
| `event:quokka.action.complete` | analyser result on that segment's clip (onset / peak / complete / settle) |
| `vo:quokka.line.end - 0.2`, `vo:endcard.word("gratis").end` | voice-line and word timing |
| `beat:3`, `beat:next`, `downbeat:2`, `drop` | music analysis (onsets + tempo); montage slices snap to them |
| `max(a, b)`, `min(a, b)` | composition |

Unresolvable anchors are validation errors that name the line.

**Presets (macros)** are named, parameterised snippets of the *same* model. They are
what the A5 planners become. A preset expands to segments, overlays, cues and anchors,
so it is data and needs no new code:

| Preset | Expands to (today's logic) |
|---|---|
| `action-verdict` | rule VO ends before `event:action.onset`; prelude trimmed to a 0.5 s neutral hold, sped ≤ 1.3×; flash at `action.complete`; hold 0.25 s; cut to the result still; stamp at cut + 0.1; quip with the stamp; next cut at quip end + 0.15; whoosh into the cut |
| `title-card` | colour/still background, template, duration from the VO or fixed, sting |
| `montage` | clips sliced to beats (`every: 1 beat` or `2 beats`), whip/flash-cut transitions, optional speed ramp |
| `game-fail` | freeze the last frame, grey-wash + slow-mo tail, banner template, failure line, thud |
| `phone-demo` | still/clip of a phone + PiP of the app recording into the screen quad, timer HUD |
| `grid-end-card` / `classic-end-card` | today's end cards as templates + timing (stamp after the sheet settles, VO over the complete frame, end at VO + 0.3) |
| `tempo: snappy` | defaults for holds, gaps and speeds used by the presets |
| `music-duck` | level −9 dB vs voice, duck −10 dB under every line (planned windows), fade out 0.4 s |

Presets live in the engine (a small built-in library) **and** in the project
(`media-kit/presets/*.md`). A project preset overrides a built-in one of the same name.
A new ad style is therefore a new preset file in the project, not a PR here.

**Safe areas** are named rectangles from config (`full`, `safe`, `top-band`,
`bottom-band`, `hud-top-right`, `hud-bottom-left`, `center`). Templates are placed into
them, so a template never hard-codes 9:16 margins.

**Localization**: every text param can be `{t: key}`, resolved from the campaign's
locale table. Voice files are per locale. Visuals are shared.

## 3. Graphics as project templates

Graphics move out of `graphics.mjs` into **templates** in the media kit
(`media-kit/templates/<name>.svg` + optional `<name>.md` describing its params). The
engine fills placeholders (`{{text}}`, `{{colour.accent}}`, `{{value}}`), loads fonts
from the kit and rasterises.

| Renderer | Fidelity | Speed (1080×1920 layer) | Install | Verdict |
|---|---|---|---|---|
| **resvg** (`@resvg/resvg-js`, napi prebuilt binaries) | Full static SVG 1.1 + fonts **from files** (no fontconfig games); no CSS layout, no filters beyond SVG | ~5–20 ms | prebuilt optional packages; works with Claude's `--ignore-scripts` auto-install | **default** |
| sharp/librsvg (today) | good SVG; fonts via fontconfig (needed the Pango backend workaround) | ~10–30 ms | already a dependency | keep for raster ops, drop for text |
| Headless Chromium (Playwright) | full HTML/CSS, web fonts, flexbox text fitting | ~50–150 ms/frame + startup | browser download (~150 MB, a postinstall step blocked by auto-install); `npx playwright install chromium` | **optional tier** for HTML templates, used only when installed |

Recommendation: **SVG templates rendered by resvg** as the standard. They are portable,
fast and need no install friction. Text fitting (shrink-to-fit, wrap) is done by the
engine measuring with resvg before the final render. HTML templates are an opt-in
renderer (`renderer: html` in the template's front matter); `doctor` reports whether it
is available.

**Animated overlays**, chosen per template:
- **Transform/opacity only** (slide-in, pop, fade, stamp slam): render once, animate in
  ffmpeg with keyframed `overlay` x/y, `scale` and alpha expressions. Cheap, and covers
  ~80 % of uses.
- **Content changes** (counter ticking, stars filling, clock running, route drawing):
  render a frame sequence at the video fps over the window, encoded once as a cached
  alpha clip (`qtrle`/PNG-in-MOV). Params are keyframed (`value: [0 → 5 over 6 s, ease]`)
  and cached by content hash.

## 4. Build vs reuse

| Option | For | Against |
|---|---|---|
| **editly** (MIT, JSON5 spec over ffmpeg) | Layers, gl-transitions, `audioTracks` with ducking/normalisation, canvas/fabric layers | Last npm publish 0.14.2 (Jan 2025), one maintainer. Hard native deps: `gl@5` (headless-gl), `canvas@2`, `fabric@5`. Reported build failures on Node 22/macOS; Linux needs Mesa headers. Claude plugin auto-install runs `--ignore-scripts` with a 60 s limit, so native builds won't happen. Renders frame-by-frame through canvas: slow at 1080×1920. No analysis/anchor concept. |
| **Remotion** (React) | Best-in-class templating and animation; HTML fidelity | **Remotion License**: free only for individuals, for-profits with ≤ 3 employees and non-profits; others need a paid company licence; not OSI open source. That can't sit inside an MIT plugin for "any product". Needs a Chromium download, and is heavy. |
| **MoviePy** (Python) | Mature, simple | Adds a Python toolchain to a Node plugin; slow per-frame compositing; same templating gap |
| **Direct ffmpeg filtergraph** (today) | Already works, fast, no native deps beyond ffmpeg; our analysis, ducking, loudness and review sit on it | We write the compiler from timeline to filtergraph ourselves |

**Recommendation: keep ffmpeg, build our own small compositor.** It is a timeline
compiler from the composition model to an ffmpeg filtergraph, plus resvg for templates.
- Borrow editly's *ideas*: layer list, transition names, audio-track model.
- Keep what is uniquely ours as first-class engine services: analysers
  (flash/action/settle, beats), anchors, presets, planned ducking, loudness, `review`,
  `ingest`, the cache.
- No browser and no native builds; the only new dependency is `@resvg/resvg-js`
  (prebuilt).
- gl-transitions can be ported as ffmpeg `xfade` (built-in) where needed.

## 5. Format

A campaign is **one `storyboard.md`**. YAML front matter holds the globals; each
`## Shot <id> — <title>` section has a fenced `yaml` block for machine fields, with
prose around it for intent, prompts and notes. The engine ignores the prose. Locale
text lives in tables.

````markdown
---
campaign: t6-mission
title: "T6 — Mission: passport photo"
tempo: snappy
music: { bed: 4-music/bed.mp3, preset: music-duck }
end: grid-end-card
locales: [pl, en-us]
---

## Text
| key | pl | en-us |
|---|---|---|
| mission | MISJA: Zdjęcie do dowodu | MISSION: Get your passport photo |
| objective | Dojedź do fotobudki | Get to the photo booth |
| fail | Zdjęcie odrzucone: cienie na twarzy | Photo rejected: shadows on face |

## Shot mission — mission card
Loading-screen style split panels; sting on entry.
```yaml
preset: title-card
template: game/mission-card
params: { title: {t: mission} }
duration: vo:mission.end + 0.3
sfx: [{ cue: sting, at: 0 }]
```

## Shot grind — open-world montage
Scooter, bus, rain, queue, "out of order", coin hunt. HUD over everything.
```yaml
preset: montage
clips: [scooter, bus, rain, queue, out-of-order, coins]
cut: { every: 1 beat, transition: whip }
overlays:
  - { template: game/minimap, area: hud-bottom-left, params: { route: 4.2km } }
  - { template: game/stars, area: hud-top-right, params: { value: [0, 5] }, animate: whole-shot }
  - { template: game/objective, area: bottom-band, params: { text: {t: objective} } }
```

## Shot booth — the attempt
```yaml
preset: action-verdict
clip: booth
verdict: reject
then: { preset: game-fail, params: { banner: WASTED, reason: {t: fail} } }
```
````

**A5's quokka in the same format** (timing identical to today):

````markdown
## Shot quokka — neutral expression
Habitat still on the beach; one continuous clip, the grin is the beat.
```yaml
preset: action-verdict
clip: quokka.oneshot
beat: action          # analyser: action burst; `settle` for the chameleon
result: quokka.result
verdict: reject
vo: { line: quokka.line, quip: quokka.quip }
```
````

**Media kit** becomes `brand.yaml`, `colours.yaml`, `voices.yaml`, `copy/<locale>.yaml`,
`presets/*.md`, `templates/*.svg`. Ad-hoc keys are allowed and the engine ignores them.

**Parsing/validation**: front matter and fenced YAML parsed with `yaml`. One schema per
block kind, declared per preset (each preset lists its params, types and defaults),
validated with a small hand-written validator (or zod, if the dependency is
acceptable). Errors cite `file:line` and the shot id, e.g.
`storyboard.md:42 shot grind: cut.every "1 bar" — use beats (1 beat, 2 beats)`.
The parsed result is written to `.runs/<run>/composition.json` (generated, for
debugging only).

**Localization**: the `## Text` table (or `storyboard.<locale>.md` overlays for long
copy). Missing cells are errors naming the key and locale. Voice files are resolved per
locale from `1-voice/<locale>/<key>.mp3`.

**Escape hatch**: `media-kit/campaigns/<id>/hooks.mjs` may export
`transform(composition, ctx)` (edit the resolved timeline) and named custom `analysers`
or `effects` (return ffmpeg filter strings). It runs only for that campaign and is
logged as such. It is the pressure valve for "truly custom", and recurring use there is
the signal to promote something into a preset.

## 6. Skill genericity review

Still A5-shaped today, and how to restate it:

| Today | Generic restatement |
|---|---|
| Shot types: "action → verdict", "result still", "perfect photo", "photo-sheet end card" | A **patterns library** (`references/patterns.md`): *reveal* (action → freeze/cut → judgement), *montage*, *title/caption card*, *demo* (product on screen), *dialogue*, *before/after*, *countdown*, *end card*. A5's rule-breaking is one example of *reveal*. |
| "verdict", "rejected/approved", "stamp" | a *judgement overlay* (any template: stamp, badge, score, ✓/✗), labels from the kit |
| "rule must be visible before broken", "flash" | "the setup must be visible before the payoff"; the flash is one *reveal accent* among several (whip, zoom-punch, freeze) |
| `ideation.md` scores, `lessons.md` A5 anecdotes | keep the scoring; move the anecdotes into `worked-example.md` and generalise the rules |
| `prompts.md` animal/ID-photo prompts | prompts per pattern (*reveal* clip, *montage* slice, *product scene*, *character sheet*), with the subject as a slot |
| Script table columns (rule / beat / reaction) | columns: *beat · what we see · what we hear · on-screen text · pattern* |
| Kit categories | already generic; add `presets/` and `templates/` |

`SKILL.md` keeps the three phases; Phase 3 becomes *storyboard → assets → assemble →
review → localize → publish*, with "choose or write presets" as a step.

## 7. Migration

**A5 regression**: re-express A5 as `storyboard.md` using the `action-verdict`,
`title-card`, `music-duck` and `grid-end-card` presets. A golden test compares the
resolved timeline (segment starts, audio event times, overlay windows, total) against
today's `timeline.json` for pl and en-us within 1 ms, as we did for the plugin move.
Pixels are compared on the review frame strips (SSIM ≥ 0.98; text rendering moves to
resvg). Today's planners stay as the reference implementation until the presets match;
then they are deleted.

**Phases** (≈ 8–12 working days in total):

| Phase | Work | Days |
|---|---|---|
| 1 | Composition model + anchor resolver + filtergraph compiler for clip/still/overlay/audio tracks; resvg templates; parity on a hand-written A5 composition | 3–4 |
| 2 | Presets as data (`action-verdict`, `title-card`, `music-duck`, end cards); `storyboard.md` + kit YAML parsing with schemas; A5 golden tests green | 2–3 |
| 3 | New primitives for T6: beat analyser + `montage`, frame-sequence overlays (counter/stars/clock), grey-wash/freeze, PiP into a quad; HUD templates authored in the snap4id kit (not here) | 2–3 |
| 4 | Skill rewrite (patterns library, generic prompts, storyboard templates); migrate the snap4id kit JSON → YAML; delete the old planners | 1–2 |

**Risks**
- *Filtergraph complexity*: long montages give large graphs. Mitigate by compiling per
  segment and concatenating, as the current 3-pass render already does.
- *Beat detection quality*: ffmpeg has no tempo tracker. Use an onset envelope from
  `astats`/spectral flux plus tempo autocorrelation, written in JS and unit-tested on
  fixtures; allow `beats:` overrides in the storyboard.
- *Template text fitting* without a layout engine: measure-and-shrink with resvg; HTML
  tier for complex layouts.
- *Over-generic presets* become hard to author. Keep presets small and documented in
  Markdown with an example each; the skill picks them.
- *YAML-in-Markdown* errors: report precise line numbers; the skill validates with
  `run --dry-run` after every edit.
- *Timing parity*: A5's planners contain conditional logic (weak-motion fallback,
  prelude slow-down before a freeze). Presets need conditionals (`when:`, `max()/min()`
  anchors). Keep a small expression language rather than code.

## Recommendation

Build a **data-driven composition layer on our existing ffmpeg core**: a timeline model
with anchors, analysers and presets, `storyboard.md` + YAML kits, and SVG templates
rendered by **resvg**, with an optional HTML tier. Don't adopt editly (native gl/canvas
deps break plugin auto-install; maintenance is thin) or Remotion (licence excludes most
companies). A5 becomes four preset calls with a golden timing test. T6 needs only
generic primitives (montage, frame-sequence HUD overlays, grey-wash, PiP) plus project
templates, so after phase 3 no concept requires a change to this repo.
