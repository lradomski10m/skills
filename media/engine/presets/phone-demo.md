---
name: phone-demo
summary: A real app recording shown on a phone in the scene — picture-in-picture into the phone screen's quad, with an optional running timer.
---

`phone` is a still (or clip) of someone holding / a stand with a phone whose screen is
a plain green or flat area; `quad` lists the screen's corners in frame pixels (1080×1920,
after the background is cover-scaled): top-left, top-right, bottom-right, bottom-left.
`recording` is the screen recording (kit `footage/` or `3-clips/`).

```yaml
params:
  phone:     { type: still, required: true }
  recording: { type: clip, required: true }
  quad:      { type: list, required: true, doc: "[[x,y] ×4] TL, TR, BR, BL in frame px" }
  in:        { type: number, default: 0 }
  duration:  { type: number, doc: "default = the recording's length" }
  line:      { type: vo, role: narrator }
  timer:     { type: bool, default: false }
  timerTemplate: { type: text, default: timer }
  timerFrom: { type: number, default: 0 }
plan:
  planner: hold
  args:
    background: $phone
    duration: "$duration ?? ($recording.durationSec - $in)"
audio:
  - { vo: $line, at: 0.1, when: "$line != null" }
overlays:
  - { pip: $recording, quad: $quad, in: $in, from: 0, to: end }
  - template: $timerTemplate
    when: $timer
    params: { seconds: $timerFrom }
    from: 0
    to: end
    place: { area: hud-top-right }
    animate: { seconds: [[0, "=$timerFrom"], ["=duration", "=$timerFrom + duration"]] }
```
