---
campaign: animals
title: "Example — photo rules, broken by animals"
locales: [pl, en-us]
tempo: snappy
cuts: { sfx: whoosh }
hook: { text: { t: hook }, line: hook, duration: 2 }
brandBug: { from: 0 }
music: { bed: bed }
end: { preset: end-card-real-sheet, line: endcard.announcer, copy: { t: endcard.copy }, stampAtPhrase: { t: endcard.stampAtPhrase }, minDuration: 3 }
captions: false
---

# Example — photo rules, broken by animals

Anonymized worked example: each official photo rule is broken by the animal famous for
breaking it. Timing matches the 0.1.x render (golden test).

## Text

| key | pl | en-us |
|---|---|---|
| hook | Wymagania zdjęcia do dowodu | Passport photo requirements |
| quokka.caption | Zachowaj neutralny wyraz twarzy. Nie uśmiechaj się. | Neutral expression. No smiling. |
| quokka.line | Po pierwsze: neutralny wyraz twarzy. Bez uśmiechu. | One: neutral expression. No smiling. |
| quokka.quip | No nie… | Oh no… |
| dog.caption | Głowa prosto. Nie przechylaj jej na boki. | Keep your head straight. No tilting. |
| dog.line | Po drugie: głowa prosto. Nie przechylamy. | Two: head straight. No tilting. |
| dog.quip | Serio? | Seriously? |
| cow.caption | Włosy nie mogą zasłaniać oczu ani twarzy. | Hair must not cover your eyes or face. |
| cow.line | Po trzecie: włosy nie mogą zasłaniać oczu ani twarzy. | Three: hair can't cover your eyes or face. |
| cow.quip | Ani trochę. | Not even a little. |
| chameleon.caption | Patrz prosto w obiektyw. | Look straight at the camera. |
| chameleon.line | Po czwarte: patrzymy prosto w obiektyw. | Four: look straight at the camera. |
| chameleon.quip | Każde oko w tą samą stronę… | Both eyes, same direction… |
| endcard.announcer | Zdjęcie do dowodu w minutę, w domu. Poprawki gratis. Wejdź na example.com. | Your passport photo in a minute, at home. Free retakes. Go to example.com. |
| endcard.copy | Zdjęcie do dowodu w minutę, w domu. Poprawki gratis. | Your passport photo in a minute, at home. Free retakes. |
| endcard.stampAtPhrase | Poprawki gratis. | Free retakes. |

## Shot quokka — Zachowaj neutralny wyraz twarzy. Nie uśmiechaj się.

Subject: quokka with its natural wide smile.

Clip prompt: Static locked-off camera. A single bright white camera flash fires. The quokka tries to hold a serious face: it presses its lips together for a moment, its cheeks twitch, then it breaks into an even wider, delighted smile and looks pleased with itself. Soft even light, plain grey wall, subtle natural movement, no camera movement, no text.

```yaml
preset: action-verdict
clip: quokka.oneshot
result: quokka.result
beat: action
line: quokka.line
quip: quokka.quip
caption: { t: quokka.caption }
```

## Shot dog — Głowa prosto. Nie przechylaj jej na boki.

Subject: scruffy brown mixed-breed dog with soft ears, alert and curious.

Clip prompt: Static locked-off camera. A single bright white camera flash fires. The dog perks up its ears and tilts its head sharply to one side, holds it, then tilts it to the other side, deeply curious. Soft even light, plain grey wall, no camera movement, no text.

```yaml
preset: action-verdict
clip: dog
result: dog.result
beat: action
line: dog.line
quip: dog.quip
caption: { t: dog.caption }
```

## Shot cow — Włosy nie mogą zasłaniać oczu ani twarzy.

Subject: highland cow calf with a long ginger fringe completely covering both eyes.

Clip prompt: Static locked-off camera. A single bright white camera flash fires. The highland cow calf shakes its head, the long ginger fringe swings aside for a split second revealing one eye, then falls straight back over both eyes. The calf stands still, unbothered. Soft even light, plain grey wall, no camera movement, no text.

```yaml
preset: action-verdict
clip: cow
result: cow.result
beat: action
line: cow.line
quip: cow.quip
caption: { t: cow.caption }
```

## Shot chameleon — Patrz prosto w obiektyw.

Subject: green chameleon perched on a thin branch, body facing the camera.

Clip prompt: Static locked-off macro camera. A single bright white camera flash fires. The chameleon's two eyes swivel independently: one looks straight into the camera while the other rolls up and away, then they swap directions. The body stays perfectly still on the branch. Soft even light, plain grey wall, no camera movement, no text.

```yaml
preset: action-verdict
clip: chameleon
result: chameleon.result
beat: settle
line: chameleon.line
quip: chameleon.quip
caption: { t: chameleon.caption }
```
