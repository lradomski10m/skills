# Composition engine (as built, media 0.2.0)

Spec: `docs/specs/2026-11-09-composition-engine.md`. Analysis:
`docs/analysis/2026-11-08-composition-engine.md`. This document describes what shipped,
where it differs from the spec, and why.

## 1. Goal and result

A new kind of video must need **no change to this repository**. In 0.1.x the engine
knew one video shape (hook → reveal shots → end card) in code. In 0.2.0:

- a video is a `storyboard.md` in the consuming project;
- every video type is a **preset** (Markdown + one yaml block), built in or in
  `media-kit/presets/`;
- every graphic with text is an **SVG template**, built in or in `media-kit/templates/`.

The engine supplies only generic vocabulary: segment kinds, planners, an anchor
expression language, effects, transitions, analysers and built-in graphics.

Proof:

- **A5 parity.** The 0.1.x campaign migrated to a storyboard reproduces its timelines
  within 1 ms (golden test, pl and en-us). Its real renders match 0.1.x: video SSIM
  1.000 (pl) and 0.9996 (en-us), and bit-identical audio when the 0.1.x SFX cache is
  reused.
- **Showcase.** A neutral storyboard
  (`media/engine/test/fixtures/campaigns/showcase/storyboard.md`) uses every primitive.
  Shaped like a game-parody ad (mission card → beat-cut montage with HUD → fail freeze →
  CCTV → phone demo → VHS → end card), it renders offline to a 21.45 s video. No
  campaign-specific code or art is involved.

## 2. Pipeline

```
storyboard.md (+ storyboard.<locale>.md, extends)        lib/compose/storyboard.mjs
   │  front matter, ## Text table, ## Shot <id> yaml blocks, line numbers
   ▼
presets (built-in + kit, extends) → shotParams()          lib/compose/presets.mjs
   ▼
assets + analysis (ctx): clips, stills, vo (+tempo), sfx, music, beats, kit files
   │  missing file → synthetic stand-in; every step content-hash cached     lib/pipeline.mjs
   ▼
compose(): planners lay shots back to back → emits evaluated (audio, overlays, effects,
   each:, when:) → cuts/transitions → brand bug, campaign overlays → Timeline
                                                           lib/compose/compose.mjs
   ▼
draw(): built-ins (sharp/Pango), templates (resvg), animated templates → PNG sequences,
   PiP masks                                               lib/compose/draw.mjs
   ▼
render: one ffmpeg pass per segment kind → concat → final pass (effects → overlays →
   PiP → audio mix, duck, −14 LUFS)                         lib/render.mjs
   ▼
review/<locale>/ (key frames per shot, end-card strip), README.md, run log
```

## 3. Model

`Timeline { totalSec, shots[], segments[], overlays[], audio[], effects[], captions[] }`.

- **Segments**: `planned` (reveal: clip → flash → result still), `clip`, `still` (Ken
  Burns), `color`, and `card` (a drawn graphic, optionally over video).
- **Overlays**: `builtin` (hook, brand-bug, rule, mark, stamp, photo-sheet,
  endcard-full, endcard-base), `template` (static PNG or a cached frame sequence), and
  `pip`.
- **Audio**: `vo`, `sfx` and `dialogue` (a clip's own audio), plus the music bed.
- **Effects**: windows `{name, fromSec, toSec, params}`.

## 4. Anchors

`lib/compose/expr.mjs` is a small Pratt parser. It supports:

- numbers, refs, `+ - * /`, comparisons, `&& || !`, `?:` and `??`;
- `max min clamp round abs defined beatAfter beatBefore`.

Scopes:

- the shot: `$param`, `plan.*`, `start`, `end`, `duration`, `shotStart`, `first`,
  `last`, `index`;
- `each` inside `each:` items;
- global: `global.<shot>.<export>`, `kit.*`, `copy.*`, `config.*`, `tempo.*`;
- music: `beat.next|prev|n`, `downbeat.n`, `drop`.

An identifier may contain `-` only before a letter, so `end-1.2` is subtraction. An
unresolved ref is `undefined`, and it is an error only where a time is required.

## 5. Planners

These generic timing solvers wrap the tested 0.1.x `alignment.mjs`:

| Planner | Produces |
|---|---|
| `reveal` | the 0.1.x `planShot`: action/settle beat, flash, result still, voice and stamp times |
| `hold` | a fixed or voice-driven length over a colour, still, clip or graphic |
| `clip` | one clip with in/out, speed, reverse and freezes |
| `montage` | slices that end on beats (`every` N), or fixed `sliceSec` without music; events `cuts`, `starts`, `slices` |
| `endcard` | the 0.1.x `planEndCard`: grid entrance, stamp, clerk, ding, all five styles |
| `hook` | the 0.1.x `planHook`; exports `hook.minFirstVoStart` |
| `none` | zero length, for items that are only overlays or audio |

## 6. Presets shipped

- `action-verdict`, `hook-title`, `title-card`, `montage` (hits through
  `each: plan.starts`), `game-fail` (slow-mo + freeze + grey wash + banner),
  `phone-demo` (PiP + timer), `clip`, `still`, `dialogue`;
- `end-card` plus `end-card-{real-sheet,grid,grid-strip,tilted,classic}`, which are
  `extends` with a fixed style.

Music ducking and tempo profiles are storyboard settings (`music:`, `tempo:`), not
presets. The spec listed `music-duck` and `tempo` presets. As built, they are
front-matter keys with the same parameters, because they apply to the whole video, not
to a shot.

## 7. Templates

- An SVG template uses `{{key|filter:arg}}` placeholders. Filters: `upper lower int
  fixed time pad invert scale default`. Templates can also read `{{colour.<name>}}` and
  `{{font.family}}`.
- `data-fit-width` shrinks text to fit.
- A `<!-- template: {…} -->` comment declares the template's size, default place and
  params.
- Rendering uses `@resvg/resvg-js` 2.6.2 (exact pin), with fonts loaded **from files
  only** (bundled Inter + kit `font.files`), so output does not depend on the OS.
- An `animate:` block keyframes the transforms `opacity`, `scale`, `dx` and `dy`, plus
  any numeric param, with linear interpolation. The engine pre-renders the
  frames to a cached PNG sequence and overlays it as an image2 input.
- Neutral examples ship: `title-card`, `banner`, `lower-third`, `objective`, `counter`,
  `timer`, `stars`, `route-map`.

## 8. Effects and transitions

- Effects (`lib/compose/effects.mjs`): `flash`, `grey-wash`, `shake`, `zoom-punch`,
  `grade` (`lut3d` from a kit `.cube`, or `eq`/`colorbalance`), `cctv`, `vhs`, `blur`,
  `vignette`.
- Each effect is applied as a windowed split → filter → overlay with `enable`, in the
  final pass, before overlays (so graphics are never shaken or graded).
- Transitions are effects centred on a cut: `flash-cut`, `dip`, `dip-white`, `whip`.
- PiP: a `perspective` warp (sense=destination) of the inner clip onto a quad, with an
  alpha mask cut to the quad's polygon.

## 9. Beats

`lib/compose/beats.mjs`:

1. an onset envelope: the positive change in log energy per 256-sample hop at 22.05 kHz (~11.6 ms);
2. autocorrelation tempo in the 70–180 BPM range, with a log-normal prior centred on 120 BPM;
3. phase from the best comb alignment;
4. a beat grid, downbeats every 4 beats, and `drop` at the biggest smoothed energy rise.

Results: within 10 ms on synthetic click tracks, and 117.6 BPM on the A5 bed (nominally
~118). The manual override is `music: { bpm, offset }` or `music: { beats: [...] }`.

## 10. Storyboard and kit formats

- Storyboard grammar: `media/skills/ad-video/references/storyboard.md`.
- Kit: `brand.yaml`, `voices.yaml`, `copy/<locale>.yaml`, `presets/`, `templates/`,
  `campaigns/<id>/`.
- The `yaml` package (2.9.1, exact pin) parses with `prettyErrors` and a `LineCounter`.
  Every problem is collected and printed as `file:line shot <id> <path>: message`; the
  command then exits 1.
- `migrate-kit` converts a 0.1.x JSON kit and its campaign specs, and moves the old
  files to `_alt/0.1.x/`.

## 11. Deviations from the spec, and descoped items

| Item | As built | Why |
|---|---|---|
| Engine live generation (fal/ElevenLabs from the CLI, cost ledger, `--reroll`, `--stage`) | removed | generation goes through MCP in the skill; this removes keys, budgets and two providers |
| Built-in graphics (stamp, print sheet, brand bug, end cards) | still sharp/Pango; the fontconfig workaround stays for them | porting them to SVG risked A5 pixel parity; templates (all new text) use resvg |
| Animated transforms | pre-rendered PNG frame sequences, not ffmpeg expressions | one code path for any keyframed param; cached by content hash |
| PiP `quadIn: still` mapping | not built; quads are measured in canvas pixels | rare need; pixel quads are simpler to check |
| Transitions | timing-neutral approximations; segments never overlap. `whip` is a horizontal motion blur across the cut, with no slide | keeps the segment-concat architecture and A5 timing; true cross-fades would need overlapping segments |
| SFX synthesis | `anoisesrc` stays unseeded | seeding would change every cache key and the existing renders' audio. Cached SFX are reused, so a project's renders stay stable |
| `hooks.mjs` analysers | exposed on `ctx` for `transform`, not as storyboard analyser names | no campaign needs it yet; `transform` and custom `effects` are enough |
| `music-duck` / `tempo` presets | front-matter settings | they apply to the whole video |
| Lip-sync | external (an MCP model); the `dialogue` preset plays the clip's own audio | outside the engine's local, free scope |
| Golden tolerance | 1 ms | the spec's target. Measured deviations are float rounding |

## 12. Tests

- **Unit tests** (`npm test` in `media/`, node:test): expressions, storyboard parsing
  and errors, kit YAML, presets (params, defaults, extends, when, each), planners,
  compose layout, templates and fit, keyframes, effect filter strings, PiP, beats,
  migrate, render argv, cache, inputs, doctor/readme, alignment and end-card layout.
- **Golden tests** (`test/golden.test.mjs`): captured A5 analyses and voice durations →
  timelines equal to 0.1.x within 1 ms for pl and en-us.
- **Integration** (manual, outside `npm test`):
  - migrate a copy of a real 0.1.x kit and render pl/en-us;
  - compare against the 0.1.x renders (SSIM, audio hash, key-frame strips);
  - render the showcase offline.
