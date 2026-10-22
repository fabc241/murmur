import { NOT_DISCUSSED, noteToPlainText, parseSoap, stripThinking } from '../src/note/schema';

describe('parseSoap', () => {
  it('parses markdown headings and ignores preamble', () => {
    const { note, droppedSections } = parseSoap(
      'Here is the note:\n## Subjective\n- Cough for 3 days\n## Objective\n- Temp 38.1\n## Assessment\n- Clinician stated: viral URI\n## Plan\n- Clinician stated: rest and fluids',
    );
    expect(note.subjective).toBe('- Cough for 3 days');
    expect(note.objective).toBe('- Temp 38.1');
    expect(note.assessment).toBe('- Clinician stated: viral URI');
    expect(note.plan).toBe('- Clinician stated: rest and fluids');
    expect(droppedSections).toEqual([]);
  });

  it('accepts bold and inline headings', () => {
    const { note } = parseSoap('**Subjective:**\n- Headache\n**Objective:** Not discussed.\nA: Not discussed.\nPlan:\n- Clinician stated: follow up in 2 weeks');
    expect(note.subjective).toBe('- Headache');
    expect(note.objective).toBe('Not discussed.');
    expect(note.assessment).toBe('Not discussed.');
    expect(note.plan).toBe('- Clinician stated: follow up in 2 weeks');
  });

  it('keeps sub-headings inside a section', () => {
    const { note } = parseSoap('## Subjective\n**History of present illness:**\n- Sore throat\n## Plan\nNot discussed.');
    expect(note.subjective).toContain('History of present illness');
    expect(note.subjective).toContain('Sore throat');
  });

  it('quarantines extra sections such as recommendations', () => {
    const { note, droppedSections } = parseSoap(
      '## Subjective\n- Fatigue\n## Plan\nNot discussed.\n## Recommendations\n- Consider thyroid panel\n## Patient education\n- Sleep hygiene',
    );
    expect(note.plan).toBe('Not discussed.');
    expect(droppedSections.map((d) => d.heading)).toEqual(['Recommendations', 'Patient education']);
  });

  it('quarantines bold advisory sub-headings within a section', () => {
    const { note, droppedSections } = parseSoap('## Plan\n- Clinician stated: recheck in 1 week\n**Suggestions:**\n- Start an SSRI');
    expect(note.plan).toBe('- Clinician stated: recheck in 1 week');
    expect(droppedSections[0].content).toBe('- Start an SSRI');
  });

  it('fills missing sections with "Not discussed."', () => {
    const { note } = parseSoap('## Subjective\n- Dizziness');
    expect(note.objective).toBe(NOT_DISCUSSED);
    expect(note.plan).toBe(NOT_DISCUSSED);
  });

  it('removes leaked reasoning', () => {
    expect(stripThinking('<think>hmm</think>\n## Plan')).toBe('## Plan');
    expect(stripThinking('## Plan\n<think>unterminated')).toBe('## Plan');
  });
});

describe('noteToPlainText', () => {
  it('serializes all four sections in order', () => {
    const text = noteToPlainText({ subjective: 'a', objective: 'b', assessment: 'c', plan: 'd' }, 'Visit');
    expect(text).toBe('Visit\n\nSUBJECTIVE\na\n\nOBJECTIVE\nb\n\nASSESSMENT\nc\n\nPLAN\nd');
  });
});
