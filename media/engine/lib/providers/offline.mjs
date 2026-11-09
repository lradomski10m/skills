// --offline stand-ins for the paid providers. Same contracts, synthetic
// content, zero cost: solid stills, ffmpeg-generated clips with a white flash
// and a motion burst at a known time, and macOS `say` VO with approximated
// character timestamps.

import fs from 'node:fs/promises';
import { approximateAlignment } from '../captions.mjs';
import { CONFIG } from '../config.mjs';
import { OFFLINE } from '../constants.mjs';
import { offlineStillPng } from '../graphics.mjs';
import { ffmpeg, run } from '../media/ffmpeg.mjs';
import { wavDurationSec } from '../media/wav.mjs';

const BOX_COLOR = '0x5a3a22';
const BOX_SIZE = 260;
const BOX_TRAVEL_PX = 300;
const NOISE_STRENGTH = 5;

/** Injected beat for the n-th shot — cycles through config so timings vary. */
export const offlineActionAt = (index) => CONFIG.offline.actionAtSec[index % CONFIG.offline.actionAtSec.length];

/** ffmpeg filtergraph for a synthetic clip (pure, so it is unit-testable). */
export function offlineClipFilter({ actionAtSec, durationSec }) {
  const o = CONFIG.offline;
  const flashEnd = o.flashAtSec + o.flashFrames / o.clipFps - 0.001;
  const progress = `min(1,max(0,(t-${actionAtSec})/${o.burstSec}))`;
  return [
    `[0:v]scale=${o.clipWidth}:${o.clipHeight},fps=${o.clipFps},format=yuv420p,noise=alls=${NOISE_STRENGTH}:allf=t[bg]`,
    `color=c=${BOX_COLOR}:s=${BOX_SIZE}x${BOX_SIZE}:r=${o.clipFps}:d=${durationSec}[box]`,
    `[bg][box]overlay=x='${(o.clipWidth - BOX_SIZE) / 2 - BOX_TRAVEL_PX / 2}+${BOX_TRAVEL_PX}*${progress}':y=${o.clipHeight / 2 - BOX_SIZE / 2}:shortest=1[mv]`,
    `[mv]drawbox=x=0:y=0:w=iw:h=ih:color=white@0.97:t=fill:enable='between(t,${o.flashAtSec},${flashEnd.toFixed(3)})'[v]`,
  ].join(';');
}

export function createOfflineProviders({ locale }) {
  return {
    async still({ label, index, outFile }) {
      await fs.writeFile(outFile, await offlineStillPng(label, index));
      return { remoteUrl: null, seed: null };
    },

    async clip({ imageFile, outFile, index }) {
      const durationSec = CONFIG.models.clipParams.duration;
      const actionAtSec = offlineActionAt(index);
      await ffmpeg([
        '-loop', '1', '-t', String(durationSec), '-i', imageFile,
        '-filter_complex', offlineClipFilter({ actionAtSec, durationSec }),
        '-map', '[v]', '-t', String(durationSec), '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', outFile,
      ]);
      return { remoteUrl: null, seed: null, injected: { flashAtSec: CONFIG.offline.flashAtSec, actionAtSec } };
    },

    audioFile: 'wav',
    /**
     * Stand-in VO: macOS `say` when available (voice per locale, or the role's
     * offlineVoice); elsewhere a silent track of reading-speed length, so the
     * timeline still has realistic durations.
     */
    async speak({ text, voice, outAudio }) {
      const sayVoice = voice.offlineVoice ?? OFFLINE.SAY_VOICE_BY_LOCALE[locale];
      if (process.platform === 'darwin' && sayVoice) {
        const args = ['-v', sayVoice, '-o', outAudio, '--data-format=LEI16@44100'];
        if (voice.offlineRate) args.push('-r', String(voice.offlineRate));
        await run(OFFLINE.SAY_BIN, [...args, text]);
      } else {
        const sec = Math.max(0.6, text.length / CONFIG.offline.silentCharsPerSec);
        await ffmpeg(['-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`, '-t', sec.toFixed(2), '-c:a', 'pcm_s16le', outAudio]);
      }
      const dur = wavDurationSec(await fs.readFile(outAudio));
      return { alignment: approximateAlignment(text, dur) };
    },
  };
}
