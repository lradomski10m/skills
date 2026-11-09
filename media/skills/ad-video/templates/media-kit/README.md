# Media kit

Permanent, approved, reusable media for this project's videos (committed). Scratch work
lives in `media-work/` (gitignored). Used by the `ad-video` skill and its engine. Every
file a person edits is YAML or Markdown.

| Path | What | Engine reads it |
|---|---|---|
| `brand.yaml` | name, stamp mark, URL, icon, chip, font, end-card style, colours, providers | yes |
| `brand/` | `icon.png`, optional `chip.png`, `fonts/` | via `brand.yaml` |
| `voices.yaml` | voice roles per locale (`"*"` = every locale) | yes |
| `voices/lines/<locale>/` | approved reusable recordings: CTA, slogan, sign-off | — |
| `copy/<locale>.yaml` | stamp labels, end-card copy, shared text (engine) + slogans, claims, hashtags (skill) | partly |
| `presets/*.md` | this brand's own ad patterns (a Markdown doc + one yaml block) | yes |
| `templates/*.svg` | this brand's overlays and cards (`{{placeholders}}`) | yes |
| `audio/` | sound logo, `sfx/<name>.wav`, `music/<mood>/` approved beds | sfx yes |
| `footage/` | screenshots, app demo recordings, product shots (`kit:footage/…`) | when referenced |
| `characters/` | reference stills for recurring mascots | — |
| `campaigns/<id>/` | `storyboard.md` (+ `storyboard.<locale>.md`, `hooks.mjs`), `concept.md`, `script-table.md` | yes |

Start a campaign by copying `campaigns/_template/` to `campaigns/<id>/` and setting
`campaign: <id>` in its storyboard.

Promotion rule: an item moves here from `media-work/` only once approved and reusable.
