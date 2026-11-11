# Phase 3 — Production

`E` is the engine CLI (`${CLAUDE_SKILL_DIR}/../../engine/cli.mjs`). Run commands from
the project root; `media-kit/` and `media-work/` are found there (or pass `--kit` /
`--work`).

## 1. Script table

Use `templates/media-kit/campaigns/_template/script-table.md`, with one row per beat:
**beat · what we see · what we hear · on-screen text · pattern**. Then add the hook, the
end card and the music mood. Rules that make it work:

- One idea per beat. The setup must be visible before the payoff.
- A beat a model must render is one physical event (a grin, a head tilt, hair falling,
  an item dropping), not a feeling.
- Keep lines short: ≤ ~6 s of voice per beat at 1.1× speed.
- Each beat names a pattern from `patterns.md`. If none fits, say so now and agree on a
  project preset.

Get it approved before any generation.

## 2. Storyboard

Write `media-kit/campaigns/<id>/storyboard.md` (format: `storyboard.md`). Put prompts
in each shot's prose and text in `## Text`. Then:

```bash
node "$E" plan <id> --locale=<l>       # validate + resolve the timeline with stand-ins (free)
node "$E" run <id> --locale=<l> --offline   # a rough cut with synthetic stand-ins (free)
```

Show the plan's shot list (start, length) to the user before paying for anything.

## 3. Generation → ingest

Every generated file goes in through `ingest`, from a download URL or a local path:

```bash
node "$E" ingest <url|file> --campaign=<id> --as=<role> [--locale=<l>]
```

| Role | Lands in |
|---|---|
| `vo:<key>` (e.g. `vo:quokka.line`, `vo:hook`, `vo:endcard.announcer`) | `1-voice/<locale>/<key>.mp3` (needs `--locale`) |
| `still:<key>`, `result:<shot>`, `perfect:<shot>`, `intro:<shot>` | `2-stills/` |
| `clip:<key>` | `3-clips/<key>.mp4` |
| `music` | `4-music/bed.mp3` |

Images are converted to PNG and audio to MP3. **Clips are normalised**: re-encoded to a
constant 30 fps, colour tags cleared to unspecified, yuv420p, audio dropped; the command
prints what it changed (`normalised: 24 fps → 30 fps; colour tags bt709 → unspecified;
1 audio track dropped`) and copies a clip that already conforms. This matters: BT.709
tags on some clips make ffmpeg re-initialise the filter graph mid-video, and VFR screen
recordings make trims drift. A lip-synced `dialogue` clip keeps its sound with
`--keep-audio`.

Voice flags (`vo:*` only):

| Flag | Does |
|---|---|
| `--until=<s>` | cut the take at `<s>` with a 0.15 s fade-out |
| `--first-utterance` | keep the first reading: cut after the first speech followed by a ≥ 0.35 s pause (ffmpeg `silencedetect`), with the fade; prints what it cut, or keeps a single-reading take whole |

`eleven_v4` often reads a short line 2–5 times in one take; listen, then use
`--first-utterance` (or `--until` when the pause is too short to detect). Keep the prompt
that made each file (`<file>.prompt.txt` next to it). Log the spend with
`node "$E" spend …`.

## 4. Assemble and review

```bash
node "$E" run <id> --locale=<l>                # missing inputs → stand-ins; never pays
node "$E" run <id> --locale=<l> --only=<shot>  # one shot
node "$E" review <id> --locale=<l>             # rebuild review/<locale>/
```

The engine plans everything:

- beats detected from the clips and the music;
- flashes, cuts and stamps;
- the brand bug, transitions and effects;
- template overlays, rendered and animated;
- the end card;
- music levelled and ducked under every line, mixed to −14 LUFS.

Never hand-time a render. Change the storyboard, a preset param or a project preset.

Every ffmpeg call runs under a watchdog: the final pass prints progress
(`final pass 31.0/68.2 s (45%) · 0.9× realtime`), and a pass whose output time stops
advancing for 120 s (`render.watchdog.stallSec`) is killed with a "stalled" error. That
is a filter-graph bug, usually in a custom `hooks.mjs` effect, never a reason to wait.

The music bed plays once. If it is shorter than the video, the log says
`WARNING music bed is 3.20s shorter than the video …`: it fades at its end and the rest
is silent. Fix the bed (generate longer, or re-cut it); use `music: { loop: true }` only
for a bed made to loop.

### Transitions

`transition: { name, durSec }` on a shot (or `cuts: { transition: … }` for all):
`flash-cut`, `dip`, `dip-white`, `whip` (centred on the cut), `dissolve` (crossfade) and
`slide` (slide-over; `direction: left|right|up|down`). None changes timing; `dissolve`
and `slide` hold the outgoing shot's last frame against the first `durSec` of the next
shot, so keep them short (0.2–0.5 s).

### Music cut to picture

When shot lengths change (a regenerated clip, Kling's own shot lengths, a tighter
edit), the music cues drift off the picture: the silence on the fail, the relief on the
payoff. Re-cut the bed rather than nudging shots:

1. Measure the beat period first: the run log prints `beats <n> BPM` for the bed, or
   take it from the music prompt. One beat = 60 / BPM s.
2. Cut and splice the bed **on whole beats** (or whole bars) only, so the groove never
   stumbles; add or remove whole beats to move a cue.
3. Keep the cue times (fail silence, relief start, drop) in `concept.md`, and check them
   against the plan's shot starts after every re-cut.
4. Ingest the re-cut bed with `--as=music`; the old one moves to `_alt/`.

### Phone demos with real recordings

- Record the real app once per locale, following the same script and timing.
- Speed up the waiting parts (uploads, processing) 2.5–8× and play the results in real
  time; then `hold` on the result (the recording freezes while voice and music go on)
  and land the stamp on the first frozen frame (`verdict`, `stampAt`).
- Make every locale's recording match the same timeline (same lengths per segment), so
  one storyboard serves every locale; only the recording differs, set per locale in a
  `storyboard.<locale>.md` `## Shot` block (`recording: app-en`).
- Ingest recordings with `--as=clip:<id>` too: screen recordings are variable frame
  rate.

The review folder has:

- `<n> - <shot>/`: the inputs that shot used, plus `key-frames.png` (flash, cut, stamp,
  slices);
- `<n> - end card/`: the final frame and the entrance strip;
- `video.mp4` and `README.txt`.

Check every key frame yourself first: the flash lands on the completed action, the
result matches the last frame, no stamp or overlay sits on a face, nothing is cut
mid-motion, and the text is readable inside the safe area. Put options for the user in
`<n> - <topic> (CHOOSE)/`.

`media-work/<campaign>/README.md` is rewritten after every render. It lists the inputs
per shot (and which are still stand-ins), the last render, the next step and the spend.

## 5. Feedback loop

Classify each note:

- **Timing, layout or mix**: change the storyboard, a param or a preset (free re-render).
- **Content** (pose, expression, accent): regenerate that asset only (paid, ask first),
  ingest it, re-render.
- **A new pattern**: write a project preset in `media-kit/presets/`. Use `hooks.mjs`
  only for a true one-off.

## 6. Localize

Add a locale column to `## Text` (or a `storyboard.<locale>.md` for long copy), plus
`copy/<locale>.yaml` and a `voices.yaml` entry for the locale. Visuals, clips and music
are shared; only voices are new (`1-voice/<locale>/`). Prove it with
`node "$E" run <id> --locale=<l> --offline`, then generate the real lines.

Check per locale:

- stamp labels;
- the stamp phrase;
- sheet tagline, order line and QR URL;
- CTA, "link in bio" wording and the spoken URL;
- whether template text still fits (`data-fit-width`).

## 7. Publish

- [ ] Final review approved; the run log shows −14 LUFS.
- [ ] Hook variants and cut-downs (6 s / 15 s) as `extends` storyboards, if wanted.
- [ ] Landing page / coupon for attribution, if the product has one.
- [ ] Post caption, hashtags and pinned comment from the kit copy; **AI label** on every
      platform.
- [ ] Test the full product flow inside the TikTok / Instagram in-app browsers.
- [ ] Post organically first; boost the variant with the best 3-second hold.
- [ ] Promote approved reusable items into `media-kit/`.
