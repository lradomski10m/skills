# Phase 2 — The media kit

The project's permanent, reusable media library: `media-kit/` at the repo root
(committed). Scratch work lives in `media-work/` (not committed). Start a new kit from
`templates/media-kit/`.

## What the engine reads

| Path | Format | Used for |
|---|---|---|
| `brand/brand.json` | `{ name, stampMark, url, icon, chip?: { file, iconBox? }, font?: { family }, endCard?: { style } }` | Wordmark, stamp sub-label, CTA URL, brand bug, end-card style |
| `brand/icon.png` | square raster ≥ 512 px | Brand bug, end card, QR centre |
| `brand/chip.png` | optional: e.g. a 4× screenshot of the website header logo | Brand bug (top-left) instead of the drawn pill |
| `brand/colours.json` | `accent, background, text, muted, rejected, approved, stampPaper, panelFrom, panelTo, panelMuted, sheet, cropMark, qrFinder, chipBg` | Every branded colour (missing keys fall back to neutral defaults) |
| `brand/fonts/` | `.ttf`/`.otf` matching `brand.json` `font.family` (licence permitting) | Overlay text; default is the bundled Inter |
| `voices/cast.json` | `{ "*": { role: voice }, "<locale>": { role: voice } }` | Voice roles per locale (narrator, announcer, clerk, characters…) |
| `copy/<locale>.json` | `labels`, `clerkLines`, `endCard { cta, ctaHint, copy, sheet, stampAtPhrase }` + free-form keys | Locale defaults a campaign inherits |
| `campaigns/<id>/` | `base.json`, `<locale>.json`, `concept.md`, `script-table.md`, prompts used | One campaign per folder |

Precedence: kit defaults < campaign `base.json` < campaign `<locale>.json`.

A voice entry: `{ voiceId, voiceName, modelId, settings?, postSpeed?, ifMissing?: "skip", offlineVoice? }`.

## Categories (open set — extend freely)

- **Visual identity**: logo variants (icon, wordmark, chip, light/dark), palettes,
  fonts, watermark/bug positions.
- **Overlays & graphics**: stamps/badges (labels per locale), lower thirds, caption
  styles, title cards, transitions, stingers, end-card styles, QR targets.
- **Voice**: cast of voices with roles and per-locale settings; **pre-recorded reusable
  lines** in `voices/lines/<locale>/` (CTA, slogan, sign-off, "link in bio").
- **Audio**: sound logo / jingle, SFX set, approved music beds in `audio/music/<mood>/`.
- **Copy** (`copy/<locale>.json`, free-form keys are fine): slogans, taglines, CTAs,
  **allowed and banned claims**, disclaimers, hashtags, post captions, pinned comments.
- **Product footage**: screenshots, app demo screen recordings, product shots.
- **Characters / mascots**: reference stills (front, 3/4, full body) for recurring faces.
- **Providers**: which image/video/voice provider this project uses (`providers.md`).

The engine reads only the table above; the skill reads everything.

## Working the kit (every campaign)

1. **Inventory**: list what the concept needs, mark each *exists / adapt / create*.
2. **Reuse** first; **adapt** by copying into a new variant (never overwrite an approved item
   in place without asking); **create** only what's missing.
3. **Brand assets from the source**: take logos/colours/fonts from the product's real site
   or design files (screenshot the header for a chip, read CSS tokens for colours). Never
   let a model draw a logo.
4. **Voices**: pick from the ElevenLabs library (`creative_list_voices`) or design one;
   propose 2–3 per role per locale with a sample line; save the pick to `cast.json`.

## Promotion rule (media-work → media-kit)

An item moves into the kit only when it is **approved and reusable**: a picked CTA
recording, a chosen music bed, a voice cast entry, stamp labels, end-card copy, a mascot
reference still. Campaign-specific takes (a shot's clip, its result still) stay in
`media-work/`. Large binaries (music, clips) may warrant Git LFS once the kit grows;
logos, short MP3 lines and JSON are fine in plain git.
