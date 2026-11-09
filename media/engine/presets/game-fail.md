---
name: game-fail
summary: Video-game "fail" beat — a clip slows down, freezes on its last frame, the picture washes to grey and a big banner lands with a reason line.
---

The parody "WASTED" moment, written generically: the banner text, reason, colours and
font come from your template and copy (`media-kit/templates/<name>.svg`). Never copy a
real game's font, logo or sound.

```yaml
params:
  clip:     { type: clip, required: true }
  in:       { type: number, default: 0 }
  out:      { type: number }
  slow:     { type: number, default: 0.5, doc: "playback speed before the freeze" }
  hold:     { type: number, default: 2, doc: "seconds frozen at the end" }
  banner:   { type: text, required: true }
  reason:   { type: text }
  template: { type: text, default: banner }
  sfx:      { type: sfx, default: thud }
  wash:     { type: bool, default: true }
plan:
  planner: clip
  args: { clip: $clip, in: $in, out: $out, speed: $slow, freezeTail: $hold }
audio:
  - { sfx: $sfx, at: plan.freezeAt }
effects:
  - { name: grey-wash, from: "max(0, plan.freezeAt - 0.4)", to: end, when: $wash }
overlays:
  - template: $template
    params: { text: $banner, subtitle: $reason }
    from: plan.freezeAt
    to: end
    place: { area: center }
    animate: { opacity: [[0, 0], [0.12, 1]], scale: [[0, 1.35], [0.2, 1]], ease: out }
```
