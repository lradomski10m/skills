# Worked example — "photo rules, broken by animals"

An anonymized walk-through of a finished campaign: a document-photo service, ~33 s, Polish
first, English overlay later. The spec is in the engine's test fixtures
(`engine/test/fixtures/campaigns/animals/`).

## Concept (phase 1)

- Audience: adults who need an ID/passport photo; everyone has a bad one.
- Format: "rules explained by animals" — each official photo rule broken by the animal
  famous for breaking it. Shareable (cute + relatable), cheap (no dialogue), translatable.
- Scored highest on shareability and cost; risk low (no people, no real documents).

## Script table (phase 3)

| # | Shot | Rule | Action | Line | Reaction | Beat |
|---|---|---|---|---|---|---|
| 1 | quokka | Neutral expression | calm → wide grin, holds it | "Rule one: neutral expression. No smiling." | REJECTED + "Oh no…" | action |
| 2 | dog | Head straight | alert → sharp head tilt, holds | "Rule two: head straight. No tilting." | REJECTED + "Seriously?" | action |
| 3 | cow | Hair off the eyes | eyes visible → fringe falls over both eyes | "Rule three: hair can't cover your eyes." | REJECTED + "Not even a little." | action |
| 4 | chameleon | Look at the camera | eyes swivel apart, then still | "Rule four: look straight at the camera." | REJECTED + "Both eyes, same direction…" | settle |

Hook: "Passport photo requirements" (on screen + spoken). End card: `real-sheet` with
the four perfect photos, APPROVED stamp, announcer CTA, QR to the localized landing page.

## Production notes

- Each clip: one FLUX 3 Max take from a habitat still, with an edited end frame; two of
  four needed a second take (timing and head pose).
- Result stills: Nano Banana edit of each clip's last frame; the chameleon's first
  result had the wrong head angle — redone from the actual last frame.
- Voice: narrator (warm female), announcer (male, sped 1.2×); the hook was regenerated in
  context to fix an accent; a stretched quip spelling was replaced.
- Music: three ElevenLabs options; the pick (playful pizzicato/marimba) is levelled and
  ducked by the engine.
- Kit additions promoted at the end: voice cast, stamp labels, end-card copy, the music
  bed, the brand chip.

## Cost

≈ $5 in total: 4 clips + 2 retakes, ~12 stills/edits, ~14 voice takes, 3 music tracks.
