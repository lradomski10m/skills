---
name: montage
summary: Fast cuts through several clips, each slice ending on the music beat (every N beats), or fixed-length slices without beats.
---

Open-world "grind", trailer montages, phonk edits. Add HUD overlays on the shot with
`overlays:` (they span the whole montage) and hits with `effects:`.
`clips` items are clip keys or `{ clip, in, speed }`.

```yaml
params:
  clips:    { type: list, items: clip, required: true }
  every:    { type: number, default: 1, doc: "beats per slice" }
  sliceSec: { type: number, default: 0.8, doc: "slice length when there are no beats" }
  maxSec:   { type: number, doc: "stop adding slices after this long" }
  line:     { type: vo, role: narrator }
  hits:     { type: enum, values: [none, zoom-punch, shake, flash-cut], default: none, doc: "an accent on every cut" }
plan:
  planner: montage
  args: { clips: $clips, every: $every, sliceSec: $sliceSec, maxSec: $maxSec }
audio:
  - { vo: $line, at: 0.1, when: "$line != null" }
effects:
  - { name: zoom-punch, each: plan.starts, from: each, to: "each + 0.36", when: "$hits == 'zoom-punch'" }
  - { name: shake, each: plan.starts, from: each, to: "each + 0.25", when: "$hits == 'shake'" }
  - { name: flash, each: plan.starts, from: each, to: "each + 0.1", when: "$hits == 'flash-cut'" }
```
