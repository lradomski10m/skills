import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ffmpegHint, formatDoctor, STATUS } from '../lib/doctor.mjs';
import { fontsConf } from '../lib/fonts.mjs';
import { campaignReadme } from '../lib/readme.mjs';

describe('doctor', () => {
  it('gives a per-OS ffmpeg (libass) install hint', () => {
    assert.match(ffmpegHint('darwin'), /brew install ffmpeg-full/);
    assert.match(ffmpegHint('linux'), /apt install ffmpeg/);
    assert.match(ffmpegHint('win32'), /winget install Gyan\.FFmpeg/);
    assert.match(ffmpegHint('aix'), /libass/);
  });
  it('prints a checklist with fixes for misses and a verdict', () => {
    const text = formatDoctor([
      { name: 'Node.js', status: STATUS.OK, detail: 'v22', fix: null },
      { name: 'ffmpeg', status: STATUS.FAIL, detail: 'not found', fix: 'install it' },
    ]);
    assert.match(text, /✓ Node\.js/);
    assert.match(text, /✗ ffmpeg[\s\S]*→ install it/);
    assert.match(text, /1 required item\(s\) missing/);
  });
});

describe('fonts', () => {
  it('writes a fontconfig file listing the font dirs in order', () => {
    const conf = fontsConf(['/a', '/b&c'], '/cache');
    assert.ok(conf.indexOf('<dir>/a</dir>') < conf.indexOf('<dir>/b&amp;c</dir>'));
    assert.match(conf, /<cachedir>\/cache<\/cachedir>/);
  });
});

describe('campaign README', () => {
  const spec = { id: 'demo-pl', title: 'Demo', campaign: 'demo', locale: 'pl' };
  const rows = [{ id: 'cow', still: true, clip: false, result: false, perfect: false, line: true, quip: false }];
  it('says what to do next and totals the spend', () => {
    const text = campaignReadme({ spec, rows, voiceRows: [], music: false, lastRender: null, spend: [{ date: 'd', item: 'clip cow', usd: 0.43 }, { date: 'd', item: 'still', usd: 0.04 }] });
    assert.match(text, /Generate the missing inputs \(cow\)/);
    assert.match(text, /\| cow \| yes \| — \|/);
    assert.match(text, /Total so far: \*\*\$0\.47\*\*/);
  });
  it('points at the review folder once there is a render', () => {
    const text = campaignReadme({ spec, rows, voiceRows: [], music: true, lastRender: { file: '/x/demo-pl.inputs.mp4', totalSec: 12.3 }, spend: [] });
    assert.match(text, /Open `review\/pl\/`/);
    assert.match(text, /demo-pl\.inputs\.mp4` — 12\.30 s/);
  });
});
