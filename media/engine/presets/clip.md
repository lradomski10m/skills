---
name: clip
summary: One clip, in/out, at a speed (or reversed), with optional held first/last frames and a voice line.
---

```yaml
params:
  clip:       { type: clip, required: true }
  in:         { type: number, default: 0 }
  out:        { type: number }
  speed:      { type: number, default: 1 }
  reverse:    { type: bool, default: false }
  freezeHead: { type: number, default: 0 }
  freezeTail: { type: number, default: 0 }
  line:       { type: vo, role: narrator }
  lineAt:     { type: time, default: 0.1 }
plan:
  planner: clip
  args: { clip: $clip, in: $in, out: $out, speed: $speed, reverse: $reverse, freezeHead: $freezeHead, freezeTail: $freezeTail }
audio:
  - { vo: $line, at: $lineAt, when: "$line != null" }
```
