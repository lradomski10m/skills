// API keys: environment first, then the secrets file (~/.config/media-skills.env,
// override with MEDIA_SECRETS_FILE). Never a repo.

import fs from 'node:fs';
import { ENV, SECRETS_FILE as DEFAULT_SECRETS_FILE } from './constants.mjs';
import { UserError } from './errors.mjs';

/** Parse KEY=VALUE lines; `#` comments and blank lines ignored; quotes stripped. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    out[key] = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export function loadSecrets({ required }) {
  const SECRETS_FILE = process.env[ENV.SECRETS_FILE] || DEFAULT_SECRETS_FILE;
  const fromFile = fs.existsSync(SECRETS_FILE) ? parseEnvFile(fs.readFileSync(SECRETS_FILE, 'utf8')) : {};
  const get = (k) => process.env[k] || fromFile[k] || '';
  const secrets = { falKey: get(ENV.FAL_KEY), elevenLabsKey: get(ENV.ELEVENLABS_API_KEY) };
  if (required) {
    const missing = [
      !secrets.falKey && ENV.FAL_KEY,
      !secrets.elevenLabsKey && ENV.ELEVENLABS_API_KEY,
    ].filter(Boolean);
    if (missing.length) {
      throw new UserError(
        `Missing API key(s): ${missing.join(', ')}.\n` +
          `Put them in ${SECRETS_FILE} (KEY=value, one per line) or export them.\n` +
          'Or run with --offline to render with synthetic inputs.',
      );
    }
  }
  return secrets;
}
