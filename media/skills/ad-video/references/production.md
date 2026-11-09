# Phase 3 — Production

`E` is the engine CLI (`${CLAUDE_SKILL_DIR}/../../engine/cli.mjs`). Commands run from the
project root; `media-kit/` and `media-work/` are found there (or `--kit` / `--work`).

## Script table

Use `templates/media-kit/campaigns/_template/script-table.md`. Rules that make it work:
- One idea per shot; the rule must be **visible before it is broken**.
- The beat is one physical event a model can render (grin, head tilt, hair falls,
  eyes swivel, item drops) — not a feeling.
- Lines are short: total VO ≤ ~6 s per shot at 1.1× speed.
Get it approved before any generation.

## Spec

`media-kit/campaigns/<campaign>/base.json` holds what all languages share: `campaign`,
`look.stillTemplate` (with `{subject}`), shots (`id`, `subject`, `videoPrompt`, `beat`,
`flash`, `verdict`, `seed`, optional `action` parts), `hook.durationSec`, `endCard.durationSec`,
optional `endCard.style`, `music`, `tempo`. Each `<locale>.json` overlay: `"base": "base.json"`,
`id`, `locale`, `hook { text, vo }`, per-shot `caption` + `vo { line, quip }`, `labels`,
`clerkLines`, `endCard { copy, cta, ctaHint, announcer, stampAtPhrase, sheet }`, and
`voices` unless the kit cast covers them. Lines are `"text"` or `{ "text", "tts" }`
(`tts` carries emotion tags and spoken URLs, e.g. "example dot com").

```bash
node "$E" run <campaign> --locale=<l> --dry-run      # validate; names every missing locale key
```

## Generation → ingest

Every generated file goes in through `ingest` (download URL or local path):

```bash
node "$E" ingest <url|file> --campaign=<id> --as=<role> [--locale=<l>]
```

| Role | Lands in |
|---|---|
| `vo:<shot>.line`, `vo:<shot>.quip`, `vo:hook`, `vo:endcard.announcer`, `vo:clerk.rejected` | `1-voice/<locale>/` (needs `--locale`) |
| `still:<shot>`, `result:<shot>`, `perfect:<shot>`, `intro:<shot>` | `2-stills/` |
| `clip:<shot>` (or `clip:<name>` for multi-part `action` files) | `3-clips/` |
| `music` | `4-music/bed.mp3` |

Images are converted to PNG, audio to MP3, video re-muxed to MP4. Keep the prompt that
made each file (`<file>.prompt.txt` next to it) so a good take can be reproduced.

## Assemble and review

```bash
node "$E" run <campaign> --locale=<l> --inputs              # free; missing items → stand-ins
node "$E" run <campaign> --locale=<l> --inputs --only=<shot> # one shot
node "$E" review <campaign> --locale=<l> --inputs           # rebuild review/<locale>/
```

The engine plans everything: flash on action completion, cuts, stamps, the brand bug,
whooshes, the end card, music levelled and ducked under every line, −14 LUFS. Never
hand-time anything; change the spec or the engine config instead.

Review folder: `1 - <shot>/` (inputs used + `frames-around-flash.png`), `<n> - end card/`
(final frame + entrance strip), `video.mp4`, `README.txt`. Check the flash frames yourself
first: flash on the completed action, result still matching the last frame, stamp clear
of faces, nothing cut mid-motion. Options for the user go in `<n> - <topic> (CHOOSE)/`;
approved folders get `(DONE - review)`.

`media-work/<campaign>/README.md` is regenerated after each render: inputs present,
last render, what to review next, spend so far.

## Feedback loop

Classify each note:
- **Timing / layout / mix** → spec or engine config, re-render (free).
- **Content** (pose, expression, accent) → regenerate that asset only (paid, ask), ingest, re-render.
- **New shot type** → write it up in `shot-types.md`, then build it in the engine: pure
  planner + tests, literals in `constants.mjs`, tunables in `config.mjs`.

## Localize

Add `<locale>.json`. Visuals, clips and music are shared; only voice is new
(`1-voice/<locale>/`). Prove the path first with `node "$E" run <campaign> --locale=<l> --offline`
(stand-in voice), then generate real lines. Check: stamp labels, `stampAtPhrase`, sheet
tagline / order line, QR URL per locale, CTA, "link in bio" wording, spoken URL.

## Publish

- [ ] Final review approved; run log shows −14 LUFS, true peak ≤ −1 dB.
- [ ] Hook variants and cut-downs (6 s / 15 s) as `extends` specs if wanted:
      `{ "extends": "<locale>.json", "id": "…", "shots": ["id", …] }`.
- [ ] Landing page / coupon for attribution, if the product has one.
- [ ] Post caption, hashtags, pinned comment from the kit copy; **AI label** on every platform.
- [ ] Test the full product flow inside the TikTok / Instagram in-app browsers.
- [ ] Organic first; boost the variant with the best 3-second hold.
- [ ] Promote approved reusable items into `media-kit/`.
