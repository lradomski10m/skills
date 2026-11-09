# <Campaign> — <title> (<locale>)

Concept: `concept.md` · Audience / platform: <…> · Target length: <~30 s> · Music mood: <…>

## Hook
| On screen | Spoken | Duration |
|---|---|---|
| <hook text> | <same / none> | ≤ 2 s |

## Shots
| # | Shot id | Rule / beat | Action (visible: start → break → hold) | Line (VO) | Reaction (quip / stamp / card) | Beat mode |
|---|---|---|---|---|---|---|
| 1 | <id> | <rule> | <start state, rule kept> → <the break> → <hold> | "<line>" | <stamp + quip> | action / settle |

## End card
| Element | Content |
|---|---|
| Style | real-sheet / grid / grid-strip / tilted / classic |
| Announcer | "<line>" (stamp lands at "<phrase>") |
| CTA / hint | "<Go to example.com>" / "<link in bio ↓>" |
| Sheet text (real-sheet) | tagline "<…>", order line "<…>", QR <https://…> |

## Checks before generating
- [ ] Every rule is visible in the first frame, then broken.
- [ ] Every beat is one physical event a model can render.
- [ ] No text, logos, documents or real brands requested from a model.
- [ ] Claims only from the kit's allowed list.
