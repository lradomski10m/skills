# Prompt templates (by pattern)

Fill the `{…}` slots. Save each prompt next to the file it produced
(`<file>.prompt.txt`) so a good take can be reproduced.

No-text tail (end of every visual prompt):
`vertical 9:16, no text, no captions, no logos, no watermarks, no UI, no frames.`

## Any pattern — first frames and backgrounds (Nano Banana, text-to-image)

**Subject in a setting**:
```
Photorealistic {subject} in {setting}. {framing: facing the camera directly,
head-and-shoulders, centred}, {starting state — what is true before the beat}.
{light: soft natural daylight}, sharp focus on {subject}, natural colours. {no-text tail}
```

**Person / product scene**:
```
Photorealistic {person: age, look, wardrobe} in {place}, {action}, {expression}.
{light}. {If a phone is visible: "the phone screen is a plain flat green surface".}
{no-text tail}
```

**Character reference sheet** (recurring mascot → `media-kit/characters/`):
```
Character reference of {character}: front view, three-quarter view and full body on a
plain light-grey background, consistent proportions, {style}. {no-text tail}
```

**Consistent series**: reuse one look line for every still of a campaign, e.g.
`{look: sunny, saturated coastal city, golden hour, teal/orange grade}`.

## Reveal — one continuous action clip (FLUX 3 Max, image-to-video)

Parameters: `image_url` = the first frame, `end_image_url` = an edited end frame when
the end pose matters, `aspect_ratio: 9:16`, `resolution: 720p`, `duration: 5–7`,
`generate_audio: false`, a fixed `seed`.

```
Static locked-off camera, no camera movement. {subject} in {setting}.
0–{a} s: {setup — the rule is kept / the before state}.
{a}–{b} s: {the one physical action: "breaks into a wide grin" / "tilts its head
sharply and holds it" / "the fringe falls back over both eyes"}.
{b}–{end} s: {holds the result, still}.
Natural subtle movement only. No flash. {no-text tail}
```
For `beat: settle`, make the last segment explicitly motionless.

**End frame** for `end_image_url` (an image edit of the first frame):
```
Same {subject}, same setting, same framing and lighting, now {end pose}. {no-text tail}
```

**Result still**, made from the clip's real last frame
(`ffmpeg -sseof -0.05 -i clip.mp4 -frames:v 1 last.png`):
```
Same subject, same pose, same expression, same head angle and framing. Replace the
background with a plain, evenly lit {background}. Keep every detail unchanged. {no-text tail}
```

## Montage — slices (FLUX 3 Max)

Generate 5 s clips with one clear, continuous motion each; the engine uses ~1 s from
the middle.
```
{camera: handheld third-person / tracking shot} of {subject} {action} through {place},
{look line}. Continuous motion, no cuts. {no-text tail}
```
Vary the camera between slices (wide, close, POV) and keep one look line for all.

## Fail / freeze

```
{camera} {subject} {the failing action: trips at the booth / the photo comes out wrong},
dramatic, {look line}. Ends on a clear, readable pose. {no-text tail}
```
The engine adds the slow motion, freeze, grey wash and banner.

## Demo — the phone

```
{person} {holding the phone / phone on a stand} {setting}, the phone screen is a plain
flat green surface facing the camera, still, {light}. {no-text tail}
```
Record the real app separately. The engine composites it into the screen's quad.

## Dialogue (lip-sync)

1. Generate the line with ElevenLabs (below).
2. Generate the speaker's still, then run a lip-sync model with that audio. Test one
   shot first, especially for non-English accents.
3. Ingest the clip **with its audio**; the `dialogue` preset plays it.

## Edits (Nano Banana, edit)

**Perfect / compliant variant** (e.g. an ID-photo payoff):
```
{the compliant version}: facing the camera straight on, head level, neutral expression,
nothing covering the face, centred, plain {background}, even soft light. Same individual.
{no-text tail}
```

## Voice (ElevenLabs `eleven_v4`)

`tts` text carries tags; the display text in `## Text` does not. Keep the generation
text in a `## Voice scripts` table in the storyboard (the engine ignores it).
```
[warm, amused] {Rule / setup line.}
[disappointed sigh, native {language} pronunciation] {Reaction}
[incredulous] {Reaction}
[dry, deadpan] {Reaction}
[epic trailer voice, whisper] {Trailer line}
```
- If the accent drifts, generate in context: `[warm] {Hook}. [pause] {Next line}`, then
  keep only the first part.
- Spell out spoken URLs: "example dot com", "example kropka com".
- Announcer: a plain read with no tags. `postSpeed` in `voices.yaml` (e.g. 1.2) is
  applied when you speed the take up.

## Music (ElevenLabs Music)

```
{mood: playful / epic trailer / phonk / lo-fi} underscore for a {length}-second vertical
video ad. {instrumentation}, around {tempo} BPM, no vocals, {structure: steady energy
with accents every ~6 s / a build to a drop at {t} s}, ends with a clean button hit at
{video length + 0.5} s.
```
Make 2–3 options with different instrumentation and let the user pick. Montages cut on
the detected beats; put a drop where the payoff lands.
