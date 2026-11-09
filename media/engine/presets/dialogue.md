---
name: dialogue
summary: A character speaks on camera — a lip-synced clip played with its own audio (made elsewhere, e.g. a lip-sync model fed an ElevenLabs line).
---

The engine doesn't lip-sync; it plays the clip and its sound in time, ducks the music
under it and can add a lower third. Make the clip with a lip-sync model from a voice line.

```yaml
params:
  clip:       { type: clip, required: true }
  in:         { type: number, default: 0 }
  out:        { type: number }
  lowerThird: { type: text, doc: "name / caption in a lower third" }
  template:   { type: text, default: lower-third }
plan:
  planner: clip
  args: { clip: $clip, in: $in, out: $out }
audio:
  - { dialogue: $clip, at: 0, in: $in, dur: plan.playSec }
overlays:
  - { template: $template, params: { text: $lowerThird }, from: 0.2, to: end, place: { area: bottom-band }, when: "$lowerThird != null" }
```
