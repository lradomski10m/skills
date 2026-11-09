// Minimal RIFF/WAVE header reader (PCM) — enough to time offline `say` output
// without ffprobe.

export function wavDurationSec(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') {
      if (!byteRate) throw new Error('WAVE data chunk before fmt chunk');
      return Math.min(size, buf.length - off - 8) / byteRate;
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAVE file has no data chunk');
}
