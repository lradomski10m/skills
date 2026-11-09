# skills

Reusable agent skills, grouped by domain into plugins. Built for **Claude Code**, and
usable from **Codex** and **Google Antigravity**. MIT licensed.

| Plugin | Skills | What it does |
|---|---|---|
| [`media`](media/) | `ad-video` | Plan, generate, assemble and localize short-form 9:16 promo videos (TikTok, Reels, Shorts) for any product: ideation from product context, a reusable project media kit, generation through the fal and ElevenLabs MCP servers, and a local composition engine (ffmpeg, sharp, resvg) that turns a Markdown/YAML storyboard into a timed, branded, mixed and reviewed video. New video types are presets and templates, not code. |

More skills land as folders under a plugin's `skills/`; a new domain becomes a new plugin
folder next to `media/`.

## Install

### Claude Code

```
/plugin marketplace add lradomski10m/skills
/plugin install media@lradomski-skills
```

Use it by asking for a video ad, or run `/media:ad-video`. Then sign in to the bundled
MCP servers with `/mcp` (fal, ElevenLabs). The plugin's engine dependencies (sharp,
qrcode, yaml, resvg) are installed automatically from its lockfile.

Recommend it to everyone on a project with a committed `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "lradomski-skills": { "source": { "source": "github", "repo": "lradomski10m/skills" } }
  },
  "enabledPlugins": { "media@lradomski-skills": true }
}
```

### Codex

Skills install through the [`skills`](https://github.com/vercel-labs/skills) CLI:

```
npx skills add lradomski10m/skills -a codex        # project: .agents/skills/  (-g for ~/.agents/skills/)
```

That copies the skill only. The skill also needs the engine:

```
git clone https://github.com/lradomski10m/skills ~/.local/share/lradomski-skills
cd ~/.local/share/lradomski-skills/media && npm ci
```

MCP servers:

```
codex mcp add fal --url https://mcp.fal.ai/mcp-relay
codex mcp add elevenlabs --url https://api.elevenlabs.io/v1/mcp
codex mcp login fal && codex mcp login elevenlabs
```

### Antigravity

`agy` (1.4.x) installs plugins from a local directory, so clone first and install the
plugin folder:

```
git clone https://github.com/lradomski10m/skills ~/.local/share/lradomski-skills
cd ~/.local/share/lradomski-skills/media && npm ci
agy plugin install ~/.local/share/lradomski-skills/media
```

The plugin's `mcp_config.json` declares fal and ElevenLabs; sign in when Antigravity
asks. If you already installed the plugin in Claude Code, `agy plugin import claude` may
bring it over (not tested). Skill-only alternative: `npx skills add lradomski10m/skills -a antigravity`
plus the engine clone above and the MCP servers from
[`media/mcp_config.json`](media/mcp_config.json).

## Prerequisites

| Need | Notes |
|---|---|
| Node.js ≥ 22 | the engine is a Node CLI |
| ffmpeg with libass | macOS `brew install ffmpeg-full` · Debian/Ubuntu `apt install ffmpeg` · Windows `winget install Gyan.FFmpeg` |
| fal account | add a card and a spend limit (images and video clips) |
| ElevenLabs account | Starter plan or higher for commercial use (voice, music) |

The skill's first step runs `doctor`, which checks all of this and prints the fix for each
miss.

## Costs (approximate, November 2026)

| Item | Cost |
|---|---|
| Video clip, FLUX 3 Max, 720p, ~7 s | ~$0.43 (discount windows vary) |
| Still or image edit (Nano Banana) | a few cents |
| Voice line (ElevenLabs) | a few cents of plan credits |
| Music track, ~35 s (ElevenLabs) | ~$0.18 |
| A 4-shot ~30 s video, with retakes | ≈ $4–6 |

Assembly is local and free. The skill states the price before every paid step and asks
first.

## Upgrading from 0.1.x

0.2.0 replaces the JSON campaign specs with `storyboard.md` and the JSON media kit with
YAML. Run `node <plugin>/engine/cli.mjs migrate-kit` in the project. It writes
`brand.yaml`, `voices.yaml`, `copy/<locale>.yaml` and `campaigns/<id>/storyboard.md`,
and moves the old files to `media-kit/_alt/0.1.x/`. The engine's live generation mode
(API keys) is gone. Generate through the MCP servers and `ingest`.

## Not yet verified

(Verified locally: `claude plugin validate --strict` on the repo and on `media/`;
`agy plugin validate ./media`; `npx skills add <repo> --list` finds `ad-video`; engine
tests and an end-to-end render.)


- Claude Code: sign-in (OAuth) for remote MCP servers bundled in a plugin. If `/mcp`
  offers no sign-in, add the servers yourself with `claude mcp add --transport http …`.
- Antigravity: `agy plugin install <url>` — `agy` 1.4.12 accepts only a directory, and
  the repository root is not a plugin (`media/` is). Also `agy plugin import claude`, and
  remote-MCP sign-in. `agy plugin validate ./media` passes, with one expected warning:
  `.mcp.json` is Claude Code's file and Antigravity ignores it.
- Codex reading skills from `.agents/skills/` (per the `skills` CLI's agent table).
- Google's Gemini API producing 9:16 Nano Banana images (fal does).

## Privacy

The plugin connects to fal (https://fal.ai/privacy) and ElevenLabs
(https://elevenlabs.io/privacy-policy) through their MCP servers when you generate media;
prompts and uploaded images/audio go to those services under their terms. The engine
itself runs locally and sends nothing anywhere.

## License

[MIT](LICENSE) © 2026 Luke Radomski. The bundled Inter font is under the SIL Open Font
License ([media/engine/fonts/OFL.txt](media/engine/fonts/OFL.txt)).
