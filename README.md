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

## Update to the latest version

Check the installed version first: `claude plugin list` (Claude Code), or `git log -1` /
`media/package.json` in your clone (Codex, Antigravity). Then:

### Claude Code

Third-party marketplaces do not auto-update by default, so update by hand. In your shell:

```
claude plugin marketplace update lradomski-skills
claude plugin update media@lradomski-skills
```

or inside a session: `/plugin marketplace update lradomski-skills`, then `/plugin` →
**Installed** → `media` → **Update now** (or **Marketplaces** → `lradomski-skills` →
**Update marketplace**, which updates every plugin installed from it). A running
session keeps the version it loaded: run `/reload-plugins` or start a new session. To
get updates automatically from now on: `/plugin` → **Marketplaces** →
`lradomski-skills` → **Enable auto-update**.

### Codex

The skill is a copy and the engine is a clone; update both:

```
cd ~/.local/share/lradomski-skills && git pull
cd media && npm ci
npx skills update ad-video                          # the skill copy (-g if you installed with -g)
```

(If `skills update` does not pick it up, re-run the install command,
`npx skills add lradomski10m/skills -a codex`.)

### Antigravity

```
cd ~/.local/share/lradomski-skills && git pull
cd media && npm ci
agy plugin install ~/.local/share/lradomski-skills/media
```

If `agy` reports the plugin is already installed, run `agy plugin uninstall media` and
install again. Skill-only installs: `npx skills update ad-video`
after the `git pull` + `npm ci`.

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
| Video clip, FLUX 3 Max, 720p, ~7 s (short single actions) | ~$0.43 (discount windows vary) |
| Video clip, Kling 4.0 (people in motion, multi-shot), per second | ~$0.157 (3–30 s per job) |
| Still or image edit (Nano Banana) | a few cents |
| Voice line (ElevenLabs) | a few cents of plan credits |
| Music track, ~35 s (ElevenLabs) | ~$0.18 |
| A 4-shot ~30 s video, with retakes | ≈ $4–6 |

Assembly is local and free. The skill states the price before every paid step and asks
first.

## Changelog

### 0.3.0

Lessons from a 68 s, 17-shot, two-locale production.

- **Clip normalisation on ingest**: `ingest --as=clip:*` re-encodes to constant 30 fps,
  clears colour tags, yuv420p, drops audio (`--keep-audio` for lip-synced dialogue) and
  prints what changed; a conformant clip is copied.
- **Music**: a bed shorter than the video plays once, fades at its end and is padded
  with silence, with a warning giving the shortfall. Looping only with
  `music: { loop: true }`.
- **Render watchdog**: every ffmpeg call runs with `-progress`; the final pass prints
  progress, and a pass whose output stops advancing for 120 s
  (`render.watchdog.stallSec`) is killed with a clear error.
- **Transitions `dissolve` and `slide`** (`direction: left|right|up|down`), safe to chain
  over many cuts.
- **Locale overlays override front matter**: `storyboard.<locale>.md` may set `end`,
  `music`, `brandBug`, `cuts`, `hook`, `overlays`, `title`, `tempo`, `tempoOverrides`,
  `captions` for that locale.
- **`phone-demo` hold + stamp**: `hold` freezes the recording's last frame while audio
  continues; `verdict` / `stampAt` / `clerk` / `quip` / `timerTo`. A `pip` overlay takes
  `out` and `hold`.
- **Voice ingest**: `--until=<sec>` and `--first-utterance` (cut a take that repeats the
  line).
- **Template lint** in `plan`/`run`: warns about visible SVG text that is not a
  `{{param}}`.
- Docs: Kling 4.0 for people in motion, account checks after re-auth, music cut to
  picture, phone demos with real recordings, how to update.

### 0.2.0

The composition engine: `storyboard.md`, presets and SVG templates; YAML media kit.

## Upgrading from 0.2.x

Update as above (Claude Code: `claude plugin update media@lradomski-skills`). Storyboards
and kits need no changes. What behaves differently:

- **Music beds no longer loop.** A bed shorter than the video now ends in silence (with
  a warning). Generate a longer bed or add `music: { loop: true }` to keep 0.2.x
  behaviour.
- **Ingest re-encodes clips.** Clips ingested from now on are normalised; re-ingest
  clips you placed by hand or with 0.2.x if they come from Kling/Veo (BT.709 tags) or
  are screen recordings (VFR). A lip-synced `dialogue` clip needs `--keep-audio`.
- **`slide` / `dissolve`** are built in: a campaign `hooks.mjs` that defines effects with
  these names still wins, so remove the hook to use the built-ins.
- **`phone-demo`** is unchanged without `hold`/`verdict`, except that the recording is
  converted to constant frame rate before trimming.
- A locale overlay file with front matter was ignored before; its keys now apply (and
  unknown keys are errors).

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


- Update paths outside Claude Code: `npx skills update ad-video` for a skill copy, and
  re-running `agy plugin install` over an installed plugin (the Claude Code commands are
  from the Claude Code docs, "Install and manage plugins" → "Keep plugins updated").
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
