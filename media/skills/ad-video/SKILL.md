---
name: ad-video
description: Make short-form 9:16 promo videos (TikTok, Reels, Shorts) for any product or service — ideate viral concepts from product context, build and reuse a project media kit (brand, voices, copy, music), generate stills/clips/voice/music through the fal and ElevenLabs MCP tools, assemble with a local ffmpeg engine, run review rounds, and localize into more languages. Use whenever someone wants to plan, script, generate, assemble, fix, re-cut or localize a video ad or promo clip.
---

# ad-video

Three phases, each step approved by the user before the next: **1 Ideate → 2 Media
kit → 3 Produce.** Generation happens through MCP tools (fal, ElevenLabs); a local
engine assembles, times, brands, mixes and reviews — it never pays for anything in
`--inputs` mode.

**Engine** (Node CLI bundled with this plugin):

```bash
E="${CLAUDE_SKILL_DIR}/../../engine/cli.mjs"     # Claude Code substitutes the variable
node "$E" doctor
```

Other agents: the engine is `../../engine/cli.mjs` relative to this file; if the skill
was installed without it, see `references/setup.md` (clone + `npm ci`).

**Project layout** (in the user's repo, both roots configurable with `--kit` / `--work`):

- `media-kit/` — committed, approved, reusable: brand, voices, copy, music, campaigns.
- `media-work/<campaign>/` — scratch (add to `.gitignore`): `1-voice/<locale>`, `2-stills`,
  `3-clips`, `4-music`, `5-renders/<locale>`, `review/<locale>`, auto `README.md`.

**References** — read the one you need, when you need it:
`ideation.md` · `media-kit.md` · `production.md` · `shot-types.md` · `prompts.md` ·
`lessons.md` (read before generating anything) · `providers.md` · `setup.md` ·
`worked-example.md`. Templates: `templates/media-kit/` (kit skeleton + campaign template).

## Ground rules

- **Approval at every step.** Show the plan or the options, wait for a yes. Never chain
  paid steps without one.
- **Spend.** Before every paid batch, state model, count and price (`lessons.md` §Costs).
  One generation per call unless options were asked for; never retry silently. Log
  every paid MCP call: `node "$E" spend --campaign=<id> --item="…" --usd=<n> --via=fal`.
- **No AI-drawn text.** Models never draw text, logos, stamps, documents, UI or URLs —
  the engine draws all of it. Every visual prompt ends with the no-text tail.
- **Guardrails.** Label AI content on every platform. No real government insignia or
  realistic ID/document replicas, no real brands or celebrities without rights, no
  harm to animals or people, claims only from the kit's allowed-claims list.
- **Files.** Put every downloaded file in place with `node "$E" ingest` (a replaced
  take moves to `_alt/`, never deleted). Promote approved, reusable items into the kit.
- **The user reviews in `media-work/<campaign>/review/<locale>/`** — numbered folders,
  one per shot. Rebuild it after every render and say which folder to look at.

## Step 0 — Setup (every run)

Run `node "$E" doctor` and fix what it reports. Then check the accounts the engine
can't see, by calling one cheap read-only tool per MCP (`setup.md` has the list):

- **fal** — account with a card (paid generations); MCP signed in.
- **ElevenLabs** — Starter plan or higher for commercial use; MCP signed in.
- **Image provider** — fal Nano Banana by default; Google Gemini API or Antigravity's
  built-in image tool also work (`providers.md`). Record the choice in the kit.

Missing MCP or account → walk the user through `setup.md` for their tool (Claude Code,
Codex, Antigravity). Don't continue to paid steps until it works.

## Phase 1 — Ideate ☐

Goal: 5–10 scored scenario ideas, the user picks one. Follow `ideation.md`:

1. Gather product context: what it is, who buys it, the one promise, proof points,
   allowed claims, markets/locales, competitors. Read existing docs first; ask only
   for what's missing.
2. Audiences → pains/jokes they already share → current viral formats that fit.
3. Write scenarios (hook, what happens, payoff, product moment, CTA), score each
   (shareability, product fit, production cost, risk), recommend 1–2.
4. Map the pick onto shot types (`shot-types.md`). A **todo** shot type means agree
   scope first: adapt the idea, or build the shot type in the engine.

Save the chosen concept as `media-kit/campaigns/<campaign>/concept.md`.

## Phase 2 — Media kit ☐

Goal: everything the concept needs exists in `media-kit/`, reusable next time.
Follow `media-kit.md`:

1. Find the kit (`./media-kit`, or ask). None → create it from `templates/media-kit/`.
2. List what this concept needs (brand chip, colours, font, stamp labels, end-card
   style + copy, QR target, voices per locale, reusable lines, music mood, footage…).
3. For each item: **reuse** as is · **adapt** · **create** — show the list, get approval.
4. Create missing items (brand assets from the user's site/files, voices via
   ElevenLabs voice library or design, copy per locale). Save each approved item back
   into the kit. The kit is an open, growing set — never assume it is complete.

## Phase 3 — Produce ☐ (per step)

Follow `production.md`; prompts in `prompts.md`; pitfalls in `lessons.md`.

1. **Script table** — `templates/media-kit/campaigns/_template/script-table.md`: one row per
   shot (rule/beat, visible action start→end, line, reaction), hook, end card, music mood.
2. **Spec** — `media-kit/campaigns/<campaign>/base.json` (visuals, shots, timing) +
   `<locale>.json` (all text + voices). Validate: `node "$E" run <campaign> --locale=<l> --dry-run`.
3. **Voices** (ElevenLabs, `eleven_v4`, emotion tags) — one file per line; user picks
   takes; `ingest --as=vo:<shot>.line|vo:<shot>.quip|vo:hook|vo:endcard.announcer --locale=<l>`.
4. **Stills** (Nano Banana txt2img) — first frame per shot, 2 options; `--as=still:<shot>`.
5. **Clips** (FLUX 3 Max i2v, first + last keyframe, timestamped prompt) — one continuous
   clip per shot; `--as=clip:<shot>`.
6. **Result + perfect stills** (Nano Banana edit) — result from the clip's real last
   frame; perfect photos only for the grid end card; `--as=result:<shot>` / `perfect:<shot>`.
7. **Music** (ElevenLabs Music) — 2–3 options in `review/<locale>/<n> - music (CHOOSE)/`;
   `--as=music`.
8. **Assemble** (free): `node "$E" run <campaign> --locale=<l> --inputs`, then
   `node "$E" review <campaign> --locale=<l> --inputs`. Check every
   `frames-around-flash.png` yourself before handing over.
9. **Feedback loop** — the user answers per folder. Timing/layout/mix → spec or config
   (free re-render). Content → regenerate only that asset (paid, ask). New shot type →
   design in `shot-types.md`, then build it in the engine with tests.
10. **Localize** — add `<locale>.json` (the loader names every missing key); visuals and
    music are reused; prove the path with `--offline`, then real voices.
11. **Publish checklist** — `production.md` §Publish.

At the end: promote what was approved and reusable (voices, lines, music bed, copy,
stamp labels, end-card copy) into `media-kit/`, and update the campaign's `concept.md`
with decisions made.
