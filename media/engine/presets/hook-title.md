---
name: hook-title
summary: Opening title over the first shot(s), with an optional spoken hook; delays the first shot's line until the hook is spoken.
---

Used from the storyboard front matter (`hook:`), not as a shot. The title stays up at
least `duration` seconds and until the spoken hook (+ a short tail) ends.

```yaml
params:
  text:     { type: text, required: true }
  line:     { type: vo, role: narrator, doc: spoken hook }
  duration: { type: number, default: 2 }
plan:
  planner: hook
  args: { line: $line, titleSec: $duration }
audio:
  - { vo: $line, at: plan.voStart, when: "$line != null && global.shots.count > 0" }
overlays:
  - { template: "builtin:hook", params: { text: $text }, from: 0, to: "min(plan.titleUntil, global.total)", when: "global.shots.count > 0" }
exports:
  minFirstVoStart: plan.minFirstVoStart
  titleSec: $duration
  titleUntil: plan.titleUntil
```
