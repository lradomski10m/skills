# Shot types

**built** = the engine plans and renders it · **partial** = pieces exist ·
**todo** = needs a planner + graphics in the engine before a concept can use it.
New types follow the engine rules: timing in a pure planner (`alignment.mjs` /
`timeline.mjs`) with tests, literals in `constants.mjs`, tunables in `config.mjs`.

## Action → verdict (built)

A subject breaks a rule on camera → camera flash → hard cut to the "taken" photo on a
plain background → reject stamp + a short spoken reaction.

- **Inputs**: `2-stills/<shot>.png` (first frame), `3-clips/<shot>.mp4` (one continuous
  clip), `2-stills/<shot>.result.png` (made from the clip's last frame), voice line + quip.
- **Spec**: `verdict: "rejected"`, `beat: "action"` (a burst: grin, tilt, hair drop) or
  `"settle"` (ends in stillness: eyes swivel, a pose), `flash: "auto"`, optional
  `action: [{ file, in?, out? }]` for named or multi-part clips.
- **Timing (snappy)**: line over the prelude → synthetic flash when the action completes
  → 0.25 s hold → cut → stamp + quip → next cut.
- **Prompt**: `prompts.md` §Clips.
- **Pitfalls**: model timing is approximate (the engine finds the beat from motion);
  the result still must match the last frame; the rule must be visible before it breaks;
  `settle` falls back to 0.3 s before the end when motion is too weak to read.

## Approved payoff (built, lightly used)

`verdict: "approved"`: a shot that plays out with no beat detection — the product doing
it right (a person at home, the app result). Approve stamp optional.

## Hook / title (built)

Plain text with a dark halo in the top safe area, plus an optional spoken hook
(`hook.text`, `hook.vo`, `hook.durationSec`). Keep it ≤ 2 s. Hook variants are separate
`extends` specs.

## End card: grid styles (built)

The subjects' **perfect** photos as a 2×2 print sheet (needs one perfect photo per shot,
exactly 4 shots), fading/sliding in; the approve stamp lands; the announcer speaks over
the finished frame; CTA button below. Styles (`endCard.style` or kit `brand.json`):
`real-sheet` (sheet + brand panel: header, real QR, "before" thumbnail, URL, order line,
tagline), `grid` (photos + crop marks only), `grid-strip` (+ slim brand strip),
`tilted` (white sheet, slight rotation).

- **Spec / kit**: `endCard { copy, cta, ctaHint, announcer, stampAtPhrase, sheet { tagline,
  order, qrUrl, url? } }` — `sheet` only for `real-sheet`.

## End card: classic (built)

Logo, copy, CTA, stamp, optional dimmed background clip (`3-clips/endcard.mp4`). Used
when the style is `classic` or perfect photos are missing.

## Intro (built)

A still (or clip) of the subject in context before the action clip, with a push-in and a
shutter-click cut. Files: `2-stills/<shot>.intro.png` or `3-clips/<shot>.intro.mp4`.

## Full-screen caption card (partial)

A word that owns the screen for a beat (WASTED, MISSION PASSED, AURA: MAXED, a statistic,
"4 years on your ID"). Text rendering and stamps exist; missing: a `card` segment kind in
the timeline, a grey-wash/desaturate filter, card styles (font, colour, slam-in), spec
`cards: [{ at, text, style }]`. Never imitate a real game's font, logo or sound.

## Dialogue / lip-sync (todo)

A character speaks on camera (street interview, talking object, officer). Needs: a
lip-sync model choice (test one shot first — cost, accent quality per language), a
`dialogue` shot kind timed by its audio (no flash), character voice roles. Generate the
speech in ElevenLabs and lip-sync to it rather than letting the video model speak.

## Beat-cut montage (todo)

Fast cuts on the music beat (trailer, "edit" with a bass drop, decade montage). Needs:
onset/BPM detection on the music bed, a planner placing cuts on beats with speed ramps,
shake/zoom-punch filters, a drop anchor for the flash. Plan 0.5–1.5 s slices of 5 s clips.

## CCTV / found-footage look (todo)

Grainy night security footage with a drawn timestamp ("CAM 03 03:12:44"). Needs: a look
filter (desaturate, noise, vignette, low frame rate, slight fisheye), a drawn camera-label
overlay, per-shot `look: "cctv"`. The model must not draw the timestamp; generate clean at
720p and degrade in the engine.

## Product demo insert (todo)

A real screen recording or product shot from `media-kit/footage/` cut in or composited
on a phone screen (generate the phone with a plain green screen, key in the recording).
Needs: a `footage` segment kind and a chroma-key composite.
