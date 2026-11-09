// ElevenLabs TTS with character-level timestamps.
// POST /v1/text-to-speech/{voice_id}/with-timestamps → { audio_base64, alignment, normalized_alignment }

import fs from 'node:fs/promises';
import { CONFIG } from '../config.mjs';
import { ELEVENLABS } from '../constants.mjs';

export function ttsRequestBody({ text, voice }) {
  const body = { text, model_id: voice.modelId ?? CONFIG.models.tts.modelId };
  if (voice.settings) body.voice_settings = voice.settings;
  // Only some models accept language_code (others reject it) — opt-in per voice.
  if (voice.languageCode) body.language_code = voice.languageCode;
  if (Number.isInteger(voice.seed)) body.seed = voice.seed;
  return body;
}

export function createElevenLabsProvider({ key }) {
  return {
    audioFile: 'mp3',
    async speak({ text, voice, outAudio }) {
      const url = `${ELEVENLABS.API_BASE}${ELEVENLABS.TTS_TIMESTAMPS_PATH(voice.voiceId)}?output_format=${CONFIG.models.tts.outputFormat}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { [ELEVENLABS.AUTH_HEADER]: key, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(ttsRequestBody({ text, voice })),
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${(await res.text()).slice(0, 1000)}`);
      const json = await res.json();
      const alignment = json.alignment ?? json.normalized_alignment;
      if (!json.audio_base64 || !alignment?.characters) {
        throw new Error(`ElevenLabs response missing audio_base64/alignment: ${JSON.stringify(json).slice(0, 300)}`);
      }
      await fs.writeFile(outAudio, Buffer.from(json.audio_base64, 'base64'));
      return { alignment };
    },
  };
}
