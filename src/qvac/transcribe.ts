// Chunked on-device transcription with Parakeet TDT v3.

import { cancel, transcribe } from '@qvac/sdk';
import { File } from 'expo-file-system';
import { splitWav } from '../audio/wav';
import { audioFile, chunkDir, getVisit, updateVisit } from '../storage/visits';
import { withModel } from './models';

const NO_SPEECH = '[No speech detected]';

export type TranscriptionProgress =
  | { phase: 'loading'; pct: number }
  | { phase: 'transcribing'; done: number; total: number };

export type CancelToken = { cancelled: boolean; requestId?: string };

/** The SDK reads files through bare-fs, which expects a plain POSIX path. */
function toPosixPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function cleanSegment(text: string): string {
  return text.replace(NO_SPEECH, '').replace(/\s+/g, ' ').trim();
}

export async function transcribeVisit(
  visitId: string,
  onProgress: (p: TranscriptionProgress) => void,
  token: CancelToken,
): Promise<string> {
  const visit = await getVisit(visitId);
  if (!visit) throw new Error('Visit not found');

  const chunks = splitWav(await audioFile(visitId).bytes(), { maxSec: 60, searchWindowSec: 10 });
  // Chunking is deterministic, so a previous partial run can be resumed where it stopped.
  const parts =
    visit.transcriptChunkCount === chunks.length && visit.transcriptParts ? [...visit.transcriptParts] : [];
  await updateVisit(visitId, { status: 'transcribing', error: undefined, transcriptChunkCount: chunks.length, transcriptParts: parts });

  const dir = chunkDir(visitId);
  try {
    if (parts.length < chunks.length) {
      await withModel(
        'asr',
        async (modelId) => {
          for (let i = parts.length; i < chunks.length; i++) {
            if (token.cancelled) throw new CancelledError();
            onProgress({ phase: 'transcribing', done: i, total: chunks.length });

            const file = new File(dir, `chunk-${String(i).padStart(3, '0')}.wav`);
            file.create({ overwrite: true });
            file.write(chunks[i].wav);

            const call = transcribe({ modelId, audioChunk: toPosixPath(file.uri) });
            token.requestId = call.requestId;
            const text = await call;
            token.requestId = undefined;

            parts.push(cleanSegment(text));
            file.delete();
            await updateVisit(visitId, { transcriptParts: parts });
          }
        },
        (pct) => onProgress({ phase: 'loading', pct }),
      );
    }
  } finally {
    if (dir.exists) dir.delete();
  }

  onProgress({ phase: 'transcribing', done: chunks.length, total: chunks.length });
  // One paragraph per ~minute keeps the transcript readable and editable.
  return parts.filter(Boolean).join('\n\n');
}

export async function cancelTranscription(token: CancelToken): Promise<void> {
  token.cancelled = true;
  if (token.requestId) await cancel({ requestId: token.requestId }).catch(() => undefined);
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}
