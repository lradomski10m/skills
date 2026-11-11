# Storyboard format

`media-kit/campaigns/<id>/storyboard.md` is one file per campaign: YAML front matter,
a `## Text` table, and one `## Shot <id> — <title>` section per beat, each with exactly
one fenced `yaml` block. Prose anywhere is for people and agents; the engine ignores
it. Check a storyboard with `node "$E" plan <id> --locale=<l>`. Errors read
`storyboard.md:42 shot grind: cut.every: …`.

````markdown
---
campaign: my-ad                 # required — names media-work/<campaign>
title: My ad
locales: [en-us, pl]            # required
tempo: snappy                   # snappy | relaxed (+ tempoOverrides: {…})
cuts: { sfx: whoosh }           # a sound into every cut after the first (+ transition: {…})
hook: { text: { t: hook }, line: hook, duration: 2 }
brandBug: { from: 0 }           # the kit's brand bug over the shots
music: { bed: bed }             # 4-music/bed.mp3 (+ loop: true); or { bpm: 118, offset: 0.4 } / { beats: [...] }
end: { preset: end-card-classic, line: endcard.announcer, copy: { t: endcard.copy } }
overlays: []                    # campaign-wide overlays (global time)
captions: false
---

## Text
| key | en-us | pl |
|---|---|---|
| hook | Passport photo rules | Wymagania zdjęcia |

## Shot quokka — neutral expression
Intent, prompts, notes …
```yaml
preset: action-verdict
clip: quokka
result: quokka.result
line: quokka.line
quip: quokka.quip
```
````

- **Text**: write `{ t: key }`, a literal string, or `"… {{t.key}} …"`. Keys missing
  from `## Text` fall back to `copy/<locale>.yaml` → `text:`. A missing cell is an error.
- **Per-locale overlay**: `storyboard.<locale>.md` with optional YAML front matter, a
  `## Text` table (`| key | text |`) and/or `## Shot <id>` yaml blocks that override
  fields. Front-matter keys `title`, `tempo`, `tempoOverrides`, `cuts`, `hook`,
  `brandBug`, `overlays`, `music`, `end` and `captions` deep-merge over the
  storyboard's for that locale only (e.g. a locale-specific end-card sheet:
  `end: { sheet: sheet-en }`, or a different bed). `campaign`, `locales`, `extends` and
  `shots` can't change per locale; other keys are errors (typos).
- **Music bed**: `music: { bed }` plays once. A bed shorter than the video fades at its
  own end and leaves silence (the run warns with the shortfall); add `loop: true` to
  loop it instead. Other keys: `levelDb`, `duckDb`, `attackSec`, `releaseSec`,
  `mergeGapSec`, `fadeOutSec`.
- **Cut-downs**: a file with `extends: storyboard.md` and `shots: [a, b]` in its front
  matter.
- **Assets**: keys resolve inside `media-work/<campaign>/`:
  - `clip: x` → `3-clips/x.mp4`; `[a, b]` or `[{file, in, out}]` joins parts.
  - `still: x` → `2-stills/x.png`; voice `x` → `1-voice/<locale>/x.mp3`.
  - `kit:footage/app.mp4` points into the kit.
  - Anything missing gets a free stand-in, so you can plan before generating.

## Shot keys

Each shot has `preset:` and that preset's params (see `node "$E" presets`), plus:

- `transition: { name: cut|flash-cut|dip|dip-white|whip|dissolve|slide, durSec, direction }`:
  on the cut into this shot (or for every cut: front matter `cuts: { transition: {…} }`).
- `effects: [ { name, from, to, params } ]`: looks on a time window.
- `overlays: [ … ]` and `audio: [ … ]`: extra items, in the same form as in presets.

## Anchors (timing expressions)

Any `at`, `from`, `to` or `when` accepts an expression. Times are shot-local (0 = shot
start).

| Ref | Meaning |
|---|---|
| `end`, `duration`, `start`, `shotStart` (global) | this shot |
| `plan.<event>` | planner events (e.g. `plan.stampAt`, `plan.freezeAt`, `plan.starts`) |
| `$param`, `$param.durationSec` | the shot's params (assets carry `file`, `durationSec`) |
| `beat.next`, `beat.3`, `downbeat.1`, `drop` | music beats relative to the shot |
| `global.shots.end`, `global.total`, `global.<shot>.<export>` | campaign events |
| `kit.url`, `copy.endCard.cta`, `config.<path>`, `tempo.<path>` | kit, copy and engine settings |
| `first`, `last`, `index`, `each` | position, and the current element of `each:` |

Operators: `+ - * /`, comparisons, `&& || !`, `a ? b : c`, `a ?? b` (fallback), and
`max min clamp round abs defined beatAfter(t, n) beatBefore(t, n)`. In `params` values,
`$x` is a param and `=expr` is an expression; anything else is literal.

## Overlays

```yaml
- template: counter                  # media-kit/templates/counter.svg, else the engine's
  params: { value: 0, prefix: "$" }
  from: 0
  to: end
  place: { area: hud-top-right }     # or { anchor: top|center|bottom|full, x, y, dx }
  animate: { value: [[0, 0], ["=end", 120]], ease: out }   # params + opacity/scale/dx/dy
  when: "$timer"
- { template: "builtin:stamp", params: { verdict: reject }, from: plan.stampAt, to: end }
- { pip: $recording, quad: [[x,y],[x,y],[x,y],[x,y]], from: 0, to: end }
```

A `pip` takes `in`, `out` (source seconds), `speed` and `hold` (s): with `hold` the clip
plays once to `out` and its last frame freezes for `hold` seconds; without it the clip
loops. `phone-demo` exposes this as its `hold` param.

Areas: `full`, `center`, `top-band`, `bottom-band`, `hud-top-left`, `hud-top-right`,
`hud-bottom-left`, `hud-bottom-right`. Built-in graphics: `builtin:hook`, `brand-bug`,
`stamp`, `rule`, `mark`, `photo-sheet`, `endcard-base`, `endcard-full`.

Add `each: <list>` to repeat an item. For example, `each: plan.starts` puts a hit at
every montage cut.

## Templates (SVG)

- Put them in `media-kit/templates/<name>.svg`. They are rendered by resvg with the kit's
  fonts (`brand.yaml` `font.files`) plus the bundled Inter.
- **Placeholders**: `{{param}}` with filters `|upper`, `|lower`, `|int`, `|fixed:N`,
  `|time` (m:ss), `|pad:N`, `|invert`, `|scale:N`, `|default:text`. Also
  `{{colour.<name>}}` (kit colours) and `{{font.family}}`.
- **Metadata** in the first comment:
  `<!-- template: { size: [w, h], params: {…}, place: { area: … } } -->`.
- **Text fitting**: `data-fit-width="N"` on a `<text>` shrinks it until it fits.
- **No `pathLength`**: resvg ignores it, so use real lengths for dash animations.
- The engine ships neutral examples: `title-card`, `banner`, `lower-third`, `objective`,
  `counter`, `timer`, `stars`, `route-map`. Copy one into the kit and restyle it.

## Effects and transitions

| Name | Params | Use |
|---|---|---|
| `flash` | `alphas` | white flash at `from` |
| `grey-wash` | `rampSec`, `saturation`, `darken` | fail / freeze |
| `shake` | `amp`, `freq` | impact |
| `zoom-punch` | `amount`, `attackSec`, `releaseSec` | beat hits |
| `grade` | `lut` (kit .cube), `contrast`, `saturation`, `gamma`, `brightness`, `tint [r,g,b]` | look |
| `cctv` | `saturation`, `noise`, `vignette`, `fps` | found footage |
| `vhs` | `shift`, `noise`, `saturation`, `blur` | nostalgia, rewind |
| `blur`, `vignette` | `sigma` / `angle` | focus |

Transitions (`transition:` on a shot, or `cuts: { transition: … }` for every cut) never
change timing:

| Name | Params | Does |
|---|---|---|
| `flash-cut` | `durSec`, `alphas` | white flash centred on the cut |
| `dip`, `dip-white` | `durSec` | through black / white, centred on the cut |
| `whip` | `durSec`, `blur` | horizontal blur across the cut |
| `dissolve` | `durSec` (0.35) | crossfade: the outgoing shot's last frame fades out over the first `durSec` of the incoming shot |
| `slide` | `durSec` (0.35), `direction: left\|right\|up\|down` (left) | slide-over: the incoming shot slides in (cubic ease-out) over the outgoing shot's last frame |

`dissolve` and `slide` start on the cut: the shots are concatenated before effects, so
the outgoing side is its held last frame, not more footage. Keep `durSec` short
(0.2–0.5 s) and don't put a voice-critical frame in the first `durSec` of a shot.

## Presets (project presets)

Write `media-kit/presets/<name>.md`: front matter (`name`, `summary`, optional
`extends`), docs as prose, and one yaml block:

```yaml
params:                     # type: clip|still|vo|sfx|music|kit|text|number|bool|enum|time|list|object|any
  clip: { type: clip, required: true, doc: … }
  label: { type: text, default: "=copy.text.label" }
plan: { planner: clip, args: { clip: $clip, speed: 0.5, freezeTail: 1.5 } }
audio:    [ { sfx: thud, at: plan.freezeAt } ]
overlays: [ { template: banner, params: { text: $label }, from: plan.freezeAt, to: end } ]
effects:  [ { name: grey-wash, from: "plan.freezeAt - 0.3", to: end } ]
exports:  { freeze: plan.freezeAt }     # → global.<shot>.freeze
```

Planners:

| Planner | Does |
|---|---|
| `reveal` | analysed beat + flash + result cut |
| `hold` | background for a duration |
| `clip` | in/out, speed, reverse, freeze |
| `montage` | slices on beats |
| `endcard` | closing card timing |
| `hook` | the opening title |
| `none` | no timing of its own |

A kit preset with a built-in's name replaces it for this project.

## Escape hatch

`media-kit/campaigns/<id>/hooks.mjs` may export:

- `transform(timeline, ctx)`, which edits the resolved timeline;
- `effects: { name: (effect, inLabel, outLabel, k) => ffmpegFilterText }` (a hook effect
  named like a built-in replaces it). Rules learnt the hard way: use frame indices
  (`Math.round(t * 30)`) for cuts, never float seconds; never `xfade` two trims of one
  stream; keep every branch on the base's timestamps from t=0; at most two `split`
  branches per effect (a 3-way split chained over many cuts buffers without end — the
  render watchdog then kills it);
- `analysers: { name: (file, ctx) => … }`.

It runs only for that campaign and is logged. If a hook keeps coming back, turn it into
a preset.
