---
name: action-verdict
summary: Reveal with a judgement — a subject does something on camera (the beat), a flash marks it, optional hard cut to a "result" still, then a judgement stamp and a short spoken reaction.
---

The *reveal* pattern used for "rules broken by …" videos. The beat is found by
analysing the clip: `action` = a burst of motion (grin, head tilt, hair falling),
`settle` = the subject ends still (a pose, eyes stopping). The line ends before the
action; the flash fires when it completes; with `result` the video cuts to that still
(make it from the clip's real last frame), the stamp lands and the quip plays.

| Param | Use |
|---|---|
| `clip` | one continuous clip (or `[{file, in, out}, …]` parts joined frame-accurately) |
| `result` | still shown after the cut (same pose, plain background) |
| `intro` / `introClip` | optional context shot before the clip (still with push-in, or a clip's tail) |
| `line`, `quip` | voice lines (narrator) |
| `verdict` | `reject` (stamp + thud), `approve` (ding), `none` |

```yaml
params:
  clip:      { type: clip, required: true, doc: "continuous action clip" }
  result:    { type: still, doc: "result still shown after the cut" }
  intro:     { type: still, doc: "context still before the clip" }
  introClip: { type: clip, doc: "context clip before the clip (its tail is used)" }
  beat:      { type: enum, values: [action, settle], default: action }
  flash:     { type: enum, values: [auto, synthetic], default: auto }
  verdict:   { type: enum, values: [reject, approve, none], default: reject }
  line:      { type: vo, role: narrator, required: true, doc: "the rule / setup line" }
  quip:      { type: vo, role: narrator, doc: "reaction after the stamp" }
  clerk:     { type: vo, role: clerk, doc: "optional one-word judgement voice" }
  caption:   { type: text, doc: "rule label (shown only with rulePill)" }
  rulePill:  { type: bool, default: false }
  mark:      { type: bool, default: false, doc: "small ✗/✓ mark on the stamp" }
  stamp:     { type: bool, default: true }
plan:
  planner: reveal
  args:
    clip: $clip
    result: $result
    intro: "$intro ?? $introClip"
    beat: $beat
    flash: $flash
    verdict: $verdict
    line: $line
    quip: $quip
    clerk: $clerk
    minVoStart: "first ? (global.hook.minFirstVoStart ?? 0) : 0"
audio:
  - { sfx: shutter, at: plan.shutterAt, when: "plan.shutterAt != null" }
  - { sfx: shutter, at: plan.cutAt, when: "($intro != null || $introClip != null) && plan.cutAt != null" }
  - { vo: $line, at: plan.voStart }
  - { vo: $quip, at: plan.quipStart, when: "$quip != null && plan.quipStart != null" }
  - { sfx: thud, at: plan.stampAt, when: "$verdict == 'reject'" }
  - { vo: $clerk, at: plan.clerkStart, when: "$verdict == 'reject' && $clerk != null && plan.clerkStart != null" }
  - { sfx: ding, at: plan.markAt, when: "$verdict != 'reject'" }
overlays:
  - { template: "builtin:rule", params: { text: $caption }, from: "max(0, (global.hook.titleSec ?? 0) - shotStart)", to: end, when: "$rulePill" }
  - { template: "builtin:stamp", params: { verdict: reject }, from: plan.stampAt, to: end, when: "$verdict == 'reject' && $stamp" }
  - { template: "builtin:mark", params: { verdict: $verdict }, from: plan.markAt, to: end, when: "$mark" }
exports:
  flash: plan.flashAt
```
