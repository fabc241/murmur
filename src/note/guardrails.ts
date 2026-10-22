// Deterministic post-generation filter. The prompt asks the model to document
// only; this module enforces it by removing advisory statements that are not
// grounded in what the clinician actually said during the visit.

import { NOT_DISCUSSED, SOAP_SECTIONS, type SoapNote } from './schema';

export type RemovedStatement = { section: string; text: string; reason: string };
export type GuardrailResult = { note: SoapNote; removed: RemovedStatement[] };

const ADVICE_PATTERNS: [RegExp, string][] = [
  [/\b(i|we)\s+(would\s+)?(recommend|suggest|advise|propose)\b/i, 'recommendation'],
  [/\brecommend(s|ed|ing|ation|ations)?\b/i, 'recommendation'],
  [/\bsuggest(s|ed|ing|ion|ions)?\b/i, 'suggestion'],
  [/\badvis(e|es|ed|ing|able)\b/i, 'advice'],
  [/\bconsider(s|ed|ing|ation)?\b/i, 'suggestion'],
  [/\b(may|might|could|would)\s+(benefit|be\s+(beneficial|helpful|appropriate|indicated|warranted|reasonable))\b/i, 'suggestion'],
  [/\b(is|are|be)\s+(indicated|warranted|advisable|appropriate)\b/i, 'suggestion'],
  [/\b(should|must|needs?\s+to|ought\s+to)\b/i, 'directive'],
  [/\b(differential|ddx)\b/i, 'differential diagnosis'],
  [/\b(likely|probable|probably|possible|possibly|suspected|suspicious\s+for|consistent\s+with|suggestive\s+of|compatible\s+with|rule\s+out|r\/o)\b/i, 'diagnostic inference'],
  [/\b(first[-\s]line|treatment\s+of\s+choice|standard\s+of\s+care|evidence\s+suggests|guidelines?)\b/i, 'treatment guidance'],
  [/\b(titrat\w*|taper\w*|uptitrat\w*|increase\s+the\s+dose|decrease\s+the\s+dose)\b/i, 'dosing guidance'],
];

// Drug doses ("500 mg", "0.5 mcg", "10 units") must appear in the transcript verbatim.
const DOSE_RE = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|ug|g|ml|mL|l|units?|iu|IU|mEq|mmol|puffs?|tabs?|tablets?|capsules?|drops?)\b/g;

// Explicit attribution to the clinician, e.g. "Clinician stated: ...", "Doctor advised ...".
const ATTRIBUTION_RE =
  /\b(clinician|doctor|physician|provider|dr\.?)\s+(stated|states|said|says|noted|notes|explained|explains|mentioned|mentions|advised|advises|recommended|recommends|planned|plans|prescribed|prescribes|ordered|orders|discussed|discusses|indicated|indicates|reported|reports|described|describes|instructed|instructs|suggested|suggests)\b/i;

const STOPWORDS = new Set(
  (
    'the a an and or but of to in on at for with without from by as is are was were be been being it its this that these those ' +
    'there their they them he she his her him you your we our i me my not no yes do does did has have had will would can could ' +
    'should may might must also very about into over under than then so if when while per each any some more most other such ' +
    // Meta words a scribe adds that would never appear in the conversation itself.
    'patient patients clinician doctor physician provider stated states said says noted notes reported reports denies denied ' +
    'whether what which how why who when where asks asked explained mentioned discussed described indicated advised recommended planned ordered instructed visit today'
  ).split(' '),
);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stem(word: string): string {
  return word.replace(/(ing|ed|es|s)$/, '');
}

function contentWords(text: string): string[] {
  return normalize(text)
    .split(' ')
    .map((w) => w.replace(/\.$/, ''))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
    .map(stem);
}

/** Fraction of the statement's content words that occur in the transcript. */
export function groundingScore(statement: string, transcriptWords: Set<string>): number {
  const words = contentWords(statement);
  if (words.length === 0) return 1;
  const hits = words.filter((w) => transcriptWords.has(w)).length;
  return hits / words.length;
}

/** Sentence split on terminal punctuation followed by whitespace, so "38.2" or "q.d." stay intact. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('.!?'.includes(text[i]) && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      out.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Splits a section into statements: one per bullet line, and sentences within prose lines. */
export function splitStatements(section: string): string[] {
  const out: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const bullet = line.match(/^(\s*(?:[-*•]|\d+[.)])\s+)/)?.[1] ?? '';
    const body = line.slice(bullet.length);
    splitSentences(body).forEach((s, i) => {
      const t = s.trim();
      if (t) out.push(i === 0 ? bullet + t : t);
    });
  }
  return out;
}

const UNIT_ALIASES: [RegExp, string][] = [
  [/\b(milligrams?|mgs?)\b/g, 'mg'],
  [/\b(micrograms?|mcgs?|µg|ug)\b/g, 'mcg'],
  [/\b(milliliters?|millilitres?|mls?|cc)\b/g, 'ml'],
  [/\b(grams?|gr)\b/g, 'g'],
  [/\b(liters?|litres?)\b/g, 'l'],
  [/\b(international units?|ius?|units?)\b/g, 'unit'],
  [/\b(tablets?|tabs?|pills?)\b/g, 'tab'],
  [/\b(capsules?|caps?)\b/g, 'cap'],
  [/\b(puffs?)\b/g, 'puff'],
  [/\b(drops?)\b/g, 'drop'],
];

/** Canonical dose form: "500 milligrams" and "500mg" both become "500mg". */
function canonicalDoses(text: string): string {
  let t = text.toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  for (const [re, unit] of UNIT_ALIASES) t = t.replace(re, unit);
  return t.replace(/(\d)\s+(?=[a-z])/g, '$1');
}

function dosesMissingFromTranscript(statement: string, canonicalTranscript: string): string[] {
  const doses = statement.match(DOSE_RE) ?? [];
  return doses.filter((d) => !canonicalTranscript.includes(canonicalDoses(d)));
}

export function checkStatement(
  statement: string,
  ctx: { transcriptWords: Set<string>; canonicalTranscript: string },
  strict = false,
): string | null {
  if (/^\s*([-*•]\s*)?not discussed\.?\s*$/i.test(statement)) return null;
  const grounding = groundingScore(statement, ctx.transcriptWords);
  const attributed = ATTRIBUTION_RE.test(statement) || /^\s*([-*•]\s*)?clinician\s*:/i.test(statement);

  const missingDoses = dosesMissingFromTranscript(statement, ctx.canonicalTranscript);
  if (missingDoses.length) return `dose not stated in visit (${missingDoses.join(', ')})`;

  const advice = ADVICE_PATTERNS.find(([re]) => re.test(statement));
  if (advice) {
    // Advisory wording is only acceptable when it records what was said in the room:
    // either explicitly attributed to the clinician and grounded, or near-verbatim from the transcript.
    if ((attributed && grounding >= 0.6) || grounding >= 0.85) return null;
    return `${advice[1]} not attributable to the clinician`;
  }

  // Assessment and Plan carry the clinical decisions: every item there must be traceable to the
  // transcript, even when phrased neutrally ("Clinician stated: start amoxicillin").
  const isLabel = /:\s*$/.test(statement);
  if (strict && !isLabel && grounding < 0.5) return 'not found in the visit transcript';
  return null;
}

const NOTHING_RE =
  /^(?:no|none|nothing)\b[^.]*\b(?:documented|mentioned|discussed|provided|reported|stated|recorded|noted|given|available|performed)\b/i;

/** Statements that only say a section is empty, in whatever words the model chose. */
export function isNothingStatement(statement: string): boolean {
  const body = statement.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/["“”]/g, '').trim();
  return /\bnot discussed\b/i.test(body) || NOTHING_RE.test(body);
}

const STRICT_SECTIONS = new Set<string>(['assessment', 'plan']);

export function applyGuardrails(note: SoapNote, transcript: string): GuardrailResult {
  const canonicalTranscript = canonicalDoses(transcript);
  const transcriptWords = new Set(contentWords(transcript));
  const ctx = { transcriptWords, canonicalTranscript };
  const removed: RemovedStatement[] = [];
  const result = { ...note };

  for (const section of SOAP_SECTIONS) {
    const kept: string[] = [];
    for (const line of note[section].split(/\r?\n/)) {
      const statements = splitStatements(line);
      if (statements.length === 0) {
        kept.push(line);
        continue;
      }
      const ok = statements.filter((s) => {
        const reason = checkStatement(s, ctx, STRICT_SECTIONS.has(section));
        if (reason) removed.push({ section, text: s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), reason });
        return !reason;
      });
      if (ok.length) kept.push(ok.join(' '));
    }
    const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // "No physical findings documented in transcript; "Not discussed."" is just an empty section.
    if (text && splitStatements(text).every(isNothingStatement)) {
      result[section] = NOT_DISCUSSED;
      continue;
    }
    // A bullet list whose items were all removed leaves a dangling label like "Medications:".
    result[section] = text && !/^[^\n]*:\s*$/.test(text) ? text : NOT_DISCUSSED;
  }
  return { note: result, removed };
}
