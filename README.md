<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/header-dark.svg">
    <img src="docs/media/header-light.svg" alt="Murmur: on-device clinical visit scribe" width="460">
  </picture>
</h1>

Murmur is an iPhone app for doctors. It records a clinical visit, transcribes it and drafts a structured SOAP note, all **on the device**, with the [QVAC SDK](https://github.com/tetherto/qvac) (`@qvac/sdk` 0.22).

The draft **only documents what was said** in the visit. Murmur doesn't diagnose and doesn't recommend tests or treatment. Advice the model adds anyway is removed before the clinician sees the note (see [Safety design](#safety-design)).

## Demo

<p align="center">
  <img src="docs/media/demo.gif" alt="Four panels: the clinician confirms recording consent, records a short visit, the device transcribes it and writes the note, then the SOAP note is reviewed and copied." width="640">
</p>

A 39-second walkthrough with a fictional patient: consent, recording, on-device processing, and review of the SOAP note. Everything runs offline on the device.

## How it works

| Step | Technology |
| --- | --- |
| Record | `expo-audio`, iOS **Linear PCM** at 16 kHz mono 16-bit, in a `.wav` container. This is Parakeet's native input, so no transcoding is needed. Recording continues with the screen locked. |
| Transcribe | `transcribe()` with `PARAKEET_TDT_0_6B_V3_Q8_0`, `modelType: "parakeet-transcription"`. The audio is split into chunks of at most 60 s, cut at the quietest point so words aren't split. Progress is saved after each chunk, so an interrupted run resumes. |
| Write note | `completion()` with `HEALTHCARE_1_7B_MEDICAL_Q4_K_M` (MedPsy-1.7B GGUF Q4_K_M), `modelType: "llm"`, `stream: true`, `captureThinking: true`. The model's reasoning streams into a collapsible "Model reasoning" panel and is never exported. Long visits use a two-pass flow: facts are extracted per slice, then merged into one note. |
| Review | The clinician edits the note or transcript, writes a new note after correcting the transcript, then copies or shares plain text. |

Only one model is in memory at a time: Parakeet is unloaded before MedPsy loads. Everything is stored in the app's Documents folder (`visits/<id>/audio.wav` and `visit.json`). Model files live in `Documents/.qvac/models`.

## Requirements

- macOS with Xcode and CocoaPods.
- A **physical iPhone** running iOS 17 or later. QVAC's llama.cpp engine doesn't run in the Simulator, and Expo Go is not supported.
- About 3.5 GB free on the iPhone for the models: Parakeet is about 750 MB plus its Core ML encoder, and MedPsy is about 1.28 GB.

## Run it

```bash
npm install
npx expo prebuild --platform ios   # links QVAC's native addons; re-run after every npm install
npx expo run:ios --device          # pick your iPhone; set your signing team when Xcode asks
```

`run:ios --device` makes a **Debug** build. It loads JavaScript from the Metro server on your Mac, so it only works when the iPhone is on the same Wi-Fi network. To use Murmur anywhere, including offline, install a **Release** build. It contains the JavaScript bundle and doesn't need the Mac:

```bash
npm run ios:release                # Release build + install on the connected iPhone (scripts/ios-release.sh)
```

On first launch, Murmur downloads both models with a progress screen. Use Wi-Fi for this. After that, the app works offline.

> **Paths with spaces.** Two Expo SDK 54 build scripts break when the project path contains a space (this project lives in `…/claude code/…`). Both are fixed in the repo:
>
> - [patches/](patches/) quotes `expo-constants`' script. `patch-package` applies it on every `npm install`.
> - [plugins/with-space-safe-bundle-phase.js](plugins/with-space-safe-bundle-phase.js) quotes the "Bundle React Native code" build phase at prebuild time.

## Safety design

The note must never contain diagnostic or therapeutic advice. This is enforced in three layers:

1. **Prompt** ([src/qvac/prompts.ts](src/qvac/prompts.ts)). The model acts as a scribe, not a clinician.
   - It uses only what was said.
   - Assessment and Plan items must be attributed as `Clinician stated:`.
   - Unanswered patient questions are recorded as questions, without answers.
   - Empty sections read "Not discussed."
2. **Structure** ([src/note/schema.ts](src/note/schema.ts)). Only Subjective, Objective, Assessment and Plan are kept. Extra sections such as "Recommendations", "Differential" or "Patient education" are quarantined.
3. **Deterministic guardrails** ([src/note/guardrails.ts](src/note/guardrails.ts)). Every statement is checked against the transcript.
   - **Advisory language** ("recommend", "consider", "should", "likely", differentials) is removed unless it is attributed to the clinician *and* grounded in the transcript.
   - **Assessment and Plan items** that can't be traced to the transcript are removed, even when phrased neutrally.
   - **Drug doses** that weren't spoken are removed. Unit spelling is normalized, so "400 milligrams" matches "400 mg".

   Removed statements are listed with a reason, so the clinician can check them.

The guardrails are conservative and can remove a true statement that was paraphrased too freely. The note is always a draft for the clinician to review, and every screen says so.

## Project layout

```
src/app/            expo-router screens: index (visits), setup, record, visit/[id]
src/audio/          Linear PCM recording preset; WAV parse/split/encode (pure)
src/qvac/           model lifecycle, transcription, note generation, prompts, suspend/resume
src/note/           SOAP parsing and guardrails (pure)
src/storage/        on-device visit persistence
src/pipeline.ts     record → transcript → note orchestration with live progress
__tests__/          Jest tests for WAV, SOAP parsing and guardrails
docs/               role-play script for on-device testing; media/ holds the logo and demo GIF
```

## Checks

```bash
npm run typecheck
npm test
npx expo lint
```

For an end-to-end check on a device, follow [docs/sample-visit-script.md](docs/sample-visit-script.md).

## Known limitations

- **No speaker labels.** Parakeet doesn't separate speakers, so the model tells clinician and patient apart from context.
- **Keep Murmur open while processing.** Transcription and note writing run in the foreground; iOS pauses them in the background.
- **English UI and notes.** Parakeet v3 transcribes 25 European languages, and the note is written in English.
- **Data protection.** For production, add Face ID app lock and the `NSFileProtectionComplete` data-protection entitlement, and exclude visit data from iCloud backup.

## License

[MIT](LICENSE) © 2026 [fabc241](https://github.com/fabc241)
