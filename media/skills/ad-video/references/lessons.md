# Lessons

Each lesson is a rule, with the failure that produced it. Read before generating.
(Campaign-specific stories are in `worked-example.md`.)

## Clips (image-to-video)

- **Model timing is approximate.** "At 3 s she smiles" lands anywhere from 2 to 4.5 s.
  Never plan cuts around prompt timing. Use analysis (`action-verdict` finds the beat
  from motion) or music beats (`montage`).
- **One continuous clip per beat**, with `image_url` + `end_image_url` keyframes and a
  timestamped prompt. Joining parts works (`clip: [a, b]`), but every join is a risk.
- **No flash or text in the prompt.** Model flashes are random and get mistaken for the
  beat. The engine adds a synthetic flash where the action completes.
- **Never cut inside a motion.** Mid-motion cuts read as glitches. Trim heads and tails,
  and speed up only the setup (≤ 1.3×).
- **The setup must be visible before the payoff.** If the subject has already broken the
  rule in frame 1, there is no story.
- **Montage clips**: one clear continuous motion per clip. The engine uses about 1 s
  from the middle; set `in:` per clip to choose.

## Derived stills (image edit)

- **A still that follows a clip is made from the clip's real last frame** ("same pose,
  same expression, new background"). Generating it from the first frame or the prompt
  makes the cut jump.
- **Verify side by side** (last frame | edit). A head-angle mismatch is the usual miss.

## Graphics and text

- Everything with letters is a template (SVG) drawn by the engine: titles, banners,
  HUDs, stamps, lower thirds, end cards.
- Judgement stamps sit **low**, never over faces. Skip ✗/✓ unless asked.
- The brand bug comes from the **real brand** (a header screenshot works best), never a
  drawn imitation.
- No burned-in captions by default: platforms auto-caption, and extra text competes with
  the hook.
- Keep text inside the safe area (named areas). Use `data-fit-width` for anything
  translated.
- End card: the complete frame stays on screen for the whole announcer line.
- **Parody without copying**: evoke a genre (game HUD, trailer, CCTV), but never use
  its logos, fonts, trade dress, characters, places or sounds.

## Tempo ("bam-bam-bam", the `snappy` profile)

- Hook at 0 s; the first line ≤ 0.1 s after it; every other line on its shot's first
  frame; narrator at 1.1×.
- Reveal: 0.5 s neutral hold → action → flash → 0.25 s hold → cut → stamp +0.1 s with
  the reaction → next cut 0.15 s after it. A whoosh into every cut. The end card ends
  0.3 s after the voice.
- Montage: 1–2 beats per slice; a hit on each cut (zoom-punch or flash) keeps the energy.

## Voice

- **One file per line.** Timing comes from file durations, and multi-line takes can't
  be re-timed.
- **Accent fixes**: generate in context (the sentence before, then cut it), add
  "native {language} pronunciation", and avoid stretched spellings ("nooooo" sounds
  foreign; "No no…" works).
- Display text and generation text differ: keep tags and spoken URLs in the
  `## Voice scripts` table.
- Respect the user's language choices, even where a style guide differs.
- An optional one-word "clerk" role uses `ifMissing: skip`; the stamp's thud carries it.

## Music

- Use one bed slightly longer than the video. The engine levels it −9 dB under the
  measured voice and ducks it −10 dB more under every line (≈ 19 dB under speech). It
  fades the last 0.4 s and mixes to −14 LUFS.
- If voice covers most of the video, the bed is mostly ducked. Raise `levelDb` /
  `duckDb` in `music:` for more music.
- For montages and trailers, ask for a clear tempo and a drop at the payoff. Beats are
  detected; override with `music: { bpm, offset }` if detection is off.

## Engine and storyboard

- Plan before paying: `plan` and `run --offline` work with stand-ins for every missing
  file.
- Errors cite `file:line shot`. Fix the storyboard, not the engine.
- A pattern the built-ins don't cover becomes a project preset (data) in the kit, not a
  change to the engine.
- SFX noise is synthesised and cached. Delete `media-work/.cache/sfx` only if you want
  new noise textures.

## Review workflow

- Use one numbered folder per shot. Options get `(CHOOSE)`, approved folders
  `(DONE - review)`, and a made choice `(chosen A)`. Always look at `key-frames.png`;
  most notes are about the flash or a cut.
- Superseded takes go to `_alt/` and are never deleted (earlier takes get wanted back).

## Costs (verify current prices before quoting)

| Item | Approx. cost |
|---|---|
| FLUX 3 Max i2v, 720p, ~7 s clip | ~$0.43 (discount windows vary; list price ~$0.17/s) |
| Nano Banana still or edit | a few cents |
| ElevenLabs voice line | a few cents (plan credits) |
| ElevenLabs Music track (~35 s) | ~$0.18 |
| A 4-shot video with retakes, voice and music | ≈ $4–6 |
| A montage-heavy video (10–15 clips) | ≈ $8–15 |

Check prices with the fal MCP (`get_pricing` / `estimate_cost`) when the user sets a
budget.
