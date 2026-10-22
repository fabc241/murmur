// SOAP note model: parsing model output into sections and serializing for export.

export const SOAP_SECTIONS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export type SoapSection = (typeof SOAP_SECTIONS)[number];
export type SoapNote = Record<SoapSection, string>;

export const SECTION_TITLES: Record<SoapSection, string> = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
};

export const NOT_DISCUSSED = 'Not discussed.';

export type ParsedNote = {
  note: SoapNote;
  /** Headings the model produced that are not part of SOAP (e.g. "Recommendations"); their content is discarded. */
  droppedSections: { heading: string; content: string }[];
};

// Matches "## Subjective", "**Subjective:**", "Subjective:", "S:" and similar heading lines.
const HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*([A-Za-z][A-Za-z /&-]{0,40}?)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/;
const ADVISORY_HEADING_RE = /recommend|suggest|differential|advice|consideration|next steps|treatment options|management options/i;
const INLINE_HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?(Subjective|Objective|Assessment|Plan|S|O|A|P)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*([^*_\s].*)$/i;

function sectionFor(heading: string): SoapSection | null {
  const h = heading.trim().toLowerCase();
  switch (h) {
    case 's':
    case 'subjective':
      return 'subjective';
    case 'o':
    case 'objective':
      return 'objective';
    case 'a':
    case 'assessment':
      return 'assessment';
    case 'p':
    case 'plan':
      return 'plan';
    default:
      return null;
  }
}

/** Removes any reasoning that leaked into the answer (unclosed or stray think tags). */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .replace(/<\/?think>/gi, '')
    .trim();
}

export function emptyNote(): SoapNote {
  return { subjective: NOT_DISCUSSED, objective: NOT_DISCUSSED, assessment: NOT_DISCUSSED, plan: NOT_DISCUSSED };
}

export function parseSoap(raw: string): ParsedNote {
  const lines = stripThinking(raw).split(/\r?\n/);
  const buckets: Partial<Record<SoapSection, string[]>> = {};
  const droppedSections: ParsedNote['droppedSections'] = [];
  let current: { section: SoapSection | null; heading: string; lines: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join('\n').trim();
    if (current.section) {
      (buckets[current.section] ??= []).push(content);
    } else if (content) {
      droppedSections.push({ heading: current.heading, content });
    }
  };

  let soapLevel = 2;
  for (const line of lines) {
    const inline = line.match(INLINE_HEADING_RE);
    const heading = !inline && /^\s*(#|\*\*|__|[A-Za-z][A-Za-z /&-]*:\s*$)/.test(line) ? line.match(HEADING_RE) : null;
    const hashes = line.match(/^\s*(#{1,6})\s/)?.[1].length ?? 0;
    if (inline) {
      flush();
      current = { section: sectionFor(inline[1]), heading: inline[1], lines: [inline[2]] };
    } else if (heading && sectionFor(heading[1])) {
      if (hashes) soapLevel = hashes;
      flush();
      current = { section: sectionFor(heading[1]), heading: heading[1].trim(), lines: [] };
    } else if (heading && (ADVISORY_HEADING_RE.test(heading[1]) || (hashes > 0 && hashes <= soapLevel))) {
      // A sibling section outside SOAP (or an advisory one at any level): quarantine its content.
      flush();
      current = { section: null, heading: heading[1].trim(), lines: [] };
    } else if (current) {
      // Sub-headings such as "**History of present illness:**" stay inside the current section.
      current.lines.push(line);
    }
    // Text before the first heading is preamble ("Here is the note:") and is ignored.
  }
  flush();

  const note = emptyNote();
  for (const section of SOAP_SECTIONS) {
    const content = (buckets[section] ?? []).filter(Boolean).join('\n').trim();
    if (content) note[section] = content;
  }
  return { note, droppedSections };
}

export function isNoteEmpty(note: SoapNote): boolean {
  return SOAP_SECTIONS.every((s) => note[s].trim() === NOT_DISCUSSED || note[s].trim() === '');
}

export function noteToPlainText(note: SoapNote, header?: string): string {
  const body = SOAP_SECTIONS.map((s) => `${SECTION_TITLES[s].toUpperCase()}\n${note[s].trim()}`).join('\n\n');
  return header ? `${header}\n\n${body}` : body;
}
