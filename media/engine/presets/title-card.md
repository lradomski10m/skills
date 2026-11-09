---
name: title-card
summary: A full-screen card — a background (colour, still or clip) with a template on top, for a fixed time or as long as its voice line.
---

Mission cards, chapter titles, statistics, "4 years on your ID" trailer cards. The
template gets `text` plus anything in `params`. With `line`, the card lasts at least
the line + 0.3 s.

```yaml
params:
  template:   { type: text, default: title-card, doc: "SVG template (media-kit/templates or built-in)" }
  text:       { type: text, doc: "main text" }
  subtitle:   { type: text }
  params:     { type: object, default: {}, doc: "extra template params" }
  background: { type: still, doc: "background still (or kit:path)" }
  clip:       { type: clip, doc: "background clip (looped)" }
  color:      { type: text, default: "#0d1117" }
  duration:   { type: number, default: 2 }
  line:       { type: vo, role: narrator }
  sfx:        { type: sfx, doc: "sound on entry (e.g. a sting)" }
  place:      { type: object, default: { area: center } }
  animate:    { type: object, doc: "keyframes, e.g. { opacity: [[0, 0], [0.2, 1]] }" }
plan:
  planner: hold
  args:
    background: "$clip ?? $background"
    color: $color
    duration: "$line != null ? max($duration, $line.durationSec + 0.3) : $duration"
audio:
  - { vo: $line, at: 0.15, when: "$line != null" }
  - { sfx: $sfx, at: 0, when: "$sfx != null" }
overlays:
  - template: $template
    params: { text: $text, subtitle: $subtitle, extra: $params }
    from: 0
    to: end
    place: $place
    animate: $animate
```
