# Lessons

Each lesson is a rule, with the failure that produced it. Read before generating.

## Clips (image-to-video)

- **Model timing is approximate.** "At 3 s she smiles" lands anywhere from 2 to 4.5 s.
  Never plan cuts around prompt timing; the engine detects the beat from motion.
- **One continuous clip per shot**, `image_url` + `end_image_url` keyframes and a
  timestamped prompt. Stitching parts works (`action` parts) but every join is a risk.
- **No flash in the prompt.** Model flashes are random and were mistaken for the beat.
  The engine adds a synthetic flash at the action's **completion** (the grin fully
  formed), not at its onset.
- **Never cut inside a clip.** Mid-motion cuts read as glitches. The engine only trims
  the neutral head (to a 0.5 s hold) and speeds the prelude ≤ 1.3×.
- **The rule must be visible before it is broken.** A clip whose subject already broke
  the rule in frame 1 has no story (hair over the eyes from the start).

## Result and perfect stills (image edit)

- **Result still = the clip's actual last frame**, edited to a white background ("same
  pose, same expression"). Generating it from the first frame or the prompt makes the
  cut jump.
- **Verify side by side** (last frame | result). Head-angle mismatch is the common miss.
- **Perfect photos** are the payoff: compliant (neutral, head straight, eyes visible,
  plain background) yet recognisably the same individual.

## Graphics

- Stamps sit **low** (bottom edge ~90 px above the frame), never over faces; no ✗/✓.
- The brand bug comes from the **real brand** (a screenshot of the site header works
  best), never a drawn imitation.
- No burned-in captions or rule labels by default: platforms auto-caption and extra text
  competes with the hook.
- End card: the complete frame (sheet + stamp) stays on screen for the whole announcer
  line; the sheet is the majority of the screen.

## Tempo ("bam-bam-bam")

- Hook at 0 s; first line ≤ 0.1 s after it; every other line on its shot's first frame;
  narrator at 1.1×.
- 0.5 s neutral hold → action → flash → 0.25 s hold → cut → stamp +0.1 s with the quip →
  next cut 0.15 s after the quip. Whoosh into every cut. End card ends 0.3 s after the VO.

## Voice

- **One file per line.** Timing comes from file durations; multi-line takes can't be
  re-timed.
- **Accent fixes**: generate in context (the sentence before in the same take, then cut);
  add "native {language} pronunciation" to the tag; avoid stretched spellings
  ("nooooo" sounds foreign — "No no…" works).
- Spoken URL via `tts` ("example dot com"); display text stays "example.com".
- Respect the user's language choices even where a style guide differs.
- A one-word "clerk" role is optional (`ifMissing: "skip"`); the stamp's thud carries it.

## Music

- One bed slightly longer than the video. The engine levels it −9 dB under the measured
  voice loudness and ducks it −10 dB more under every line (≈ 19 dB under speech), fades
  the last 0.4 s, final mix −14 LUFS, true peak ≤ −1 dB.
- When voice covers most of the video the bed is mostly ducked; raise `levelDb` /
  `duckDb` (spec `music`) if the user wants more music.

## Review workflow

- Numbered folders per shot; options get `(CHOOSE)`, approved `(DONE - review)`, a made
  choice `(chosen A)`. Always include frames around the flash — most notes are about it.
- Superseded takes go to `_alt/`, never deleted (earlier takes were wanted back twice).

## Costs (verify current prices before quoting)

| Item | Approx. cost |
|---|---|
| FLUX 3 Max i2v, 720p, ~7 s clip | ~$0.43 (discount windows vary; list price ~$0.17/s) |
| Nano Banana still or edit | a few cents |
| ElevenLabs voice line | a few cents (plan credits) |
| ElevenLabs Music track (~35 s) | ~$0.18 |
| A 4-shot video with retakes, voice, music | ≈ $4–6 |

Check prices with the fal MCP (`get_pricing` / `estimate_cost`) when the user sets a budget.
