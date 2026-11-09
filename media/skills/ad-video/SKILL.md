---
name: ad-video
description: Make short-form 9:16 promo videos (TikTok, Reels, Shorts) for any product, brand or service, in any ad style — ideate concepts from product context, build and reuse a project media kit (brand, voices, copy, music, templates), write a storyboard, generate stills/clips/voice/music through the fal and ElevenLabs MCP tools, assemble with a local ffmpeg composition engine, run review rounds, and localize. Use whenever someone wants to plan, script, generate, assemble, fix, re-cut or localize a video ad or promo clip.
---

# ad-video

Three phases, each step approved by the user before the next: **1 Ideate → 2 Media
kit → 3 Produce.** Generation happens through MCP tools (fal, ElevenLabs). A local
composition engine assembles everything from a **storyboard** (Markdown + YAML): it
times, brands, mixes and reviews, and never pays for anything. A new kind of video is
new data (storyboard, presets, templates), never a change to the engine.

**Engine** (Node CLI bundled with this plugin):

```bash
E="${CLAUDE_SKILL_DIR}/../../engine/cli.mjs"     # Claude Code substitutes the variable
node "$E" doctor
```

Other agents: the engine is `../../engine/cli.mjs` relative to this file. If the skill
was installed without it, see `references/setup.md` (clone + `npm ci`).

**Project layout** (in the user's repo; both roots can be changed with `--kit` / `--work`):

- `media-kit/` is committed, approved and reusable. It holds `brand.yaml`, `voices.yaml`,
  `copy/<locale>.yaml`, `presets/`, `templates/`, audio, footage, characters and
  `campaigns/<id>/storyboard.md`.
- `media-work/<campaign>/` is scratch (gitignored): `1-voice/<locale>`, `2-stills`,
  `3-clips`, `4-music`, `5-renders/<locale>`, `review/<locale>`, and a `README.md`
  that the engine writes.

**References**: read the one you need, when you need it.

| File | Use |
|---|---|
| `ideation.md` | Phase 1 |
| `media-kit.md` | Phase 2: kit formats, presets and templates |
| `patterns.md` | Ad patterns and the presets that build them |
| `storyboard.md` | The storyboard format, anchors, effects and transitions |
| `production.md` | Phase 3 workflow, ingest, review, localize, publish |
| `prompts.md` | Prompt templates, by pattern |
| `lessons.md` | Read before generating anything |
| `providers.md` | Image, video, voice and music providers |
| `setup.md` | Accounts, MCP, and install for Claude Code, Codex and Antigravity |
| `worked-example.md` | One complete campaign, end to end |

Templates: `templates/media-kit/` holds a YAML kit skeleton and a campaign template
(storyboard, script table, concept).

## Ground rules

- **Approval at every step.** Show the plan or the options and wait for a yes. Never chain
  paid steps without one.
- **Spend.** Before every paid batch, state the model, the count and the price
  (`lessons.md` §Costs). Make one generation per call unless options were asked for, and
  never retry silently. Log every paid MCP call:
  `node "$E" spend --campaign=<id> --item="…" --usd=<n> --via=fal`.
- **No AI-drawn text.** Models never draw text, logos, stamps, documents, UI, HUDs or
  URLs. The engine draws all of them from templates. Every visual prompt ends with the
  no-text tail.
- **Guardrails.** Label AI content on every platform. Use no real government insignia
  and no realistic document replicas. Use no real brands, game trade dress, fonts,
  logos, music or celebrities without rights. Harm no animals or people. Make only the
  claims on the kit's allowed list.
- **Files.** Put every generated file in place with `node "$E" ingest`. A replaced take
  moves to `_alt/` and is never deleted. Promote approved, reusable items into the kit.
- **Formats.** Everything a person edits is Markdown or YAML: storyboards, presets and
  the kit. JSON is engine-internal only.
- **The user reviews in `media-work/<campaign>/review/<locale>/`**: one numbered folder
  per shot. Rebuild it after every render and say which folder to look at.

## Step 0 — Setup (every run)

Run `node "$E" doctor` and fix what it reports. Then check the accounts the engine
can't see, by calling one cheap read-only tool per MCP (`setup.md`):

- **fal**: an account with a card (paid generations), and the MCP signed in.
- **ElevenLabs**: Starter plan or higher for commercial use, and the MCP signed in.
- **Image provider**: fal Nano Banana by default. The Google Gemini API or
  Antigravity's built-in image tool also work (`providers.md`). Record the choice in the
  kit.

If an MCP or account is missing, walk the user through `setup.md` for their tool.

## Phase 1 — Ideate ☐

Goal: 5–10 scored scenario ideas; the user picks one (`ideation.md`).

1. Gather product context: what it is, who buys it, the one promise, proof points,
   allowed claims, markets and locales. Read the project's docs first; ask only for gaps.
2. Go from audiences to the pains and jokes they already share, then to formats that
   currently work for them.
3. Write each scenario as hook → beats → payoff → CTA. Map each beat to a pattern
   (`patterns.md`). Score shareability, product fit, cost and risk. Recommend 1–2.

Save the pick as `media-kit/campaigns/<id>/concept.md`.

## Phase 2 — Media kit ☐

Goal: everything the concept needs exists in `media-kit/` and can be reused next time
(`media-kit.md`).

1. Find the kit, or create one from `templates/media-kit/`.
2. List what the concept needs: brand bug, colours, font, labels, end-card style and
   copy, QR target, voices per locale, reusable lines, music mood, templates (cards,
   HUD, lower thirds), footage and characters.
3. Mark each item as reuse, adapt or create, and get approval.
4. Create the missing items. Take brand assets from the real site or files. Pick voices
   from the ElevenLabs library. Write templates as SVG with placeholders. Write a
   project preset when no built-in fits. Save each approved item back to the kit.

## Phase 3 — Produce ☐ (each step)

Follow `production.md`. The format is in `storyboard.md`, prompts in `prompts.md`, and
pitfalls in `lessons.md`.

1. **Script table** (`templates/media-kit/campaigns/_template/script-table.md`): one row
   per beat with what we see, what we hear, on-screen text and the pattern. Add the
   hook, the end card and the music mood.
2. **Storyboard**: write `media-kit/campaigns/<id>/storyboard.md`, with one `## Shot`
   per beat. Each shot uses a preset, text goes in the `## Text` table, and prompts go
   in the prose. Check it with `node "$E" plan <id> --locale=<l>`, which validates and
   prints the timeline with stand-ins.
3. **Voices** (ElevenLabs `eleven_v4`, emotion tags): one file per line. The user picks
   takes. Ingest each with `--as=vo:<key> --locale=<l>`.
4. **Stills** (Nano Banana): first frames and backgrounds, two options each. Ingest
   with `--as=still:<key>`.
5. **Clips** (FLUX 3 Max image-to-video, first + last keyframe, timestamped prompt):
   one continuous clip per beat. Ingest with `--as=clip:<key>`.
6. **Derived stills**: result stills made from a clip's real last frame, and perfect or
   compliant variants. Ingest with `--as=result:<shot>` or `perfect:<shot>`.
7. **Music** (ElevenLabs Music): offer 2–3 options in
   `review/<locale>/<n> - music (CHOOSE)/`. Ingest the pick with `--as=music`. Beats are
   detected automatically, and montages cut on them.
8. **Assemble** (free): `node "$E" run <id> --locale=<l>`, then
   `node "$E" review <id> --locale=<l>`. Look at every `key-frames.png` yourself before
   handing over.
9. **Feedback loop**: the user answers per folder.
   - Timing, layout or mix: change the storyboard or a preset param (free re-render).
   - Content: regenerate only that asset (paid, ask first).
   - Something truly custom: a project preset, a template, or the campaign's
     `hooks.mjs` (`storyboard.md` §Escape hatch).
10. **Localize**: add a column to `## Text` (or a `storyboard.<locale>.md`), plus the
    locale's copy and voices. Visuals and music are reused. Prove it with `--offline`,
    then generate the real lines.
11. **Publish checklist**: `production.md` §Publish.

At the end, promote what was approved and reusable into `media-kit/`, and record the
decisions in `concept.md`.
