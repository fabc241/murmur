// Pure WAV utilities: header parsing, silence-aware chunking and re-encoding.
// No Expo/RN imports here so the module stays unit-testable under Jest.

export type WavInfo = {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
};

export type WavChunk = {
  index: number;
  startMs: number;
  endMs: number;
  wav: Uint8Array;
};

export type ChunkOptions = {
  /** Hard upper bound for a chunk, in seconds. */
  maxSec?: number;
  /** Length of the window (ending at maxSec) searched for the quietest cut point. */
  searchWindowSec?: number;
  /** Energy frame size used to find the cut point. */
  frameMs?: number;
};

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Parses a RIFF/WAVE header. Walks every chunk instead of assuming a 44-byte
 * header, because AVAudioRecorder may insert `FLLR` padding before `data`.
 */
export function parseWav(bytes: Uint8Array): WavInfo {
  if (bytes.length < 12 || fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WAVE') {
    throw new Error('Not a WAV file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataLength'> | null = null;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = fourCC(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data chunk precedes fmt chunk');
      // A recording that was not finalized may report 0 or 0xFFFFFFFF; trust the file length then.
      const remaining = bytes.length - body;
      const dataLength = size === 0 || size > remaining ? remaining : size;
      return { ...fmt, dataOffset: body, dataLength };
    }
    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk');
}

function assertPcm16(info: WavInfo) {
  const isPcm = info.audioFormat === WAVE_FORMAT_PCM || info.audioFormat === WAVE_FORMAT_EXTENSIBLE;
  if (!isPcm || info.bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV encoding (format ${info.audioFormat}, ${info.bitsPerSample}-bit)`);
  }
}

/** Builds a canonical 44-byte-header PCM WAV around the given sample bytes. */
export function encodeWav(pcm: Uint8Array, sampleRate: number, channels: number, bitsPerSample = 16): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const blockAlign = (channels * bitsPerSample) / 8;
  const writeId = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
  };
  writeId(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeId(8, 'WAVE');
  writeId(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, WAVE_FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeId(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Returns frame indices [start, end) for each chunk. A frame is one sample per
 * channel. Cuts land on the quietest `frameMs` window inside the last
 * `searchWindowSec` of each `maxSec` span, so words are rarely split.
 */
export function planCuts(
  samples: DataView,
  totalFrames: number,
  sampleRate: number,
  channels: number,
  opts: ChunkOptions = {},
): [number, number][] {
  const maxFrames = Math.floor((opts.maxSec ?? 60) * sampleRate);
  const windowFrames = Math.floor((opts.searchWindowSec ?? 10) * sampleRate);
  const energyFrames = Math.max(1, Math.floor(((opts.frameMs ?? 50) / 1000) * sampleRate));
  const bytesPerFrame = channels * 2;

  const energy = (from: number, to: number) => {
    let sum = 0;
    for (let f = from; f < to; f++) {
      const s = samples.getInt16(f * bytesPerFrame, true);
      sum += s * s;
    }
    return sum;
  };

  const ranges: [number, number][] = [];
  let start = 0;
  while (totalFrames - start > maxFrames) {
    const searchFrom = start + maxFrames - windowFrames;
    const searchTo = start + maxFrames;
    let bestCut = searchTo;
    let bestEnergy = Infinity;
    for (let f = searchFrom; f + energyFrames <= searchTo; f += energyFrames) {
      const e = energy(f, f + energyFrames);
      if (e < bestEnergy) {
        bestEnergy = e;
        bestCut = f + Math.floor(energyFrames / 2);
      }
    }
    ranges.push([start, bestCut]);
    start = bestCut;
  }
  if (totalFrames > start) ranges.push([start, totalFrames]);
  return ranges;
}

/** Splits a 16-bit PCM WAV into self-contained WAV chunks of at most `maxSec`. */
export function splitWav(bytes: Uint8Array, opts: ChunkOptions = {}): WavChunk[] {
  const info = parseWav(bytes);
  assertPcm16(info);
  const bytesPerFrame = info.channels * 2;
  const totalFrames = Math.floor(info.dataLength / bytesPerFrame);
  const data = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, totalFrames * bytesPerFrame);
  const ranges = planCuts(data, totalFrames, info.sampleRate, info.channels, opts);

  return ranges.map(([from, to], index) => {
    const pcm = bytes.subarray(info.dataOffset + from * bytesPerFrame, info.dataOffset + to * bytesPerFrame);
    return {
      index,
      startMs: Math.round((from / info.sampleRate) * 1000),
      endMs: Math.round((to / info.sampleRate) * 1000),
      wav: encodeWav(pcm, info.sampleRate, info.channels),
    };
  });
}

export function wavDurationMs(bytes: Uint8Array): number {
  const info = parseWav(bytes);
  const bytesPerFrame = info.channels * (info.bitsPerSample / 8);
  return Math.round((info.dataLength / bytesPerFrame / info.sampleRate) * 1000);
}
