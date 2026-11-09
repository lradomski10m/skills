# Composition engine (spec)

Implements `docs/analysis/2026-11-08-composition-engine.md`. Target: plugin
`media` 0.2.0. A video is **data** in the consuming project (a `storyboard.md` plus
the YAML media kit). The engine ships generic primitives: segments, overlays,
effects, transitions, anchors, analysers, planners and presets. A new kind of video
needs no change to this repo.

## 1. Model (resolved timeline)

The compiler's internal form, written to `.runs/<run>/timeline.json`. Human formats are
§4–§6. All times are seconds, rounded to 1 ms.

```
Timeline   { totalSec, segments: Segment[], overlays: Overlay[], audio: AudioEvent[],
             effects: Effect[], captions: Caption[], events: { [name]: sec } }
Segment    { id, kind, startSec, durationSec, ...kind fields, review: { times: sec[] } }
  planned  { plan, clipFile, intro?, result? }          reveal planner output (clip → flash → result still)
  clip     { file, inSec, outSec?, speed=1, ramp?: [{at, speed}], reverse=false, freezeHeadSec=0, freezeTailSec=0 }
  still    { file | graphic, kenBurns?: { from: {scale,x,y}, to: {scale,x,y} } }
  color    { color }
  card     { graphic | backgroundClip }                 end cards
Overlay    { graphic | template+params | sequence, fromSec, toSec, place, fadeIn?, slide?, z }
  place    { anchor: top|center|bottom|full, x?, y?, dx?, area? }   area = named safe area
  pip      { clip, fromSec, toSec, quad: [[x,y]×4], inSec=0, speed=1 }
AudioEvent { file, atSec, durSec?, bus: voice|sfx|dialogue, gain }
Effect     { name, fromSec, toSec, params }             global time windows on the base video
```

## 2. Anchors (timing expressions)

Any time field (`at`, `from`, `to`, `duration`, planner arguments) takes a number or an
expression string. Grammar (Pratt parser, pure):

```
expr    := ternary
ternary := or ( '?' expr ':' expr )?
or      := and ( '||' and )*        and := cmp ( '&&' cmp )*
cmp     := sum ( ('=='|'!='|'<'|'<='|'>'|'>=') sum )?
sum     := prod ( ('+'|'-') prod )*  prod := unary ( ('*'|'/') unary )*
unary   := '-' unary | '!' unary | fallback
fallback:= primary ( '??' primary )*            a ?? b: b when a is null/undefined
primary := number | string | ref | func '(' args ')' | '(' expr ')'
ref     := ident ( '.' ident | '.' number )*    e.g. plan.stampAt, vo.line.end, beat.next
func    := max | min | clamp | round | beatAfter | beatBefore
```

Scopes available inside a shot (shot-local seconds unless noted):

| Ref | Value |
|---|---|
| `start`, `end`, `duration` | this shot (start = 0 locally) |
| `plan.<event>` | events from the shot's planner (e.g. `voStart`, `stampAt`, `flashAt`) |
| `$<param>` | the shot's parameter (after defaults) |
| `vo.<key>.duration`, `vo.<key>.end` (= at + duration, when placed) | voice lines |
| `clip.<param>.action.onset|peak|complete`, `.settle`, `.flash` | clip analysers |
| `beat.next`, `beat.prev`, `beat.<n>`, `downbeat.<n>`, `drop` | music analysis (global → shot-local) |
| `global.<event>` | campaign events (`hook.minFirstVoStart`, `shots.end`, `cut.<i>`) |
| `first`, `last`, `index` | position of the shot |

An unresolved ref is `undefined`. It is an error only where a time is required and no
`??` fallback applies. Errors cite file:line and the shot.

## 3. Planners, analysers, presets

**Planners** are built-in timing solvers (generic, parameterised). Each returns
`{ durationSec, events, segments[] }`:

| Planner | Args | Wraps |
|---|---|---|
| `reveal` | `clip`, `result?`, `intro?`, `beat: action|settle`, `flash: auto|synthetic`, `lineSec`, `quipSec`, `clerkSec`, `minVoStart`, `tempo` | today's `planShot` (all A5 timing, incl. fallbacks) |
| `hold` | `background` (clip/still/colour/graphic), `duration` (expr) | fixed or VO-driven length |
| `montage` | `clips[]` (+ per-clip `in`), `every` (beats), `maxSec`, `minSlice` | slices cut on beats |
| `endcard` | `voSec`, `clerkSec`, `minDuration`, `sheet` timing, `stampAtSec` | today's `planEndCard` |
| `hook` | `voSec`, `titleSec` | today's `planHook` (exports `hook.minFirstVoStart`) |

**Analysers** (cached by content hash): `action` / `settle` / `flash` on clips (today's
`analyzeFrames`); `beats` on the music bed (onset envelope → tempo → beat grid,
downbeats every 4, `drop` = biggest energy rise). Manual override in the storyboard:
`music: { beats: [..] }` or `{ bpm, offset }`.

**Presets** are Markdown files: built-ins in `engine/presets/*.md`, project ones in
`media-kit/presets/*.md` (a project file overrides a built-in of the same name). Front
matter: `name`, `summary`, optional `extends`. Body: prose docs plus one fenced
`yaml` block:

```yaml
params:                       # declared params: type, default, required, values, doc
  clip:    { type: clip, required: true, doc: Continuous action clip }
  verdict: { type: enum, values: [reject, approve, none], default: reject }
plan: { planner: reveal, args: { clip: $clip, beat: $beat, minVoStart: "first ? (global.hook.minFirstVoStart ?? 0) : 0" } }
segments: []                  # extra segments (rare; planners emit their own)
audio:    [ { vo: $vo.line, at: plan.voStart }, { sfx: thud, at: plan.stampAt, when: "$verdict == 'reject'" } ]
overlays: [ { template: builtin:stamp, params: { verdict: $verdict }, from: plan.stampAt, to: end, place: { anchor: bottom, y: stampBottom } } ]
effects:  [ { name: grey-wash, from: "end - 1.2", to: end } ]
exports:  { flash: plan.flashAt }   # → global.<shotId>.flash
```

`$x` substitutes a param (whole value). `when:` is an expression; falsy drops the item.
Param types: `clip`, `still`, `vo`, `sfx`, `music`, `kit` (a kit file), `text` (a
`{t: key}` or literal), `number`, `bool`, `enum`, `time` (expression), `list`, `object`.

Built-in presets (0.2.0): `action-verdict`, `title-card`, `montage`, `game-fail`,
`phone-demo`, `hook-title`, `end-card` and its styles `end-card-real-sheet`, `-grid`,
`-grid-strip`, `-tilted`, `-classic`. `tempo` and `music-duck` are campaign
blocks, not shot presets (§5).

## 4. storyboard.md

````markdown
---
campaign: a5-animals            # required; media-work/<campaign>
title: …
locales: [pl, en-us]            # required
tempo: snappy                   # built-in profile; `tempoOverrides:` deep-merges
cuts: { sfx: whoosh }           # sound into every cut after the first (tempo supplies lead/gain)
hook: { preset: hook-title, text: { t: hook }, vo: hook }
brandBug: { from: 0, to: global.shots.end }       # omit = none
music: { bed: bed, levelDb: -9, duckDb: -10 }     # 4-music/bed.mp3; beats/bpm override
end: { preset: end-card-real-sheet, … }           # or a ## Shot with that preset
captions: false
---

## Text
| key | pl | en-us |
|---|---|---|
| hook | Wymagania zdjęcia do dowodu | Passport photo requirements |

## Shot quokka — neutral expression
Prose: intent, prompts, notes (ignored by the engine).
```yaml
preset: action-verdict
clip: quokka.oneshot
…
```
````

- Sections: front matter (required), `## Text` (optional table: first column `key`,
  then one column per locale), `## Shot <id> — <title>` (each with exactly one
  fenced ```yaml block). Other sections and prose are ignored.
- Text values: `{ t: key }` or `"literal"`; inline references `{{t.key}}` inside strings.
  A missing key/locale cell is an error naming the key and the locale.
- Per-locale overlay `storyboard.<locale>.md`: a `## Text` table with columns
  `key | text` and/or `## Shot <id>` YAML blocks deep-merged over the base. Long copy
  lives there.
- Subsets: front-matter `shots: [quokka, dog]` + `extends: storyboard.md` in another
  file (cut-downs, teasers).
- Voice assets resolve per locale: `vo: quokka.line` → `1-voice/<locale>/quokka.line.mp3`.
  The spoken text is `t: quokka.line` when present (offline stand-in, word anchors).

## 5. Campaign blocks

- `tempo`: name of a built-in profile (`relaxed`, `snappy`) from config, plus
  `tempoOverrides`. Planners read it.
- `music`: `bed` (asset key), `levelDb`, `duckDb`, `attackSec`, `releaseSec`,
  `mergeGapSec`, `fadeOutSec`, `beats`/`bpm`/`offset`. Ducking is planned from the voice
  events (today's `duckWindows`). The final mix is −14 LUFS.
- `cuts`: `{ sfx, lead?, gain? }`; whooshes into every cut after the first.
- `brandBug`, `hook`, `end`: as above. `end` is laid out after the last shot.

## 6. Media kit (YAML)

```
media-kit/brand.yaml     name, stampMark, url, icon, chip {file, iconBox}, font {family, files[]},
                         colours {accent, background, text, muted, rejected, approved, stampPaper,
                         panelFrom, panelTo, panelMuted, sheet, cropMark, qrFinder, chipBg},
                         endCard {style}, providers {images, video, voice, music}
media-kit/voices.yaml    roles per locale ('*' = all): narrator, announcer, clerk, … → {voiceId, voiceName, modelId, postSpeed, ifMissing, offlineVoice}
media-kit/copy/<l>.yaml  labels {reject, approve}, clerk {reject, approve}, endCard {cta, ctaHint, copy, sheet {tagline[], order, qrUrl, url?}}, text {key: value}, + free-form
media-kit/presets/*.md   project presets (§3)
media-kit/templates/*.svg project templates (§7) + optional <name>.md docs
media-kit/campaigns/<id>/storyboard.md (+ storyboard.<locale>.md, hooks.mjs, concept.md)
```

`copy/<locale>.yaml` `text:` keys are a fallback for the storyboard's `## Text` table.
Free-form keys (slogans, claims, hashtags) are for the skill. JSON kits are not read
(migrate with `cli.mjs migrate-kit`).

## 7. Templates

- SVG files with `{{placeholder}}` markers: `{{param}}`, `{{param|upper}}`,
  `{{param|int}}`, `{{param|fixed:1}}`, `{{param|time}}` (m:ss), `{{colour.<name>}}`,
  `{{font.family}}`, `{{t.<key>}}`. Values are XML-escaped. A missing param is an error.
- Front-matter-style metadata in an SVG comment at the top:
  `<!-- template: { size: [600, 140], params: { value: number, label: text } } -->`.
- Rendering: `@resvg/resvg-js` (prebuilt, exact pin), fonts loaded from files (bundled
  Inter + kit `font.files`), no system font lookup.
- Text fitting: `data-fit-width="N"` on a `<text>` shrinks its font size until its
  measured width ≤ N.
- Animation: an overlay with `animate: { <param|opacity|scale|dx|dy>: [[t, v], …], ease }`
  (times relative to the overlay start) renders a cached PNG frame sequence at the
  video fps. Numbers are interpolated; strings step. Static overlays render once.
- Built-in templates `builtin:hook|stamp|brand-bug|rule|mark|photo-sheet|endcard-base|endcard-full`
  keep the current sharp/Pango renderers (visual parity with 0.1.x).

## 8. Effects and transitions

Effects are windows in global time on the base video, applied in the final pass before
overlays:

| Effect | Params | ffmpeg |
|---|---|---|
| `flash` | `alphas[]` | drawbox white per frame (today's synthetic flash) |
| `grey-wash` | `rampSec`, `saturation`(0), `darken` | `hue=s=expr`, `eq=brightness` |
| `shake` | `amp` px, `freq` Hz | scale + crop with `sin(t)` offsets |
| `zoom-punch` | `amount`, `attackSec`, `releaseSec` | per-frame zoom (scale + crop expr) |
| `grade` | `lut` (kit .cube) or `contrast`, `saturation`, `gamma`, `tint` | `lut3d` / `eq` / `colorbalance` |
| `cctv` | `noise`, `saturation`, `fps`, `vignette` | `hue`, `noise`, `vignette`, frame-hold |
| `vhs` | `shift`, `noise` | `rgbashift`, `noise`, `eq` |
| `blur` | `sigma` | `gblur` |
| `vignette` | `angle` | `vignette` |

Transitions are effects centred on a cut (timing-neutral: segments never overlap):
`cut` (none), `flash-cut` (white flash), `dip` (fade to black and back over `durSec`),
`fade` (dip through the cut using a cross-dissolve of the edge frames), `whip`
(horizontal motion blur + slide, `durSec`). Declared as `transition: { name, durSec }`
on the incoming shot or in `cuts:`.

Segment-level timing effects (not windows): `speed`, `ramp`, `reverse`, freezes, Ken Burns.

Picture-in-picture: overlay kind `pip` with a `quad` in canvas pixels, or `quadIn: still`
coordinates mapped through the still's cover scaling. Rendered as perspective warp
plus a polygon alpha mask.

## 9. hooks.mjs

`media-kit/campaigns/<id>/hooks.mjs` (optional) may export:
- `transform(timeline, ctx) → timeline` after layout (edit or add anything)
- `effects: { name: (params, window) => ffmpegFilterString }`
- `analysers: { name: async (file, ctx) => events }`

It is logged as `custom hook: <name>` and runs only for that campaign.

## 10. Errors

Every validation error is one line: `<file>:<line> [shot <id>] <path>: <message>`.
Validation runs fully and reports every error, then exits 1. YAML syntax errors use the
`yaml` package's positions. Examples:
`storyboard.md:42 shot grind cut.every: expected beats (e.g. 1), got "1 bar"`
`storyboard.md:8 text hook: missing en-us`.

## 11. CLI

```
cli.mjs doctor
cli.mjs run <campaign|storyboard.md> --locale=<l> [--inputs|--offline] [--dry-run] [--only=<shot>]
cli.mjs plan <campaign|storyboard.md> --locale=<l>       resolve + print the timeline (no render)
cli.mjs review | ingest | spend                          unchanged
cli.mjs migrate-kit [--kit=<dir>]                        JSON kit + campaign specs → YAML + storyboard.md
cli.mjs presets [--kit]                                  list presets with params (from their docs)
```

Removed: engine live generation (`FAL_KEY` / `ELEVENLABS_API_KEY` providers, cost ledger,
`--reroll`, `--stage`). Generation happens through MCP in the skill; `spend` logs it.

## 12. Tests

- Unit: anchor parser/evaluator, storyboard parser (positions, errors), kit YAML,
  presets (params/defaults/extends/when), template placeholders + fit, beat detector on
  synthetic click tracks (± 1 frame), effect/transition filter strings, PiP mapping,
  frame-sequence interpolation, compose layout.
- **A5 golden**: captured planning inputs (clip analyses, voice durations) for pl and
  en-us + the timelines rendered by 0.1.x → the new engine's timeline matches every
  segment start, segment duration, audio event time and overlay window within 1 ms.
- Integration (outside `npm test`): render A5 from a migrated kit copy; frame strips
  compared side by side with 0.1.x renders.

## 13. Migration (separate, final step, in snap4id-static)

1. `cli.mjs migrate-kit` turns `brand/brand.json` + `colours.json` → `brand.yaml`,
   `voices/cast.json` → `voices.yaml`, `copy/*.json` → `copy/*.yaml`, and
   `campaigns/<id>/{base,<l>}.json` → `campaigns/<id>/storyboard.md`. Old files move to
   `_alt/`.
2. Re-render A5 pl/en-us; compare the timelines with the 0.1.x `.runs/*/timeline.json`.
3. Update snap4id CLAUDE.md wording (storyboard instead of specs).
