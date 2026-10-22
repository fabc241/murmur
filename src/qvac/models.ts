// Model lifecycle on top of @qvac/sdk. Only one model is resident at a time:
// an iPhone cannot comfortably hold Parakeet and MedPsy together.

import {
  HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
  PARAKEET_TDT_0_6B_V3_Q8_0,
  VERBOSITY,
  getModelInfo,
  loadModel,
  resume,
  state,
  unloadModel,
  type ModelProgressUpdate,
} from '@qvac/sdk';
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';

export type ModelKey = 'asr' | 'llm';

export const MODELS = {
  asr: {
    key: 'asr',
    label: 'Speech recognition',
    detail: 'Parakeet TDT 0.6B v3 · Q8_0',
    descriptor: PARAKEET_TDT_0_6B_V3_Q8_0,
    approxBytes: PARAKEET_TDT_0_6B_V3_Q8_0.expectedSize,
  },
  llm: {
    key: 'llm',
    label: 'Clinical note model',
    detail: 'MedPsy 1.7B · Q4_K_M',
    descriptor: HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
    approxBytes: HEALTHCARE_1_7B_MEDICAL_Q4_K_M.expectedSize,
  },
} as const;

/**
 * Visit transcript + reasoning + note must fit; see note.ts for the token budget.
 * The KV cache costs ~115 KB per token for MedPsy-1.7B, so 4 GB iPhones (e.g. iPhone 13)
 * get a smaller window to stay under the per-app memory limit; longer visits then use
 * the two-pass note flow.
 */
const SMALL_DEVICE = (Device.totalMemory ?? 0) > 0 && (Device.totalMemory ?? 0) <= 4.5e9;
export const LLM_CONTEXT_TOKENS = SMALL_DEVICE ? 4096 : 8192;

/** Set once the app has talked to the SDK, i.e. once the Bare worker is running. */
export let sdkStarted = false;

/** New operations are rejected while the runtime is suspended (see lifecycle.ts). */
async function ensureActive(): Promise<void> {
  sdkStarted = true;
  if ((await state()) !== 'active') await resume();
}

async function load(key: ModelKey, onProgress?: (pct: number) => void): Promise<string> {
  await ensureActive();
  const progress = onProgress && ((p: ModelProgressUpdate) => onProgress(overallPercent(p)));
  if (key === 'asr') {
    return loadModel({
      modelSrc: PARAKEET_TDT_0_6B_V3_Q8_0,
      modelType: 'parakeet-transcription',
      onProgress: progress,
    });
  }
  return loadModel({
    modelSrc: HEALTHCARE_1_7B_MEDICAL_Q4_K_M,
    // The P2P registry can time out on some networks. The same file on Hugging Face is used
    // instead, and the SDK verifies it against the catalog's SHA-256 before loading it.
    fallbackSrc: huggingFaceUrl(HEALTHCARE_1_7B_MEDICAL_Q4_K_M),
    modelType: 'llm',
    modelConfig: { device: 'gpu', ctx_size: LLM_CONTEXT_TOKENS, verbosity: VERBOSITY.ERROR },
    onProgress: progress,
  });
}

function huggingFaceUrl(model: { registrySource?: string; registryPath?: string }): string | undefined {
  return model.registrySource === 'hf' && model.registryPath ? `https://huggingface.co/${model.registryPath}` : undefined;
}

function overallPercent(p: ModelProgressUpdate): number {
  return p.fileSetInfo?.overallPercentage ?? p.shardInfo?.overallPercentage ?? p.percentage;
}

// --- Serialization -------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every previously scheduled model job has settled. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

/** Loads a model, hands its id to `fn`, and always unloads it afterwards. */
export function withModel<T>(
  key: ModelKey,
  fn: (modelId: string) => Promise<T>,
  onLoadProgress?: (pct: number) => void,
): Promise<T> {
  return exclusive(async () => {
    const modelId = await load(key, onLoadProgress);
    try {
      return await fn(modelId);
    } finally {
      await unloadModel({ modelId, clearStorage: false }).catch(() => undefined);
    }
  });
}

// --- First-run setup -----------------------------------------------------------

const readyFlag = () => new File(Paths.document, 'models-ready.json');

/**
 * Downloads a model (registry download, checksum-verified and resumable) and
 * proves it loads on this device. Loading, rather than just downloading, also
 * pulls Parakeet's Core ML encoder sidecar on iOS.
 */
export function prepareModel(key: ModelKey, onProgress: (pct: number) => void): Promise<void> {
  return withModel(key, async () => undefined, onProgress);
}

export function markModelsReady(): void {
  const flag = readyFlag();
  flag.create({ overwrite: true });
  flag.write(JSON.stringify({ readyAt: new Date().toISOString() }));
}

export async function areModelsReady(): Promise<boolean> {
  if (!readyFlag().exists) return false;
  try {
    await ensureActive();
    const infos = await Promise.all([
      getModelInfo({ name: MODELS.asr.descriptor.name }),
      getModelInfo({ name: MODELS.llm.descriptor.name }),
    ]);
    return infos.every((i) => i.isCached);
  } catch {
    // If the cache cannot be inspected, trust the flag; a missing file would be re-downloaded on load anyway.
    return true;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}
