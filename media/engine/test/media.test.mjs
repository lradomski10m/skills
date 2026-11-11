// Small synthetic ffmpeg renders (skipped without ffmpeg): transitions chained over
// many cuts, clip normalisation and voice cuts on ingest. Each runs in seconds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CONFIG } from '../lib/config.mjs';
import { transitionEffect } from '../lib/compose/compose.mjs';
import { effectsGraph } from '../lib/compose/effects.mjs';
import { ingest } from '../lib/ingest.mjs';
import { durationSec, ffmpeg, ffmpegBin, probe } from '../lib/media/ffmpeg.mjs';
import { workPaths } from '../lib/paths.mjs';

const skip = spawnSync(ffmpegBin(), ['-version']).status === 0 ? false : 'ffmpeg not installed';
const FPS = CONFIG.render.fps;
const W = 108;
const H = 192;
const SEG = 0.5;
const SEGMENTS = 14;
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'media-'));

/** Rows of RGB pixels per frame from a raw rgb24 buffer. */
const frames = (buf) => {
  const size = W * H * 3;
  const out = [];
  for (let off = 0; off + size <= buf.length; off += size) out.push(buf.subarray(off, off + size));
  return out;
};
const px = (frame, x, y = H / 2) => {
  const i = (y * W + x) * 3;
  return [frame[i], frame[i + 1], frame[i + 2]];
};
/** Segment k is red when k is even, blue when odd. */
const isRed = ([r, , b]) => r > 200 && b < 60;
const isBlue = ([r, , b]) => b > 200 && r < 60;

describe('transitions dissolve + slide (rendered)', { skip }, () => {
  it(`chain ${SEGMENTS - 1} transitions on a ${SEGMENTS * SEG}s base and finish quickly, frame-exact`, { timeout: 60_000 }, async () => {
    const dir = await tmp();
    const base = path.join(dir, 'base.mp4');
    // Alternating red / blue segments, cut every SEG seconds (one stream, like the engine's concatenated base).
    await ffmpeg([
      '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=${FPS}:d=${SEGMENTS * SEG}`,
      '-vf', `geq=r='255*(1-mod(floor(T/${SEG}),2))':g=0:b='255*mod(floor(T/${SEG}),2)',format=yuv420p`,
      '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', base,
    ]);
    const dur = 0.2;
    const effects = Array.from({ length: SEGMENTS - 1 }, (_, k) => transitionEffect({ name: k % 2 ? 'dissolve' : 'slide', durSec: dur }, SEG * (k + 1)));
    const t0 = Date.now();
    const raw = await ffmpeg(['-i', base, '-filter_complex', effectsGraph(effects, '0:v', 'fx'), '-map', '[fx]', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
    const took = (Date.now() - t0) / 1000;
    const f = frames(raw);
    assert.equal(f.length, SEGMENTS * SEG * FPS, 'no frame dropped or added');
    assert.ok(took < 30, `rendered in ${took}s`);
    const segFrames = SEG * FPS;
    const durFrames = Math.round(dur * FPS);
    for (let k = 1; k < SEGMENTS; k++) {
      const cut = k * segFrames;
      const [outgoing, incoming] = k % 2 ? [isRed, isBlue] : [isBlue, isRed];
      assert.ok(outgoing(px(f[cut - 1], W / 2)), `cut ${k}: last outgoing frame untouched`);
      assert.ok(incoming(px(f[cut + durFrames + 1], W / 2)), `cut ${k}: incoming shot alone after the transition`);
      const mid = f[cut + Math.floor(durFrames / 2)];
      if ((k - 1) % 2 === 0) {
        // slide (left): the held outgoing frame stays at the left edge, the incoming shot covers the right.
        assert.ok(outgoing(px(mid, 1)), `cut ${k}: slide — outgoing still at the left edge`);
        assert.ok(incoming(px(mid, W - 2)), `cut ${k}: slide — incoming at the right edge`);
      } else {
        // dissolve: a blend of both, everywhere.
        const [r, , b] = px(mid, W / 2);
        assert.ok(r > 40 && r < 215 && b > 40 && b < 215, `cut ${k}: dissolve blends (r=${r}, b=${b})`);
      }
    }
  });
});

describe('ingest normalisation (rendered)', { skip }, () => {
  it('re-encodes a tagged 25 fps clip with audio to untagged 30 fps CFR, video only; a conformant clip is copied', { timeout: 60_000 }, async () => {
    const dir = await tmp();
    const src = path.join(dir, 'kling.mp4');
    await ffmpeg([
      '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=25:d=1`, '-f', 'lavfi', '-i', 'sine=d=1',
      '-vf', 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-shortest', src,
    ]);
    assert.equal((await probe(src)).streams.find((s) => s.codec_type === 'video').color_primaries, 'bt709', 'fixture is tagged');
    const paths = workPaths({ workRoot: path.join(dir, 'w'), campaign: 'c', locale: 'pl' });
    const logs = [];
    const { dest } = await ingest({ source: src, paths, as: 'clip:kling', log: (l) => logs.push(l) });
    const info = await probe(dest);
    const v = info.streams.find((s) => s.codec_type === 'video');
    assert.equal(info.streams.filter((s) => s.codec_type === 'audio').length, 0);
    assert.equal(v.r_frame_rate, `${FPS}/1`);
    assert.equal(v.avg_frame_rate, `${FPS}/1`);
    assert.equal(v.pix_fmt, 'yuv420p');
    for (const k of ['color_primaries', 'color_transfer', 'color_space']) assert.ok([undefined, 'unknown'].includes(v[k]), `${k}=${v[k]}`);
    assert.match(logs.join('\n'), /normalised: 25 fps → 30 fps; colour tags bt709 → unspecified; 1 audio track dropped/);
    const again = [];
    await ingest({ source: dest, paths, as: 'clip:copy', log: (l) => again.push(l) });
    assert.match(again.join('\n'), /already conformant/);
    const dialogue = await ingest({ source: src, paths, as: 'clip:talk', keepAudio: true, log: () => {} });
    assert.equal((await probe(dialogue.dest)).streams.filter((s) => s.codec_type === 'audio').length, 1, '--keep-audio keeps the sound');
  });

  it('voice: --first-utterance keeps the first of three readings; --until cuts with a fade', { timeout: 60_000 }, async () => {
    const dir = await tmp();
    const src = path.join(dir, 'take.wav');
    // Three 0.6 s "readings" separated by 0.6 s pauses.
    await ffmpeg(['-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,1.2),0.6),0.5*sin(2*PI*440*t),0)':s=44100:d=3", src]);
    const paths = workPaths({ workRoot: path.join(dir, 'w'), campaign: 'c', locale: 'pl' });
    const logs = [];
    const first = await ingest({ source: src, paths, as: 'vo:hook', firstUtterance: true, log: (l) => logs.push(l) });
    const d = await durationSec(first.dest);
    assert.ok(Math.abs(d - (0.6 + CONFIG.ingest.voFadeSec)) < 0.06, `kept ${d}s`);
    assert.match(logs.join('\n'), /first utterance 0\.00–0\.6\ds; cut .* \(2 later pauses: repeated reading\)/);
    const until = await ingest({ source: src, paths, as: 'vo:line', until: 1.0, log: () => {} });
    assert.ok(Math.abs((await durationSec(until.dest)) - 1.0) < 0.06);
    await assert.rejects(ingest({ source: src, paths, as: 'still:x', until: 1, log: () => {} }), /voice takes .* only/);
  });
});
