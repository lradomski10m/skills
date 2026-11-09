# Worked example — "photo rules, broken by animals"

An anonymized, finished campaign for a document-photo service: about 33 s, Polish first
and English after. Its storyboard is the engine's test fixture
`engine/test/fixtures/campaigns/animals/storyboard.md`, and its timing is the engine's
golden test. A second, neutral example that uses every pattern (mission card → montage
with a HUD → fail → phone demo → end card) is
`engine/test/fixtures/campaigns/showcase/storyboard.md`.

## Concept (phase 1)

- **Audience**: adults who need an ID or passport photo; everyone has a bad one.
- **Format**: "rules explained by animals". Each official rule is broken by the animal
  famous for breaking it. It is shareable (cute and relatable), cheap (no dialogue) and
  translates easily.
- **Patterns**: hook → 4 × reveal (`action-verdict`) → end card (`end-card-real-sheet`)
  with the four animals as perfect photos.

## Script table (phase 3)

| # | Beat | What we see | What we hear | On-screen text | Pattern |
|---|---|---|---|---|---|
| 1 | neutral expression | quokka, calm → wide grin, holds it → white result photo | "One: neutral expression. No smiling." → "Oh no…" | REJECTED stamp | reveal (action) |
| 2 | head straight | dog, alert → sharp head tilt, holds | "Two: head straight." → "Seriously?" | REJECTED | reveal (action) |
| 3 | eyes visible | highland cow, eyes visible → fringe falls over both eyes | "Three: hair can't cover your eyes." → "Not even a little." | REJECTED | reveal (action) |
| 4 | look at the camera | chameleon, eyes swivel apart, then still | "Four: look straight at the camera." → "Both eyes, same direction…" | REJECTED | reveal (settle) |
| end | the payoff | the four animals as compliant photos on a print sheet | announcer CTA | APPROVED stamp, CTA, QR | end card |

## Storyboard excerpt

````markdown
---
campaign: animals
locales: [pl, en-us]
tempo: snappy
cuts: { sfx: whoosh }
hook: { text: { t: hook }, line: hook, duration: 2 }
brandBug: { from: 0 }
music: { bed: bed }
end: { preset: end-card-real-sheet, line: endcard.announcer, copy: { t: endcard.copy }, minDuration: 3 }
---
## Shot quokka — neutral expression
```yaml
preset: action-verdict
clip: quokka.oneshot
result: quokka.result
line: quokka.line
quip: quokka.quip
```
````

## What happened in production

- **Clips**: one FLUX 3 Max take per animal from a habitat still, with an edited end
  frame. Two of the four needed a second take, one for timing and one for head pose.
- **Cow**: the first clip had the fringe over the eyes from frame 1, so the rule was
  never visible. It was re-prompted with the eyes visible first.
- **Result stills**: Nano Banana edits of each clip's last frame. The chameleon's first
  result had the wrong head angle, so it was redone from the real last frame.
- **Voice**:
  - narrator (warm female) and announcer (male, sped up 1.2×);
  - the hook was regenerated in context to fix an accent;
  - a stretched quip spelling ("nieeee") was replaced.
- **Music**: three ElevenLabs options. The pick (playful pizzicato/marimba, ~118 BPM) is
  levelled and ducked by the engine.
- **Graphics**:
  - the drawn logo pill was rejected for a screenshot of the real site header;
  - the stamp moved low, off the faces;
  - burned-in captions were removed;
  - the end card went from a tilted paper sheet to the brand's real print-sheet look.
- **Kit additions promoted at the end**: voice cast, stamp labels, end-card copy, the
  music bed, the brand chip, and the four perfect photos as mascot references.

## Cost

≈ $5 in total: 4 clips + 2 retakes, ~12 stills and edits, ~14 voice takes, 3 music tracks.
