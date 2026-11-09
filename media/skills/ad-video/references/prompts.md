# Prompt templates

Fill the `{…}` slots. Save each prompt next to the file it produced
(`<file>.prompt.txt`) so a good take can be reproduced.

No-text tail (end of every visual prompt):
`vertical 9:16, no text, no captions, no logos, no watermarks, no frames.`

## Stills (Nano Banana, text-to-image)

**First frame of an action shot**:
```
Photorealistic {subject} in {setting}. Facing the camera directly, head-and-shoulders
framing, centred, eyes clearly visible, {starting state — the rule is being kept:
"mouth closed, calm neutral face" / "hair parted, both eyes visible"}. {light: soft
natural daylight}, shallow depth of field, sharp focus on the face, natural colours.
{no-text tail}
```
State the starting state explicitly: the rule must hold in this frame.

**Person / product scene**:
```
Photorealistic {person: age, look, wardrobe} in {place}, {action}, {expression}.
{light}. {If a phone is visible: "the phone screen shows a plain green screen".}
{no-text tail}
```

**Character reference sheet** (recurring mascot → `media-kit/characters/`):
```
Character reference of {character}: front view, three-quarter view and full body on a
plain light-grey background, consistent proportions, {style}. {no-text tail}
```

## Clips (FLUX 3 Max, image-to-video)

Parameters: `image_url` = first-frame still, `end_image_url` = an edited end frame when
the end pose matters, `aspect_ratio: 9:16`, `resolution: 720p`, `duration: 5–7`,
`generate_audio: false`, fixed `seed`.

```
Static locked-off camera, no camera movement. {subject} in {setting}.
0–{a} s: {neutral start, rule kept: "holds a calm, serious face, lips together"}.
{a}–{b} s: {the physical action that breaks the rule: "breaks into a wide, delighted
grin" / "tilts its head sharply to one side and holds it" / "shakes its head; the long
fringe swings and falls back over both eyes"}.
{b}–{end} s: {holds the result: "keeps the grin, still"}.
Natural subtle movement only. No flash. {no-text tail}
```
For `beat: "settle"` shots make the last segment explicitly motionless.

**End frame for `end_image_url`** (image edit of the first frame):
```
Same {subject}, same setting, same framing and lighting, now {end pose}. {no-text tail}
```

## Edits (Nano Banana, edit)

**Result still** — input: the clip's real last frame
(`ffmpeg -sseof -0.05 -i clip.mp4 -frames:v 1 last.png`):
```
Same subject, same pose, same expression, same head angle and framing. Replace the
background with a plain, evenly lit pure white studio background. Keep every detail of
the face and fur/hair unchanged. {no-text tail}
```
Compare side by side with the last frame before ingesting.

**Perfect photo** (grid end card) — input: the result or first-frame still:
```
Official ID photo of the same {subject}: facing the camera straight on, head level,
neutral expression with mouth closed, both eyes open and clearly visible, nothing covering
the face, centred head-and-shoulders, plain white background, even soft frontal light.
Same individual. {no-text tail}
```

## Voice (ElevenLabs `eleven_v4`)

`tts` carries tags; `text` (display) does not.
```
[warm, amused] {Rule line.}
[disappointed sigh, drawn out, native {language} pronunciation] {Quip}
[incredulous, surprised] {Quip}
[dry, deadpan] {Quip}
```
- Generate a line *in context* when the accent drifts: `[warm, amused] {Hook}. [pause]
  {First line}` → keep only the hook part.
- Spoken URLs: "example dot com" (en), "example kropka com" (pl), …
- Announcer: plain read, no tags; the engine speeds it with `postSpeed` (e.g. 1.2).

## Music (ElevenLabs Music)

```
{mood: playful, light comedic} underscore for a {length}-second vertical video ad.
{instrumentation: pizzicato strings, marimba, hand claps}, around {tempo} BPM, no vocals,
steady energy with small accents every ~6 seconds, ends with a clean button hit at
{video length + 0.5} s.
```
Make 2–3 options with different instrumentation; the user picks.
