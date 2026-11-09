# Phase 2 — The media kit

The project's permanent, reusable media library is `media-kit/` at the repo root
(committed). Scratch work lives in `media-work/` (gitignored). Start a new kit from
`templates/media-kit/`. Every file a person edits is YAML or Markdown.

## What the engine reads

| Path | Contents |
|---|---|
| `brand.yaml` | `name`, `stampMark`, `url`, `icon` (path), `chip { file, iconBox? }`, `font { family, files[] }`, `endCard { style }`, `colours { … }`, `providers { … }` (skill only) |
| `voices.yaml` | voice roles per locale, with `"*"` for every locale: `narrator`, `announcer`, `clerk`, characters… → `{ voiceId, voiceName, modelId, postSpeed, ifMissing: skip, offlineVoice }` |
| `copy/<locale>.yaml` | `labels { reject, approve }`, `clerk { reject, approve }`, `endCard { cta, ctaHint, copy, sheet { tagline[], order, qrUrl, url? }, stampAtPhrase }`, `text { key: value }`; plus free-form keys for the skill (slogans, claims, hashtags…) |
| `presets/*.md` | project presets (`storyboard.md` §Presets) |
| `templates/*.svg` | project templates (`storyboard.md` §Templates) |
| `campaigns/<id>/` | `storyboard.md` (+ `storyboard.<locale>.md`, `hooks.mjs`), `concept.md`, `script-table.md` |

`colours` keys: `accent`, `background`, `text`, `muted`, `rejected`, `approved`,
`stampPaper`, `panelFrom`, `panelTo`, `panelMuted`, `sheet`, `cropMark`, `qrFinder`,
`chipBg`. Missing keys fall back to neutral defaults. Templates read the same keys as
`{{colour.<name>}}`.

Fonts: templates load fonts **from files only**: the bundled Inter plus `font.files`.
Ship the brand font's files in the kit (licence permitting) and set `font.family`.

## Categories (open set — extend freely)

- **Visual identity**: logo variants (icon, wordmark, chip, light/dark), palettes,
  fonts, watermark and bug positions.
- **Templates and overlays**: stamps and badges (labels per locale), lower thirds,
  caption styles, title cards, banners, HUD elements (counters, meters, timers, maps),
  stingers, end-card styles, QR targets.
- **Presets**: the ad patterns this brand repeats, such as a "fail" beat in house style,
  a branded demo, or a signature transition.
- **Voice**: a cast of voices with roles and per-locale settings, plus **pre-recorded
  reusable lines** in `voices/lines/<locale>/` (CTA, slogan, sign-off, "link in bio").
- **Audio**: sound logo or jingle, SFX in `audio/sfx/<name>.wav|mp3` (usable as
  `sfx: <name>`), and approved music beds in `audio/music/<mood>/`.
- **Copy** (`copy/<locale>.yaml`): slogans, taglines, CTAs, **allowed and banned
  claims**, disclaimers, hashtags, post captions, pinned comments.
- **Footage**: screenshots, app demo screen recordings, product shots (`kit:footage/…`).
- **Characters and mascots**: reference stills (front, 3/4, full body) for recurring faces.
- **Grades**: `.cube` LUTs for `grade` effects.

The engine reads only the table above; the skill reads everything.

## Working the kit (every campaign)

1. **Inventory**: list what the concept needs and mark each item *exists*, *adapt* or
   *create*.
2. **Reuse** first. To **adapt**, copy into a new variant; never overwrite an approved
   item without asking. **Create** only what's missing.
3. **Brand assets come from the source.** Take logos, colours and fonts from the product's
   real site or design files: screenshot the header for a chip, read the CSS tokens for
   colours. Never let a model draw a logo.
4. **Voices**: pick from the ElevenLabs library (`creative_list_voices`) or design one.
   Propose 2–3 per role per locale with a sample line, then save the pick to
   `voices.yaml`.
5. **Templates**: start from an engine example (`title-card`, `banner`, `lower-third`,
   `objective`, `counter`, `timer`, `stars`, `route-map`). Restyle it with kit colours
   and fonts, render it once (`plan` + `run --offline`), and show the user.

## Promotion rule (media-work → media-kit)

An item moves into the kit only when it is **approved and reusable**: a picked CTA
recording, a chosen music bed, a voice cast entry, stamp labels, end-card copy, a mascot
reference still, a template or a preset. Campaign-specific takes (a shot's clip, its
result still) stay in `media-work/`. Large binaries (music, clips) may warrant Git LFS
once the kit grows; logos, short MP3 lines, SVG and YAML are fine in plain git.

## Upgrading a 0.1.x kit

The JSON kit (`brand/brand.json`, `voices/cast.json`, `copy/*.json`, campaign
`base.json` + `<locale>.json`) converts with `node "$E" migrate-kit`. The old files move
to `_alt/0.1.x/`.
