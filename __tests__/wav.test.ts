import { encodeWav, parseWav, splitWav, wavDurationMs } from '../src/audio/wav';

const RATE = 16000;

/** Builds PCM where each second is either a loud tone or silence, per `pattern`. */
function pcm(seconds: number, loud: (sec: number) => boolean): Uint8Array {
  const out = new Uint8Array(seconds * RATE * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < seconds * RATE; i++) {
    const s = loud(Math.floor(i / RATE)) ? Math.round(Math.sin(i / 5) * 12000) : 0;
    view.setInt16(i * 2, s, true);
  }
  return out;
}

/** Inserts an `FLLR` padding chunk before `data`, like AVAudioRecorder does. */
function withFllr(wav: Uint8Array): Uint8Array {
  const fllr = new Uint8Array(8 + 4044);
  fllr.set([0x46, 0x4c, 0x4c, 0x52]); // "FLLR"
  new DataView(fllr.buffer).setUint32(4, 4044, true);
  const out = new Uint8Array(wav.length + fllr.length);
  out.set(wav.subarray(0, 36));
  out.set(fllr, 36);
  out.set(wav.subarray(36), 36 + fllr.length);
  return out;
}

describe('parseWav', () => {
  it('reads a canonical header', () => {
    const info = parseWav(encodeWav(pcm(1, () => true), RATE, 1));
    expect(info).toMatchObject({ audioFormat: 1, channels: 1, sampleRate: RATE, bitsPerSample: 16, dataOffset: 44, dataLength: RATE * 2 });
  });

  it('skips FLLR padding chunks', () => {
    const info = parseWav(withFllr(encodeWav(pcm(2, () => true), RATE, 1)));
    expect(info.dataOffset).toBe(44 + 8 + 4044);
    expect(info.dataLength).toBe(2 * RATE * 2);
  });

  it('falls back to file length when the data size was never finalized', () => {
    const wav = encodeWav(pcm(1, () => true), RATE, 1);
    new DataView(wav.buffer).setUint32(40, 0xffffffff, true);
    expect(parseWav(wav).dataLength).toBe(RATE * 2);
  });

  it('rejects non-WAV input', () => {
    expect(() => parseWav(new Uint8Array(64))).toThrow('Not a WAV file');
  });
});

describe('splitWav', () => {
  it('keeps short recordings in one chunk', () => {
    const chunks = splitWav(encodeWav(pcm(30, () => true), RATE, 1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 30000 });
  });

  it('cuts inside the silent gap of the search window and never exceeds maxSec', () => {
    // Speech everywhere except second 53.
    const wav = encodeWav(pcm(150, (s) => s !== 53), RATE, 1);
    const chunks = splitWav(wav, { maxSec: 60, searchWindowSec: 10 });
    expect(chunks[0].endMs).toBeGreaterThanOrEqual(53000);
    expect(chunks[0].endMs).toBeLessThanOrEqual(54000);
    for (const c of chunks) expect(c.endMs - c.startMs).toBeLessThanOrEqual(60000);
    expect(chunks[chunks.length - 1].endMs).toBe(150000);
  });

  it('produces contiguous, self-contained WAV chunks covering all audio', () => {
    const source = pcm(130, () => true);
    const chunks = splitWav(withFllr(encodeWav(source, RATE, 1)));
    let total = 0;
    chunks.forEach((c, i) => {
      if (i > 0) expect(c.startMs).toBe(chunks[i - 1].endMs);
      const info = parseWav(c.wav);
      expect(info.dataOffset).toBe(44);
      total += info.dataLength;
    });
    expect(total).toBe(source.length);
    expect(wavDurationMs(chunks[0].wav)).toBe(chunks[0].endMs - chunks[0].startMs);
  });

  it('rejects float PCM', () => {
    const wav = encodeWav(pcm(1, () => true), RATE, 1);
    new DataView(wav.buffer).setUint16(20, 3, true);
    expect(() => splitWav(wav)).toThrow('Unsupported WAV encoding');
  });
});
