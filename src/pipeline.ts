// Orchestrates recording -> transcript -> note for a visit and exposes live
// progress to the UI. Model work is serialized inside qvac/models.ts.

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useState } from 'react';
import { cancelNote, generateNote, type NoteProgress } from './qvac/note';
import { CancelledError, cancelTranscription, transcribeVisit, type CancelToken, type TranscriptionProgress } from './qvac/transcribe';
import { getVisit, updateVisit } from './storage/visits';

export type PipelineProgress =
  | { stage: 'queued' }
  | ({ stage: 'transcription' } & TranscriptionProgress)
  | ({ stage: 'note' } & NoteProgress);

type Job = { progress: PipelineProgress; token: CancelToken; kind: 'full' | 'note' };

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setProgress(id: string, progress: PipelineProgress) {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = progress;
  emit();
}

export function useVisitJob(id: string | undefined): Job | undefined {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return id ? jobs.get(id) : undefined;
}

export function isProcessing(id: string): boolean {
  return jobs.has(id);
}

export function hasActiveJobs(): boolean {
  return jobs.size > 0;
}

async function run(id: string, kind: Job['kind'], work: (token: CancelToken) => Promise<void>) {
  if (jobs.has(id)) return;
  const token: CancelToken = { cancelled: false };
  jobs.set(id, { progress: { stage: 'queued' }, token, kind });
  emit();
  const keepAwakeTag = `visit-${id}`;
  await activateKeepAwakeAsync(keepAwakeTag).catch(() => undefined);
  try {
    await work(token);
  } catch (e) {
    const message =
      e instanceof CancelledError ? 'Processing was cancelled.' : e instanceof Error ? e.message : String(e);
    await updateVisit(id, { status: 'error', error: message }).catch(() => undefined);
  } finally {
    deactivateKeepAwake(keepAwakeTag);
    jobs.delete(id);
    emit();
  }
}

async function writeNote(id: string, transcript: string, token: CancelToken) {
  await updateVisit(id, { status: 'generating', error: undefined });
  const result = await generateNote(transcript, (p) => setProgress(id, { stage: 'note', ...p }), token);
  await updateVisit(id, {
    status: 'ready',
    note: result.note,
    noteEdited: false,
    rawNote: result.rawNote,
    thinking: result.thinking,
    removedStatements: result.removed,
    noteGeneratedAt: new Date().toISOString(),
  });
}

/** Full pipeline. Resumes from whatever was already completed (transcript chunks, transcript). */
export function processVisit(id: string): Promise<void> {
  return run(id, 'full', async (token) => {
    const visit = await getVisit(id);
    if (!visit) throw new Error('Visit not found');

    let transcript = visit.transcript;
    if (transcript === undefined) {
      transcript = await transcribeVisit(id, (p) => setProgress(id, { stage: 'transcription', ...p }), token);
      await updateVisit(id, { status: 'transcribed', transcript, transcriptParts: undefined });
    }
    if (!transcript.trim()) {
      throw new Error('No speech was detected in this recording.');
    }
    await writeNote(id, transcript, token);
  });
}

/** Re-runs only the note step, e.g. after the clinician corrected the transcript. */
export function regenerateNote(id: string): Promise<void> {
  return run(id, 'note', async (token) => {
    const visit = await getVisit(id);
    if (!visit?.transcript?.trim()) throw new Error('There is no transcript to document.');
    await writeNote(id, visit.transcript, token);
  });
}

export async function cancelProcessing(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  await cancelTranscription(job.token);
  await cancelNote(job.token);
}
