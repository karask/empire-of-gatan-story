# Scene Alignment Workflow

This workflow replaces manual scene timestamping with a local transcript alignment pass.

## 1. Generate a local WhisperX transcript

Install WhisperX in a Python environment, then run it from the repo root:

```bash
whisperx TheChroniclesOfGatan-Audio.mp3 \
  --model medium \
  --language en \
  --output_format json \
  --output_dir .alignment
```

The script expects a JSON file with word timestamps, usually:

```bash
.alignment/TheChroniclesOfGatan-Audio.json
```

## 2. Generate the review report

```bash
node scripts/alignment/align-scenes.js \
  --transcript .alignment/TheChroniclesOfGatan-Audio.json
```

To keep manually verified timings untouched, add:

```bash
node scripts/alignment/align-scenes.js \
  --transcript .alignment/TheChroniclesOfGatan-Audio.json \
  --preserve-through 50
```

This writes:

- `.alignment/alignment-report.md`
- `.alignment/timings.json`

Review failures and warnings before applying. The current MP3 is about `2850s`, so any scene proposed after that duration is invalid.

## 3. Apply approved timings

```bash
node scripts/alignment/align-scenes.js \
  --transcript .alignment/TheChroniclesOfGatan-Audio.json \
  --apply
```

Apply mode rewrites only `startTime` values in `data.js`. It refuses to run if any alignment failure is present.

If the report has known failures for scenes that are absent from the audio, update only the valid prefix before the first failure and keep the rest unchanged:

```bash
node scripts/alignment/align-scenes.js \
  --transcript .alignment/TheChroniclesOfGatan-Audio.json \
  --preserve-through 50 \
  --apply-valid
```

## Checks

```bash
node scripts/alignment/test_alignment.js
```
