// fal.ai queue REST client: submit → poll status_url → fetch response_url.
// Uses the status/response URLs fal returns rather than building them, since
// for nested endpoint ids (owner/app/sub-path) the request lives under the app.

import fs from 'node:fs/promises';
import { CONFIG } from '../config.mjs';
import { FAL } from '../constants.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function falFetch(url, key, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `${FAL.AUTH_SCHEME} ${key}`, 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`fal ${init.method ?? 'GET'} ${url} → HTTP ${res.status}: ${text.slice(0, 1000)}`);
  }
  return body;
}

export async function falQueueRun(endpoint, input, { key, log = () => {}, poll = CONFIG.poll }) {
  const submitted = await falFetch(`${FAL.QUEUE_BASE}/${endpoint}`, key, { method: 'POST', body: JSON.stringify(input) });
  const { request_id: id, status_url: statusUrl, response_url: responseUrl } = submitted;
  if (!statusUrl || !responseUrl) throw new Error(`fal submit to ${endpoint} returned no status/response URL: ${JSON.stringify(submitted)}`);
  log(`fal ${endpoint} queued (${id})`);
  const deadline = Date.now() + poll.timeoutMs;
  let last = '';
  for (;;) {
    const status = await falFetch(statusUrl, key);
    if (status.status === FAL.STATUS.COMPLETED) break;
    if (status.status !== last) log(`fal ${id}: ${status.status}${status.queue_position != null ? ` (queue ${status.queue_position})` : ''}`);
    last = status.status;
    if (![FAL.STATUS.IN_QUEUE, FAL.STATUS.IN_PROGRESS].includes(status.status)) {
      throw new Error(`fal ${id} unexpected status: ${JSON.stringify(status).slice(0, 500)}`);
    }
    if (Date.now() > deadline) throw new Error(`fal ${id} timed out after ${poll.timeoutMs / 1000}s`);
    await sleep(poll.intervalMs);
  }
  const result = await falFetch(responseUrl, key);
  return { requestId: id, result };
}

export async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/**
 * ASSUMPTION (unverified): fal accepts a base64 data URI wherever a file URL
 * is expected. Only used when a still has no fal-hosted URL (local override).
 */
export async function fileToDataUri(file, mime = 'image/png') {
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
}

export function createFalProviders({ key, log }) {
  return {
    async still({ prompt, seed, outFile }) {
      const input = { prompt, seed, ...CONFIG.models.stillParams };
      const { requestId, result } = await falQueueRun(CONFIG.models.still, input, { key, log });
      const url = result?.images?.[0]?.url;
      if (!url) throw new Error(`fal still returned no images[0].url: ${JSON.stringify(result).slice(0, 500)}`);
      await download(url, outFile);
      return { remoteUrl: url, requestId, seed: result.seed ?? seed };
    },

    async clip({ imageUrl, imageFile, prompt, seed, outFile }) {
      const image_url = imageUrl ?? (await fileToDataUri(imageFile));
      const input = { prompt, image_url, seed, ...CONFIG.models.clipParams };
      const { requestId, result } = await falQueueRun(CONFIG.models.clip, input, { key, log });
      const url = result?.video?.url;
      if (!url) throw new Error(`fal clip returned no video.url: ${JSON.stringify(result).slice(0, 500)}`);
      await download(url, outFile);
      return { remoteUrl: url, requestId, seed: result.seed ?? seed, durationSec: result.video.duration ?? null };
    },
  };
}
