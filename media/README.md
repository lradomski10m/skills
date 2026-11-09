# media plugin

Skills for short-form media production. Current skill: **`ad-video`**.

Install in Claude Code (2.1.275 or later):

```
/plugin install media --marketplace lradomski10m/skills
```

or in two steps: `/plugin marketplace add lradomski10m/skills`, then
`/plugin install media@lradomski-skills`. Other tools: see the [repository README](../README.md).

## ad-video

Makes 9:16 promo videos for any product or service, in three phases, with the user
approving every step:

1. **Ideate**: product context → audiences → viral formats → 5–10 scored scenarios.
2. **Media kit**: find or create the project's `media-kit/` (brand, colours, fonts,
   voices, copy, music, footage, characters), reuse what fits, save new approved pieces back.
3. **Produce**: script table → spec → voices → stills → clips → result stills → music →
   assemble → review → feedback → localize → publish.

Generation runs through the bundled **fal** and **ElevenLabs** MCP servers. Assembly runs
locally in the **engine** (`engine/cli.mjs`, ffmpeg + sharp). Assembly never pays for
anything: it plans the flash and cuts from measured motion, draws every brand element,
levels and ducks music under the voice, normalises loudness, and builds a review folder.

In the consuming project:

```
media-kit/                 committed: brand/, voices/, copy/, audio/, overlays/, footage/, characters/, campaigns/
media-work/<campaign>/     scratch:   1-voice/<locale>  2-stills  3-clips  4-music  5-renders/<locale>  review/<locale>  README.md
```

## Engine CLI

```
node engine/cli.mjs doctor
node engine/cli.mjs run <campaign> --locale=<l> --inputs         # assemble from media-work (free)
node engine/cli.mjs run <campaign> --locale=<l> --offline        # stand-ins for everything (free)
node engine/cli.mjs ingest <url|file> --campaign=<id> --as=<role> [--locale=<l>]
node engine/cli.mjs review <campaign> --locale=<l> --inputs
node engine/cli.mjs spend --campaign=<id> --item="…" --usd=<n>   # log an MCP generation
```

Common flags: `--kit=<dir>` (default `./media-kit`, env `MEDIA_KIT`), `--work=<dir>`
(default `./media-work`, env `MEDIA_WORK`). Without a kit the engine uses a neutral
built-in one. Optional live mode (the engine calls fal/ElevenLabs itself) reads
`FAL_KEY` / `ELEVENLABS_API_KEY` from the environment or `~/.config/media-skills.env`.

Engine internals and rules: [`engine/README.md`](engine/README.md). Tests: `npm test`
in this folder.

## Files

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Claude Code manifest |
| `.antigravity-plugin/plugin.json` | Antigravity manifest (takes precedence there) |
| `.mcp.json` / `mcp_config.json` | fal + ElevenLabs remote MCP (Claude Code / Antigravity) |
| `package.json` + `package-lock.json` | engine dependencies, exact pins |
| `engine/` | the assembly CLI |
| `skills/ad-video/` | the skill: `SKILL.md`, `references/`, `templates/` |

## Privacy

When you generate media, prompts and uploaded images/audio go to fal
(https://fal.ai/privacy) and ElevenLabs (https://elevenlabs.io/privacy-policy) through
their MCP servers. The engine runs locally and sends nothing.
