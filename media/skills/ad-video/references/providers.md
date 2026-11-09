# Providers

The engine is provider-agnostic: it assembles files. Generation happens in the agent
through MCP tools (or built-in tools). Record the project's choice in
`media-kit/README.md` (or `media-kit/providers.json`).

| Job | Default | Alternatives |
|---|---|---|
| Stills + edits (Nano Banana) | fal `fal-ai/nano-banana-2.1` and `/edit` | Google Gemini API image model (Nano Banana family, needs `GEMINI_API_KEY`), Antigravity's built-in image generation |
| Video clips | fal FLUX 3 Max image-to-video (`image_url` + `end_image_url`) | any fal image-to-video model with first/last keyframes |
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
- Video: 9:16, 720p, 5–7 s, `generate_audio: false` (the engine owns sound).

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
- Commercial use needs a paid plan (Starter or higher) — check before publishing.
- Music: `creative_generate_in_flow` with the music node; 2–3 options.

## Costs

See `lessons.md` §Costs, and log every paid call:
`node "$E" spend --campaign=<id> --item="clip cow" --usd=0.43 --via=fal`.
