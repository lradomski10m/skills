---
campaign: my-campaign            # = folder name; lowercase-hyphen
title: "<Campaign title>"
locales: [en-us]
tempo: snappy                    # snappy | relaxed
cuts: { sfx: whoosh }            # a whoosh into every cut
hook: { text: { t: hook }, line: hook, duration: 2 }
brandBug: { from: 0 }
music: { bed: bed }              # media-work/<campaign>/4-music/bed.mp3; or { bpm, offset } to set beats by hand
end: { preset: end-card-grid, line: endcard.line }
captions: false
---

# <Campaign title>

One paragraph: the concept, the audience, the payoff. Approved script table:
`script-table.md`.

## Text

| key | en-us |
|---|---|
| hook | <The hook, ≤ 6 words> |
| setup.line | <The setup line, ≤ 6 s spoken> |
| beat1.line | <The rule or the claim this beat shows> |
| beat1.quip | <A short reaction> |
| endcard.line | <The CTA, with the URL spelled out: example dot com> |

## Shot setup — <what we see>

Prompt (still): <subject in a setting, the before state>. vertical 9:16, no text.

```yaml
preset: title-card
text: { t: hook }
duration: 1.5
line: setup.line
```

## Shot beat1 — <the one physical event>

Prompt (clip): Static locked-off camera. 0–2 s: <setup>. 2–4 s: <the action>.
4–6 s: <holds it>. No flash. vertical 9:16, no text.

```yaml
preset: action-verdict
clip: beat1                      # media-work/<campaign>/3-clips/beat1.mp4
result: beat1.result             # optional still after the cut
line: beat1.line
quip: beat1.quip
verdict: reject                  # reject | approve | none
```

## Voice scripts

Generation text with tags (the engine ignores this table).

| key | en-us |
|---|---|
| hook | [warm, amused] <hook> |
| beat1.quip | [disappointed sigh] <quip> |
