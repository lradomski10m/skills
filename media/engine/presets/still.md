---
name: still
summary: A still image held for a time, with an optional Ken Burns move and a voice line (the shot lasts at least the line).
---

```yaml
params:
  still:    { type: still, required: true }
  duration: { type: number, default: 2 }
  kenBurns: { type: object, doc: "{ from: { scale, x, y }, to: { scale, x, y } } (x/y 0..1 focus)" }
  line:     { type: vo, role: narrator }
plan:
  planner: hold
  args:
    background: $still
    duration: "$line != null ? max($duration, $line.durationSec + 0.4) : $duration"
    kenBurns: $kenBurns
audio:
  - { vo: $line, at: 0.15, when: "$line != null" }
```
