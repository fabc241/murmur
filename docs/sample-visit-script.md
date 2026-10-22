# Role-play script for on-device testing

Read this aloud with a colleague (about 3 minutes). It covers the cases the note pipeline must handle:

- a stated impression and plan the note must keep;
- a patient question the clinician answers;
- a patient question the clinician leaves open, where the note must not supply an answer;
- an allergy and a dose.

---

**Clinician:** Good morning. What brings you in today?

**Patient:** I've had a sore throat and a fever for about three days. My kids had the same thing last week.

**Clinician:** Any cough, trouble swallowing, or ear pain?

**Patient:** A dry cough, mostly at night. Swallowing hurts a bit but I can eat.

**Clinician:** Do you take any medications regularly, and do you have any allergies?

**Patient:** Just a multivitamin. I'm allergic to penicillin; I got a rash once.

**Clinician:** Thanks. Let me examine you. Your temperature is 38.2. The throat is red, with no exudate. No swollen lymph nodes in the neck. Lungs are clear.

**Patient:** Should I take antibiotics?

**Clinician:** I don't think you need them. I think this is most likely a viral upper respiratory infection, like what your kids had.

**Patient:** What should I take for the fever?

**Clinician:** You can take ibuprofen 400 milligrams up to three times a day with food, if you need it.

**Patient:** And can I go back to work tomorrow?

**Clinician:** Let's see how you feel. Rest and drink plenty of fluids. Come back if you're not better in a week, or sooner if you have trouble breathing.

---

## What the note should contain

| Section | Expected |
| --- | --- |
| Subjective | Sore throat and fever for 3 days, sick contacts, dry nocturnal cough, mild odynophagia, multivitamin, **penicillin allergy (rash)**, patient's questions |
| Objective | Temp 38.2, erythematous pharynx without exudate, no cervical lymphadenopathy, lungs clear |
| Assessment | `Clinician stated:` likely viral upper respiratory infection; antibiotics not needed |
| Plan | `Clinician stated:` ibuprofen 400 mg up to TID with food PRN; rest and fluids; return in 1 week if not improved, sooner if breathing difficulty |

## What the note must not contain

- Strep testing, a differential diagnosis (strep, mono), or a different drug, dose or duration.
- An answer to the return-to-work question. The clinician didn't give one, so it may be recorded only as an open question.

Anything like this should either be absent or listed under "Murmur removed N statements".
