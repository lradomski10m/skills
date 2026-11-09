---
name: end-card
summary: Closing card — announcer line, approve stamp, CTA; with a grid style and one perfect photo per shot (4 shots) the photos build a print sheet first.
---

Styles: `real-sheet` (sheet + brand panel with QR, "before" thumbnail, URL, order line,
tagline), `grid` (photos + crop marks), `grid-strip` (+ slim brand strip), `tilted`
(white sheet, slight rotation), `classic` (logo, copy, CTA, stamp). A grid style without
the 4 perfect photos (`2-stills/perfect/<shot>.png`) falls back to `classic`.
The stamp lands right after the sheet settles; the line plays over the complete frame.
Copy defaults come from the kit (`copy/<locale>.yaml` → `endCard`).

```yaml
params:
  style:         { type: enum, values: [kit, real-sheet, grid, grid-strip, tilted, classic], default: kit }
  line:          { type: vo, role: announcer, doc: announcer line (CTA, spoken URL) }
  clerk:         { type: vo, role: clerk }
  stampAtPhrase: { type: text, default: "=copy.endCard.stampAtPhrase", doc: "classic style: the stamp lands at the end of this phrase" }
  copy:          { type: text, default: "=copy.endCard.copy" }
  cta:           { type: text, default: "=copy.endCard.cta", doc: "button text; must contain the URL" }
  ctaHint:       { type: text, default: "=copy.endCard.ctaHint" }
  url:           { type: text, default: "=kit.url" }
  wordmark:      { type: text, default: "=kit.name" }
  sheet:         { type: object, default: "=copy.endCard.sheet", doc: "real-sheet panel: { tagline: [l1, l2], order, qrUrl, url? }" }
  minDuration:   { type: number, default: 3 }
  backgroundClip: { type: clip, doc: "classic style: clip played (dimmed) under the card" }
plan:
  planner: endcard
  args:
    style: "$style == 'kit' ? (kit.endCardStyle ?? config.endCardStyle) : $style"
    line: $line
    clerk: $clerk
    minDuration: $minDuration
    stampAtPhrase: $stampAtPhrase
    backgroundClip: $backgroundClip
    card: { copy: $copy, cta: $cta, ctaHint: $ctaHint, url: $url, wordmark: $wordmark }
audio:
  - { vo: $line, at: plan.voStart, when: "$line != null" }
  - { sfx: thud, at: plan.stampAt }
  - { vo: $clerk, at: plan.clerkStart, when: "$clerk != null && plan.clerkStart != null" }
  - { sfx: ding, at: plan.dingAt }
overlays:
  - template: "builtin:photo-sheet"
    params: { style: "=plan.style", photos: "=plan.photos", before: "=plan.before", sheet: $sheet, url: $url, wordmark: $wordmark }
    from: 0
    to: end
    fadeIn: { dur: config.photoSheet.inSec }
    slide: { dur: config.photoSheet.inSec, dy: config.photoSheet.slideDyPx }
    when: plan.grid
  - { template: "builtin:stamp", params: { verdict: approve, on: sheet, style: "=plan.style" }, from: plan.stampAt, to: end, when: plan.grid }
  - { template: "builtin:endcard-base", params: { copy: $copy, cta: $cta, ctaHint: $ctaHint, url: $url, wordmark: $wordmark, overVideo: true }, from: 0, to: plan.stampAt, when: "!plan.grid && $backgroundClip != null" }
  - { template: "builtin:endcard-full", params: { copy: $copy, cta: $cta, ctaHint: $ctaHint, url: $url, wordmark: $wordmark, overVideo: "=$backgroundClip != null" }, from: plan.stampAt, to: end, when: "!plan.grid" }
```
