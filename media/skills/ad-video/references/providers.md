# Providers

The engine is provider-agnostic: it assembles files. Generation happens in the agent
through MCP tools (or built-in tools). Record the project's choice in
`providers:` in `media-kit/brand.yaml` (the skill reads it; the engine never calls a
provider).

| Job | Default | Alternatives |
|---|---|---|
| Stills + edits (Nano Banana) | fal `fal-ai/nano-banana-2.1` and `/edit` | Google Gemini API image model (Nano Banana family, needs `GEMINI_API_KEY`), Antigravity's built-in image generation |
| Video clips: people in motion, multi-shot sequences | fal Kling 4.0 image-to-video (`kling/v4/image-to-video`: `multi_prompt` per shot, up to 8 `middle_image_urls`) | — |
| Video clips: short single actions (a grin, a tilt, an object) | fal FLUX 3 Max image-to-video (`image_url` + `end_image_url`) | any fal image-to-video model with first/last keyframes |
| Voice | ElevenLabs `eleven_v4` (emotion tags) | — |
| Music | ElevenLabs Music | — |
| Assembly | local engine (ffmpeg + sharp), never paid | — |

Endpoint ids change — look them up (`mcp__fal__search_models`, `recommend_model`,
ElevenLabs `creative_get_flow_node_types`); never guess one.

## fal (MCP)

- Fast path: `recommend_model` → `submit_job` / `run_model` → `check_job` → download the
  result URL → `ingest`.
- Several variations: one `submit_jobs` call, then `wait_for_jobs`.
- Prices: `get_pricing` / `estimate_cost` only when the user asks or sets a budget.
- Video: 9:16, 720p, `generate_audio: false` (the engine owns sound). `ingest` strips any
  audio track anyway and normalises the clip (constant frame rate, untagged colour).

## Choosing a video model

| Model | Use for | Notes |
|---|---|---|
| **Kling 4.0** (`kling/v4/image-to-video`, ~$0.157/s, 3–30 s) | people in motion (walking, running, gestures); a continuous sequence of several shots anchored to approved stills | `multi_prompt`: one prompt per shot; up to 8 `middle_image_urls` keep the character and wardrobe from drifting. Kling sets each shot's length itself (expect ±1–2 s), so cut by detected scene changes, never by the prompt's timing. Slow: 4–6 min per job. |
| **FLUX 3 Max** (720p, ~7 s) | short single actions: a grin, a head tilt, hair falling, an item dropping | first + last keyframe and a timestamped prompt. Walking comes out as slow motion; don't use it for people moving through a scene. |
| **Veo 3.1 Fast** (via ElevenLabs, ~$0.12/s) | fallback | a jog came out with a stutter step; check gaits frame by frame. |

Prices change; check with `get_pricing` / `estimate_cost` before quoting. Kling's
scene cuts: find them with an ffmpeg scene filter
(`ffmpeg -i clip.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -`) and set each
shot's `in`/`out` from the printed `pts_time`s.

## Google (Gemini API / Antigravity)

- Gemini API image model ids follow Google's naming (e.g. a "nano-banana" 2.x model);
  check Google's current model list. **9:16 output via the Google API is unverified** —
  test one image; fal's Nano Banana does 9:16.
- In Antigravity the built-in image tool can make stills/edits; save the files and
  `ingest` them like any other.
- The key lives in the environment (`GEMINI_API_KEY`), never in the repo.

## ElevenLabs (MCP)

- Speech: `creative_generate_speech` with a `voice_id` from the kit cast (or
  `creative_list_voices`); poll `creative_get_flow_run_status`; download; ingest.
- Two takes per line by default; the user picks; pin the pick, don't regenerate.
- Commercial use needs a paid plan (Starter or higher) — check before publishing, and
  after any MCP re-auth confirm the connected **workspace** (`setup.md` §Account checks).
- `eleven_v4` often repeats a short line 2–5× in one take, even when the prompt says
  "said once". Ingest with `--first-utterance` (keeps the first reading) or `--until=<s>`.
- Music: `creative_generate_in_flow` with the music node; 2–3 options.

## Costs

See `lessons.md` §Costs, and log every paid call:
`node "$E" spend --campaign=<id> --item="clip cow" --usd=0.43 --via=fal`.
