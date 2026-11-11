# Setup

Run `node "$E" doctor` first; it checks Node, ffmpeg (with libass), the engine
dependencies, fonts, the media kit and the work folder, and prints the fix for each miss.
Accounts and MCP sign-in can't be checked by the engine — check them by calling one cheap
read-only tool per MCP (fal: `check_account_status`; ElevenLabs: `creative_list_voices`).

## Account checks (every session, and after any re-auth)

- **ElevenLabs workspace.** After any MCP sign-in or re-auth, confirm *which* account is
  connected: make one estimate-only / read-only call that shows the workspace id and
  compare it with the project's paid workspace. A re-auth once silently connected a free
  account (non-commercial licence, then disabled). Don't generate anything until the
  workspace is right.
- **fal jobs are charged once running.** `cancel_job` does not stop a job that has
  started; it is billed in full. Check the parameters (model, length, resolution,
  count) before `submit_job`, not after.

## Updating

How to update the plugin, the skill copy and the engine clone for each tool: the
repository README, §Update to the latest version. Claude Code:
`claude plugin marketplace update lradomski-skills` then
`claude plugin update media@lradomski-skills`, then `/reload-plugins`.

## Requirements

| Need | Fix |
|---|---|
| Node ≥ 22 | https://nodejs.org (or `nvm install 22`) |
| ffmpeg with libass | macOS `brew install ffmpeg-full` (plain `ffmpeg` lacks libass; the engine prefers ffmpeg-full automatically) · Debian/Ubuntu `apt install ffmpeg` · Windows `winget install Gyan.FFmpeg` (full build) · or set `MEDIA_FFMPEG` / `MEDIA_FFPROBE` |
| Engine deps (sharp, qrcode, yaml, @resvg/resvg-js) | Claude Code installs them with the plugin; elsewhere `npm ci` in the plugin's `media/` folder |
| Font | bundled (Inter, OFL); a kit adds its own with `font.files` in `brand.yaml` |
| fal account | sign up at fal.ai, add a card, set a spend limit |
| ElevenLabs account | Starter plan or higher for commercial use |
| `.gitignore` | add `media-work/` in the consuming project |
| A 0.1.x JSON kit | `node "$E" migrate-kit` converts it to YAML (old files move to `media-kit/_alt/0.1.x/`) |

## Claude Code

- Install: `/plugin marketplace add lradomski10m/skills` → `/plugin install media@lradomski-skills`.
  Invoke `/media:ad-video` (or just ask for a video ad).
- MCP: the plugin declares fal and ElevenLabs (remote HTTP). Run `/mcp`, pick each
  server and sign in (OAuth). If a server doesn't offer sign-in, add it yourself:
  `claude mcp add --transport http fal https://mcp.fal.ai/mcp-relay` and
  `claude mcp add --transport http elevenlabs https://api.elevenlabs.io/v1/mcp`.
- Engine path in this skill: `${CLAUDE_SKILL_DIR}/../../engine/cli.mjs` (substituted in
  the skill text; the variable is not in the Bash environment).
- Project pin (committed `.claude/settings.json`):
  ```json
  {
    "extraKnownMarketplaces": { "lradomski-skills": { "source": { "source": "github", "repo": "lradomski10m/skills" } } },
    "enabledPlugins": { "media@lradomski-skills": true }
  }
  ```

## Codex

- Skill: `npx skills add lradomski10m/skills -a codex` (installs into `.agents/skills/`,
  or `~/.agents/skills/` with `-g`). This copies the skill folder only — get the engine
  with a clone: `git clone https://github.com/lradomski10m/skills ~/.local/share/lradomski-skills
  && cd ~/.local/share/lradomski-skills/media && npm ci`, then use
  `E=~/.local/share/lradomski-skills/media/engine/cli.mjs`.
- MCP: `codex mcp add fal --url https://mcp.fal.ai/mcp-relay` and
  `codex mcp add elevenlabs --url https://api.elevenlabs.io/v1/mcp`, then
  `codex mcp login <name>` for OAuth. (Or `[mcp_servers.<name>] url = "…"` in
  `~/.codex/config.toml`.)

## Antigravity

- Plugin: `agy` installs from a directory — clone the repo, `npm ci` in `media/`, then
  `agy plugin install <clone>/media`. The plugin's `mcp_config.json` declares fal and
  ElevenLabs; sign in when Antigravity asks.
- Skill only: `npx skills add lradomski10m/skills -a antigravity` (+ the engine clone as
  for Codex) and add the MCP servers from `media/mcp_config.json` to Antigravity's MCP
  settings.
- Images: Antigravity's built-in image generation can replace fal for stills/edits
  (`providers.md`).
