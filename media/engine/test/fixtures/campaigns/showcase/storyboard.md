---
campaign: showcase
title: Showcase — every built-in primitive
locales: [en-us]
tempo: snappy
cuts: { sfx: whoosh }
music: { bpm: 120, offset: 0.25 }
brandBug: { from: 0 }
end: { preset: end-card-classic, line: endcard.line, copy: { t: endcard.copy }, cta: { t: endcard.cta }, url: example.com }
captions: false
---

# Showcase

A neutral storyboard that uses every built-in preset, template, effect and transition
(rendered offline in the engine's integration check). Shaped like a game-parody ad:
mission card → montage with a HUD → a fail → a demo on a phone → end card.

## Text

| key | en-us |
|---|---|
| mission | Mission: get the thing |
| mission.sub | Chapter one |
| objective | Get to the shop |
| fail | Game over |
| fail.reason | Reason: the shop was closed |
| endcard.line | Get it at home, in a minute. Go to example dot com. |
| endcard.copy | Get it at home, in a minute. |
| endcard.cta | Go to example.com |
| demo.line | One minute, at home. |
| labels.reject | REJECTED |
| labels.approve | APPROVED |

## Shot mission — mission card
```yaml
preset: title-card
text: { t: mission }
subtitle: { t: mission.sub }
duration: 1.6
sfx: ding
animate: { opacity: [[0, 0], [0.25, 1]], scale: [[0, 1.15], [0.3, 1]], ease: out }
```

## Shot grind — montage with a HUD
```yaml
preset: montage
clips: [street, bus, rain, queue]
every: 2
hits: zoom-punch
transition: { name: whip, durSec: 0.2 }
overlays:
  - { template: objective, params: { text: { t: objective }, label: "Objective:" }, from: 0, to: end }
  - { template: stars, params: { value: 0 }, from: 0, to: end, animate: { value: [[0, 0], ["=end", 5]] } }
  - { template: route-map, params: { progress: 0, label: 4.2 km }, from: 0, to: end, animate: { progress: [[0, 0], ["=end", 1]] } }
  - { template: counter, params: { value: 0, prefix: "-$" }, from: 0, to: end, place: { area: hud-top-left }, animate: { value: [[0, 0], ["=end", 18]] } }
effects:
  - { name: grade, from: 0, to: end, params: { saturation: 1.3, contrast: 1.08 } }
```

## Shot fail — the attempt fails
```yaml
preset: game-fail
clip: booth
out: 3
banner: { t: fail }
reason: { t: fail.reason }
transition: { name: flash-cut }
```

## Shot cctv — found footage look
```yaml
preset: clip
clip: corridor
out: 2
transition: { name: dip, durSec: 0.4 }
effects:
  - { name: cctv, from: 0, to: end }
  - { name: shake, from: 0.5, to: 1.2 }
```

## Shot demo — the app on a phone
```yaml
preset: phone-demo
phone: phone
recording: recording
quad: [[330, 560], [750, 540], [770, 1360], [320, 1380]]
duration: 2.5
line: demo.line
timer: true
effects:
  - { name: vhs, from: 0, to: 0.6 }
```
