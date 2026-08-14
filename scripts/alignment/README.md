# Scene Alignment Workflow

This workflow replaces manual scene timestamping with a local transcript alignment pass.

## Align against the chapter audio, not the monolith

`startTime` in `data.js` is **relative to the scene's own `audioSrc`** — the per-chapter
file in `assets/audio/`, which is what the site plays. `TheChroniclesOfGatan-Audio.mp3`
is a single 2850s file on a different timeline and is kept only as the source these
chapters were cut from. Transcribe the chapter you are fixing:

```bash
venv/bin/whisperx assets/audio/chapter-2.m4a \
  --model medium \
  --language en \
  --device cpu \
  --compute_type float32 \
  --output_format json \
  --output_dir .alignment
```

`--device cpu --compute_type float32` is required unless CUDA is available; it takes
roughly 13 minutes for a 14-minute chapter. The `medium` and wav2vec2 models are
already cached, so this runs offline.

## Scope the aligner to one chapter

`align-scenes.js` walks scenes and transcript words with a single forward cursor
(500-word lookahead). Handing it all 281 scenes against one chapter's transcript
fails everything after the first mismatch, so extract the chapter first:

```bash
node -e '
global.window={};require("./data.js");
const s=window.storyScenes.filter(x=>x.audioSrc==="assets/audio/chapter-2.m4a");
require("fs").writeFileSync(".alignment/data-chapter-2.js",
  "window.storyChapters = "+JSON.stringify(window.storyChapters,null,2)+";\n"+
  "window.storyScenes = "+JSON.stringify(s,null,2)+";\n");'
```

Then report against it:

```bash
node scripts/alignment/align-scenes.js \
  --data .alignment/data-chapter-2.js \
  --audio assets/audio/chapter-2.m4a \
  --transcript .alignment/chapter-2.json \
  --out .alignment/ch2
```

This writes `.alignment/ch2/alignment-report.md` and `.alignment/ch2/timings.json`.
Review failures and warnings before applying anything. Any scene proposed past the
audio's duration is invalid.

## Applying timings

**`--apply` and `--apply-valid` do not work against the current `data.js`.** Two
reasons, both worth knowing before you reach for them:

- `applyTimings` matches unquoted `startTime:`, but `data.js` is JSON-quoted
  (`"startTime":`), so it finds zero fields and aborts.
- It rewrites **every** `startTime` positionally across all 281 scenes, which is
  wrong when the transcript only covers one chapter.

Read `timings.json` and write the values you approved into `data.js` yourself. Keep
existing hand-verified timings unless the report gives you a reason to change them.

## Verifying a repair

Cross-check against a second source before trusting a recovered timing. The chapter
`.m4a` files are clean cuts of the monolith at a constant offset (chapter 2 is
`+1351.71s`), so aligning the same scenes against `.alignment/TheChroniclesOfGatan-Audio.json`
— sliced to the relevant window, since the cursor starts at word 0 — gives an
independent answer. The two agreed to within 0.04s when slides 144–157 were recovered.

Also confirm `startTime` is strictly increasing within each `audioSrc`, and that a
scene's proposed time leaves a sensible gap for the narration of the scene before it.

## Known matcher limitation

The prefix matcher tokenises the scene text, so it fails where the narration differs
in wording from the written text — slide 144 reads "Ilmar the First" and "Teir" while
the narrator says "Ilmar I" and "Tyr", giving 0.33 confidence in both transcripts.
For those, find the scene's opening word directly in the transcript and read its
`start` value.

## Checks

```bash
node scripts/alignment/test_alignment.js
```
