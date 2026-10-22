import { applyGuardrails, splitStatements } from '../src/note/guardrails';
import { NOT_DISCUSSED, type SoapNote } from '../src/note/schema';

const TRANSCRIPT = `Good morning, what brings you in today? I've had a sore throat and a fever for three days, and my kids had the same thing.
Any allergies? I'm allergic to penicillin. Let me take a look. Your temperature is 38.2 and your throat is red without exudate.
Should I take something for it? You can keep taking ibuprofen 400 milligrams if you need it for the fever.
I think this is most likely a viral upper respiratory infection. I recommend rest and fluids, and come back if it isn't better in a week.`;

function note(partial: Partial<SoapNote>): SoapNote {
  return { subjective: NOT_DISCUSSED, objective: NOT_DISCUSSED, assessment: NOT_DISCUSSED, plan: NOT_DISCUSSED, ...partial };
}

describe('applyGuardrails', () => {
  it('keeps grounded, attributed clinician statements', () => {
    const { note: out, removed } = applyGuardrails(
      note({
        subjective: '- Sore throat and fever for three days\n- Allergic to penicillin\n- Patient asked whether she should take something for it',
        objective: '- Temperature 38.2\n- Throat red without exudate',
        assessment: '- Clinician stated: likely viral upper respiratory infection',
        plan: '- Clinician stated: ibuprofen 400 mg as needed for fever\n- Clinician recommended rest and fluids\n- Clinician stated: return if not better in a week',
      }),
      TRANSCRIPT,
    );
    expect(removed).toEqual([]);
    expect(out.assessment).toContain('viral upper respiratory infection');
    expect(out.plan.split('\n')).toHaveLength(3);
  });

  it('strips model-originated recommendations', () => {
    const { note: out, removed } = applyGuardrails(
      note({ plan: '- Clinician stated: rest and fluids\n- I recommend starting amoxicillin\n- Consider a rapid strep test' }),
      TRANSCRIPT,
    );
    expect(out.plan).toBe('- Clinician stated: rest and fluids');
    expect(removed.map((r) => r.text)).toEqual(['I recommend starting amoxicillin', 'Consider a rapid strep test']);
  });

  it('strips differentials and diagnostic inferences the clinician did not voice', () => {
    const { note: out, removed } = applyGuardrails(
      note({ assessment: '- Clinician stated: likely viral upper respiratory infection\n- Differential includes streptococcal pharyngitis and mononucleosis' }),
      TRANSCRIPT,
    );
    expect(out.assessment).toBe('- Clinician stated: likely viral upper respiratory infection');
    expect(removed[0].reason).toMatch(/differential/);
  });

  it('strips neutrally phrased plan items that never happened', () => {
    const { note: out, removed } = applyGuardrails(note({ plan: '- Clinician stated: start azithromycin and order a chest X-ray' }), TRANSCRIPT);
    expect(out.plan).toBe(NOT_DISCUSSED);
    expect(removed[0].reason).toBe('not found in the visit transcript');
  });

  it('strips doses that were not spoken, but accepts spoken units in another form', () => {
    const { note: out, removed } = applyGuardrails(
      note({ plan: '- Clinician stated: ibuprofen 400 mg as needed\n- Clinician stated: ibuprofen 600 mg as needed' }),
      TRANSCRIPT,
    );
    expect(out.plan).toBe('- Clinician stated: ibuprofen 400 mg as needed');
    expect(removed[0].reason).toMatch(/600 mg/);
  });

  it('strips directives addressed to the patient in any section', () => {
    const { note: out } = applyGuardrails(note({ subjective: '- Sore throat for three days. The patient should get a flu vaccine.' }), TRANSCRIPT);
    expect(out.subjective).toBe('- Sore throat for three days.');
  });

  it('keeps "Not discussed." untouched', () => {
    const { note: out, removed } = applyGuardrails(note({}), TRANSCRIPT);
    expect(out).toEqual(note({}));
    expect(removed).toEqual([]);
  });
});

describe('real visit: headache, iPhone 13 run', () => {
  const MARIO =
    "Hi uh Mario um how are you? Hi Doc I'm not okay I have a terrible headache Uh when uh does it start Mario and um uh did you take uh some medicine or did you wait to come to the visit? Four days ago I didn't take anything I was waiting but um it was associated with vomits and I can't sleep, I can't eat. Okay Marion we will do some exams and we will understand what uh it happens. Um Okay Doc thanks.";

  it('removes paraphrases that add an exam and a discussion nobody mentioned', () => {
    const { note: out, removed } = applyGuardrails(
      note({ plan: '- Clinician stated: We will conduct a physical examination and discuss potential causes.' }),
      MARIO,
    );
    expect(out.plan).toBe(NOT_DISCUSSED);
    expect(removed).toHaveLength(1);
  });

  it('keeps the clinician quoted verbatim', () => {
    const plan = '- Clinician stated: "we will do some exams and we will understand what it happens"';
    expect(applyGuardrails(note({ plan }), MARIO).note.plan).toBe(plan);
  });

  it('collapses "nothing documented" filler to Not discussed', () => {
    const { note: out } = applyGuardrails(note({ objective: '- No physical findings documented in transcript; "Not discussed."' }), MARIO);
    expect(out.objective).toBe(NOT_DISCUSSED);
  });
});

describe('splitStatements', () => {
  it('splits bullets and sentences, keeping decimals intact', () => {
    expect(splitStatements('- Temp 38.2 today. Throat red.\nNo rash')).toEqual(['- Temp 38.2 today.', 'Throat red.', 'No rash']);
  });
});
