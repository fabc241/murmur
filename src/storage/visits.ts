// On-device persistence. Each visit lives in Documents/visits/<id>/ as
// audio.wav + visit.json. Nothing here touches the network.

import { Directory, File, Paths } from 'expo-file-system';
import type { RemovedStatement } from '../note/guardrails';
import type { SoapNote } from '../note/schema';

export type VisitStatus = 'recorded' | 'transcribing' | 'transcribed' | 'generating' | 'ready' | 'error';

export type Visit = {
  id: string;
  title: string;
  createdAt: string;
  durationMs: number;
  consentConfirmed: boolean;
  status: VisitStatus;
  error?: string;
  /** Per-chunk transcripts, saved as they complete so an interrupted run can resume. */
  transcriptParts?: string[];
  transcriptChunkCount?: number;
  transcript?: string;
  transcriptEdited?: boolean;
  note?: SoapNote;
  noteEdited?: boolean;
  /** Raw model answer (after reasoning was split off), kept for audit. */
  rawNote?: string;
  /** Captured model reasoning. Shown on demand, never exported. */
  thinking?: string;
  removedStatements?: RemovedStatement[];
  noteGeneratedAt?: string;
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeVisits(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((l) => l());
}

function visitsRoot(): Directory {
  const dir = new Directory(Paths.document, 'visits');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function visitDir(id: string): Directory {
  return new Directory(visitsRoot(), id);
}

export function audioFile(id: string): File {
  return new File(visitDir(id), 'audio.wav');
}

function jsonFile(id: string): File {
  return new File(visitDir(id), 'visit.json');
}

export function newVisitId(): string {
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function getVisit(id: string): Promise<Visit | null> {
  const file = jsonFile(id);
  if (!file.exists) return null;
  try {
    return JSON.parse(await file.text()) as Visit;
  } catch {
    return null;
  }
}

export async function listVisits(): Promise<Visit[]> {
  const entries = visitsRoot().list();
  const visits = await Promise.all(
    entries.filter((e): e is Directory => e instanceof Directory).map((d) => getVisit(d.name)),
  );
  return visits.filter((v): v is Visit => v !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function saveVisit(visit: Visit): void {
  const dir = visitDir(visit.id);
  dir.create({ intermediates: true, idempotent: true });
  const file = jsonFile(visit.id);
  file.create({ overwrite: true });
  file.write(JSON.stringify(visit));
  emit();
}

export async function updateVisit(id: string, patch: Partial<Visit>): Promise<Visit> {
  const current = await getVisit(id);
  if (!current) throw new Error('Visit not found');
  const next = { ...current, ...patch };
  saveVisit(next);
  return next;
}

/** Moves a finished recording from the recorder's cache into the visit folder. */
export function createVisitFromRecording(
  recordingUri: string,
  meta: { title: string; durationMs: number; consentConfirmed: boolean },
): Visit {
  const id = newVisitId();
  const dir = visitDir(id);
  dir.create({ intermediates: true, idempotent: true });
  new File(recordingUri).move(audioFile(id));
  const visit: Visit = {
    id,
    title: meta.title.trim() || 'Untitled visit',
    createdAt: new Date().toISOString(),
    durationMs: meta.durationMs,
    consentConfirmed: meta.consentConfirmed,
    status: 'recorded',
  };
  saveVisit(visit);
  return visit;
}

export function deleteVisit(id: string): void {
  const dir = visitDir(id);
  if (dir.exists) dir.delete();
  emit();
}

/** Visits left mid-pipeline by a crash or force-quit are surfaced as retryable errors. */
export async function recoverInterruptedVisits(): Promise<void> {
  const visits = await listVisits();
  for (const v of visits) {
    if (v.status === 'transcribing' || v.status === 'generating') {
      saveVisit({ ...v, status: 'error', error: 'Processing was interrupted. Tap Retry to continue.' });
    }
  }
}

/** Scratch directory for transcription chunks; wiped after each run. */
export function chunkDir(id: string): Directory {
  const dir = new Directory(Paths.cache, `chunks-${id}`);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true });
  return dir;
}
