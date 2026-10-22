// Streamed SOAP-note generation with MedPsy-1.7B (Qwen3 thinking backbone).

import { InferenceCancelledError, cancel, completion } from '@qvac/sdk';
import { applyGuardrails, splitSentences, type RemovedStatement } from '../note/guardrails';
import { NOT_DISCUSSED, SOAP_SECTIONS, SECTION_TITLES, parseSoap, stripThinking, type SoapNote } from '../note/schema';
import { LLM_CONTEXT_TOKENS, withModel } from './models';
import {
  FACTS_SYSTEM_PROMPT,
  MERGE_SYSTEM_PROMPT,
  NOTE_SYSTEM_PROMPT,
  factsUserPrompt,
  mergeUserPrompt,
  noteUserPrompt,
} from './prompts';
import { CancelledError, type CancelToken } from './transcribe';

// Reasoning is capped so the model must move on to the note: unbounded, MedPsy restated the
// whole transcript and prompt in its reasoning and ran for 20+ minutes on an iPhone 13.
const REASONING_BUDGET = 512;
const PREDICT_TOKENS = REASONING_BUDGET + (LLM_CONTEXT_TOKENS >= 8192 ? 1536 : 1024);
const PROMPT_OVERHEAD_TOKENS = 400; // system prompt + chat template + safety margin
const CHARS_PER_TOKEN = 3.5; // conservative for English clinical speech
const MAX_TRANSCRIPT_CHARS = Math.floor((LLM_CONTEXT_TOKENS - PREDICT_TOKENS - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN);

const SAMPLING = { temp: 0.3, top_p: 0.95, top_k: 20, predict: PREDICT_TOKENS, reasoning_budget: REASONING_BUDGET };

export type NoteProgress =
  | { phase: 'loading'; pct: number }
  | {
      phase: 'generating';
      pass: string;
      content: string;
      thinking: string;
      /** Streamed deltas so far; llama.cpp emits about one token per delta. */
      tokens: number;
      elapsedMs: number;
    };

export type NoteResult = {
  note: SoapNote;
  rawNote: string;
  thinking: string;
  removed: RemovedStatement[];
};

type Message = { role: 'system' | 'user'; content: string };

async function runCompletion(
  modelId: string,
  history: Message[],
  pass: string,
  onProgress: (p: NoteProgress) => void,
  token: CancelToken,
): Promise<{ content: string; thinking: string }> {
  const attempt = async (reasoningBudget?: number) => {
    if (token.cancelled) throw new CancelledError();
    const run = completion({
      modelId,
      history,
      stream: true,
      captureThinking: true,
      generationParams: reasoningBudget === undefined ? SAMPLING : { ...SAMPLING, reasoning_budget: reasoningBudget },
    });
    token.requestId = run.requestId;
    const startedAt = Date.now();
    let content = '';
    let thinking = '';
    let tokens = 0;
    let stopReason: string | undefined;
    try {
      for await (const event of run.events) {
        if (event.type === 'contentDelta') content += event.text;
        else if (event.type === 'thinkingDelta') thinking += event.text;
        else if (event.type === 'completionDone') {
          stopReason = event.stopReason;
          if (event.stopReason === 'error' && 'error' in event) throw new Error(event.error.message);
        }
        if (event.type === 'contentDelta' || event.type === 'thinkingDelta') {
          tokens++;
          onProgress({ phase: 'generating', pass, content, thinking, tokens, elapsedMs: Date.now() - startedAt });
        }
      }
      const final = await run.final;
      const st = final.stats;
      console.log(
        `[Murmur] ${pass}: ${st?.generatedTokens ?? tokens} tokens in ${((Date.now() - startedAt) / 1000).toFixed(0)} s, ` +
          `${st?.tokensPerSecond?.toFixed(1) ?? '?'} tok/s, prompt ${st?.promptTokens ?? '?'} tokens at ` +
          `${st?.promptTokensPerSecond?.toFixed(0) ?? '?'} tok/s, backend ${st?.backendDevice ?? '?'}, stop ${final.stopReason ?? stopReason}`,
      );
      return {
        content: stripThinking(final.contentText ?? content),
        thinking: (final.thinkingText ?? thinking).trim(),
        stopReason: final.stopReason ?? stopReason,
      };
    } catch (e) {
      if (e instanceof InferenceCancelledError || token.cancelled) throw new CancelledError();
      throw e;
    } finally {
      token.requestId = undefined;
    }
  };

  const first = await attempt();
  if (first.content.trim()) return first;
  // Reasoning consumed the whole token budget before any answer: retry once with reasoning disabled.
  if (first.stopReason === 'length') {
    const retry = await attempt(0);
    if (retry.content.trim()) {
      return { content: retry.content, thinking: `${first.thinking}\n\n[Reasoning exceeded the token budget; the note was regenerated with reasoning disabled.]` };
    }
  }
  throw new Error('The model did not produce a note. Try regenerating.');
}

/** Splits a long transcript on paragraph (then sentence) boundaries into slices under `max` chars. */
export function sliceTranscript(transcript: string, max: number): string[] {
  const units = transcript.split(/\n{2,}/).flatMap((p) => (p.length <= max ? [p] : splitSentences(p)));
  const slices: string[] = [];
  let current = '';
  for (const unit of units) {
    if (current && current.length + unit.length + 2 > max) {
      slices.push(current.trim());
      current = '';
    }
    current += (current ? '\n\n' : '') + unit;
  }
  if (current.trim()) slices.push(current.trim());
  return slices;
}

function sectionsAsFacts(note: SoapNote, index: number): string {
  const body = SOAP_SECTIONS.filter((s) => note[s] !== NOT_DISCUSSED)
    .map((s) => `${SECTION_TITLES[s]}:\n${note[s]}`)
    .join('\n');
  return `### Part ${index + 1}\n${body || NOT_DISCUSSED}`;
}

export async function generateNote(
  transcript: string,
  onProgress: (p: NoteProgress) => void,
  token: CancelToken,
): Promise<NoteResult> {
  if (!transcript.trim()) throw new Error('The transcript is empty, so there is nothing to document.');

  return withModel(
    'llm',
    async (modelId) => {
      let raw: string;
      let thinking: string;

      if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
        const out = await runCompletion(
          modelId,
          [
            { role: 'system', content: NOTE_SYSTEM_PROMPT },
            { role: 'user', content: noteUserPrompt(transcript) },
          ],
          'Writing note',
          onProgress,
          token,
        );
        raw = out.content;
        thinking = out.thinking;
      } else {
        // Long visit: extract facts per slice, then merge them into one note.
        const slices = sliceTranscript(transcript, MAX_TRANSCRIPT_CHARS);
        const partials: string[] = [];
        const thoughts: string[] = [];
        for (let i = 0; i < slices.length; i++) {
          const out = await runCompletion(
            modelId,
            [
              { role: 'system', content: FACTS_SYSTEM_PROMPT },
              { role: 'user', content: factsUserPrompt(slices[i], i, slices.length) },
            ],
            `Reading part ${i + 1} of ${slices.length}`,
            onProgress,
            token,
          );
          // Each partial is filtered against the transcript before it can feed the merge.
          const { note } = applyGuardrails(parseSoap(out.content).note, slices[i]);
          partials.push(sectionsAsFacts(note, i));
          thoughts.push(`Part ${i + 1}:\n${out.thinking}`);
        }
        const merged = await runCompletion(
          modelId,
          [
            { role: 'system', content: MERGE_SYSTEM_PROMPT },
            { role: 'user', content: mergeUserPrompt(partials.join('\n\n')) },
          ],
          'Writing note',
          onProgress,
          token,
        );
        raw = merged.content;
        thinking = [...thoughts, `Final note:\n${merged.thinking}`].join('\n\n');
      }

      const parsed = parseSoap(raw);
      const { note, removed } = applyGuardrails(parsed.note, transcript);
      const droppedSections = parsed.droppedSections.map((d) => ({
        section: d.heading,
        text: d.content,
        reason: 'section outside the SOAP format',
      }));
      return { note, rawNote: raw, thinking, removed: [...droppedSections, ...removed] };
    },
    (pct) => onProgress({ phase: 'loading', pct }),
  );
}

export async function cancelNote(token: CancelToken): Promise<void> {
  token.cancelled = true;
  if (token.requestId) await cancel({ requestId: token.requestId }).catch(() => undefined);
}
