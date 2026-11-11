---
name: phone-demo
summary: A real app recording shown on a phone in the scene — picture-in-picture into the phone screen's quad, with an optional running timer, an optional hold on the last frame and an optional verdict stamp.
---

`phone` is a still (or clip) of someone holding / a stand with a phone whose screen is
a plain green or flat area; `quad` lists the screen's corners in frame pixels (1080×1920,
after the background is cover-scaled): top-left, top-right, bottom-right, bottom-left.
`recording` is the screen recording (kit `footage/` or `3-clips/`).

Timing:

- `duration` is how much of the recording plays (default: all of it from `in`). Without
  `hold` the recording loops if `duration` is longer than it.
- `hold` (s) freezes the recording's last played frame for that long: a pause on the
  result while voice and music carry on. The shot is `duration + hold` long. Exported
  as `global.<shot>.holdAt` (shot-local time of the first frozen frame).
- `stampAt` is measured **back from the end of the shot**: the stamp lands `stampAt`
  seconds before the end. Default: `hold`, so the stamp lands on the first frozen
  frame (1 s before the end without a hold). `verdict` shows the stamp (`none`: no
  stamp, the 0.2.x behaviour).
- The timer runs while the recording plays and stops with it. `timerTo` is the value it
  reaches when the recording stops (a minute of real use can read "1:00" in 3 s);
  default: real time from `timerFrom`.

```yaml
params:
  phone:     { type: still, required: true }
  recording: { type: clip, required: true }
  quad:      { type: list, required: true, doc: "[[x,y] ×4] TL, TR, BR, BL in frame px" }
  in:        { type: number, default: 0 }
  duration:  { type: number, doc: "recording seconds played; default = the recording's length from in" }
  hold:      { type: number, default: 0, doc: "freeze the last played frame this long (s); adds to the shot" }
  line:      { type: vo, role: narrator }
  timer:     { type: bool, default: false }
  timerTemplate: { type: text, default: timer }
  timerFrom: { type: number, default: 0 }
  timerTo:   { type: number, doc: "timer value when the recording stops; default timerFrom + seconds played" }
  verdict:   { type: enum, values: [reject, approve, none], default: none }
  stampAt:   { type: number, doc: "stamp lands this many seconds before the end; default = hold (1 without a hold)" }
  clerk:     { type: vo, role: clerk, doc: "optional one-word judgement voice at the stamp" }
  quip:      { type: vo, role: narrator, doc: "optional reaction after the stamp" }
plan:
  planner: hold
  args:
    background: $phone
    duration: "($duration ?? ($recording.durationSec - $in)) + $hold"
exports:
  holdAt: "end - $hold"
audio:
  - { vo: $line, at: 0.1, when: "$line != null" }
  - { sfx: thud, at: "end - ($stampAt ?? ($hold > 0 ? $hold : 1))", when: "$verdict != 'none'" }
  - { sfx: ding, at: "end - ($stampAt ?? ($hold > 0 ? $hold : 1)) + 0.35", when: "$verdict == 'approve'" }
  - { vo: $clerk, at: "end - ($stampAt ?? ($hold > 0 ? $hold : 1)) + 0.3", when: "$verdict != 'none' && $clerk != null" }
  - { vo: $quip, at: "end - ($stampAt ?? ($hold > 0 ? $hold : 1)) + 0.5", when: "$quip != null" }
overlays:
  - { pip: $recording, quad: $quad, in: $in, out: "$in + end - $hold", hold: $hold, from: 0, to: end }
  - template: $timerTemplate
    when: $timer
    params: { seconds: $timerFrom }
    from: 0
    to: end
    place: { area: hud-top-right }
    animate: { seconds: [[0, "=$timerFrom"], ["=end - $hold", "=$timerTo ?? ($timerFrom + end - $hold)"]] }
  - template: "builtin:stamp"
    params: { verdict: $verdict }
    from: "end - ($stampAt ?? ($hold > 0 ? $hold : 1))"
    to: end
    when: "$verdict != 'none'"
```
