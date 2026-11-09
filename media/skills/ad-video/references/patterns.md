# Patterns

Ad patterns are the building blocks of a concept. Each one maps onto a built-in
**preset** (in the engine) or onto a small project preset you write in
`media-kit/presets/`. Combine them freely: a concept is a sequence of beats, and each
beat is one pattern. For the storyboard syntax, see `storyboard.md`. For prompts, see
`prompts.md` (the sections there have the same names).

Run `node "$E" presets` for the live list with every param.

| Pattern | Built-in preset | What it is | Typical use |
|---|---|---|---|
| Hook | front matter `hook:` (`hook-title`) | 1–2 s title, optionally spoken | every video |
| Reveal | `action-verdict` | setup → action → flash → judgement (stamp) + reaction | "rules broken by…", tests, before/after with a verdict |
| Title card | `title-card` | full-screen card from a template, timed or voiced | mission card, chapter, statistic, trailer card |
| Montage | `montage` | slices of many clips cut on the beat, optional hits | the grind, a decade, a phonk edit, a trailer |
| Fail / freeze | `game-fail` | slow-mo → freeze → grey wash → banner + reason | game parody, "it went wrong" |
| Demo | `phone-demo` | real app recording composited into a phone screen | the product moment |
| Dialogue | `dialogue` | a lip-synced clip with its own audio + lower third | street interview, talking object |
| Clip / still | `clip`, `still` | one clip (in/out, speed, reverse, freeze) or a still with Ken Burns | connective shots, rewinds, B-roll |
| End card | front matter `end:` (`end-card-*`) | CTA, approve stamp, optional photo grid / sheet | every video |
| Look | `effects:` on any shot | grade/LUT, CCTV, VHS, shake, zoom-punch, blur, vignette | found footage, nostalgia, energy |
| Transition | `transition:` on a shot | cut, flash-cut, dip, dip-white, whip | montage rhythm, trailer cuts |
| HUD / overlays | `overlays:` on a shot | template overlays, animated (counters, meters, maps, timers) | games, data, objectives |

## Hook

- **Inputs**: a text key; an optional voice line `hook`.
- **Storyboard**: `hook: { text: { t: hook }, line: hook, duration: 2 }`.
- **Pitfalls**: keep it ≤ 2 s. A spoken hook delays the first shot's line (the engine
  handles it). Write hook variants as `extends` storyboards.

## Reveal (`action-verdict`)

- **Inputs**: a continuous clip (`clip`), an optional `result` still made from the
  clip's last frame, a `line` and an optional `quip`. `intro`/`introClip` give context
  first.
- **How it plays**: the line plays over the setup. The beat is found by analysis
  (`beat: action` for a burst, `settle` when the subject ends still). A synthetic flash
  fires when the action completes. With `result`, the video cuts to that still, then the
  stamp (`verdict: reject|approve|none`) and the quip play, followed by the next cut.
- **Pitfalls**: the setup must be visible before it is broken. Model timing is
  approximate, so trust analysis, not the prompt. The result still must match the last
  frame. Stamps sit low, off faces.

## Title card (`title-card`)

- **Inputs**: a template (kit or built-in `title-card`, `banner`, `lower-third`), text,
  an optional background (still or clip), and an optional voice line and sting.
- **Pitfalls**: one idea per card. Use `animate` for entrances (`opacity`, `scale`).
  Keep text inside the safe area (named areas).

## Montage (`montage`)

- **Inputs**: a list of clips. Slices end on the music beat (`every: N` beats), or use
  `sliceSec` without music. `hits: zoom-punch | shake | flash-cut` adds an accent at
  every cut. Put HUD overlays on the same shot.
- **Pitfalls**: 0.5–1.5 s slices read best. Generate 5 s clips and let the engine pick
  the middle (`in:` per clip to choose). Beats come from the music bed; set
  `music: { bpm, offset }` to override them.

## Fail / freeze (`game-fail`)

- **Inputs**: a clip, the `slow` and `hold` timing, a `banner` text, an optional
  `reason`, and a `template` (your own banner art).
- **Pitfalls**: never copy a real game's font, logo, colours or sounds. Make your own
  banner template in the kit.

## Demo (`phone-demo`)

- **Inputs**: a still (or clip) of a phone with a flat screen area, the screen
  recording (`media-kit/footage/` or `3-clips/`), and the screen's `quad` corners in
  frame pixels. Optional `timer`.
- **Pitfalls**: generate the phone with a plain green or grey screen and keep it still.
  Measure the quad on the 1080×1920 frame, after cover-scaling.

## Dialogue (`dialogue`)

- **Inputs**: a lip-synced clip that carries its own audio. Make it with a lip-sync
  model from an ElevenLabs line. An optional lower third.
- **Pitfalls**: generate the speech first, then lip-sync to it (video models' accents
  are unreliable). The engine plays the clip's audio and ducks the music under it.

## Before / after, countdown, rewind

- **Before/after**: two `still` or `clip` shots with a `flash-cut` or `whip`, then a
  judgement overlay (`builtin:stamp`) or a `title-card`.
- **Countdown**: a `title-card` whose template shows `{{value|int}}`, with
  `animate: { value: [[0, 3], [3, 0]] }`.
- **Rewind**: `clip` with `reverse: true` + `effects: [{ name: vhs }]` + `transition: dip`.

## End card (`end-card-*`)

- **Styles**: `classic` (logo, copy, CTA, stamp); `grid` / `grid-strip` / `tilted` /
  `real-sheet` (a 2×2 photo sheet when each of 4 shots has a perfect photo).
- **Copy**: the CTA, hint and sheet text come from `copy/<locale>.yaml` `endCard`. The
  announcer line is a voice key.
- **Pitfalls**: keep the complete frame on screen for the whole announcer line (the
  preset does this). The CTA text must contain the URL.

## When no pattern fits

1. Combine existing presets with shot-level `overlays:` / `effects:` / `audio:`.
2. Write a project preset in `media-kit/presets/<name>.md` (params, planner, emits;
   see `storyboard.md` §Presets). It is data and reusable.
3. Only for something truly one-off: `media-kit/campaigns/<id>/hooks.mjs`.
