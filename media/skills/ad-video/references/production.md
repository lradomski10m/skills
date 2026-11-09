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

Images are converted to PNG, audio to MP3, and video is re-muxed to MP4. Keep the prompt
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
