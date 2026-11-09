# Media kit

Permanent, approved, reusable media for this project's videos (committed). Scratch work
lives in `media-work/` (gitignored). Used by the `ad-video` skill and its engine.

| Folder | What | Engine reads it |
|---|---|---|
| `brand/` | `brand.json` (name, stamp mark, URL, icon, chip, font, end-card style), `colours.json`, `icon.png`, optional `chip.png`, `fonts/` | yes |
| `voices/cast.json` | voice roles per locale (`"*"` = every locale) | yes |
| `voices/lines/<locale>/` | approved reusable recordings: CTA, slogan, sign-off, "link in bio" | — |
| `copy/<locale>.json` | stamp labels, end-card copy (engine) + slogans, claims, hashtags, captions (skill) | partly |
| `audio/` | sound logo, SFX, `music/<mood>/` approved beds | — |
| `overlays/` | stamps, badges, lower thirds, title cards, stingers | — |
| `footage/` | screenshots, app demo recordings, product shots | — |
| `characters/` | reference stills for recurring mascots | — |
| `campaigns/<id>/` | `concept.md`, `script-table.md`, `base.json`, `<locale>.json`, prompts used | yes (specs) |

Providers used by this project: images = fal Nano Banana · video = fal FLUX 3 Max ·
voice + music = ElevenLabs. (Edit if different.)

Promotion rule: an item moves here from `media-work/` only once approved and reusable.
