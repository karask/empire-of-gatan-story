# The Empire of Gatan — The Burnt One Returns

A static, audio-synced story site: each scene shows an image and its text while the
chapter narration plays, advancing automatically on the audio timeline.

## Running it

Any static server works. From the repo root:

```bash
npx serve
```

Then open the printed URL. `npx live-server` also works if you want auto-reload.
Opening `index.html` directly with `file://` will not work — the audio and image
requests need to be served over HTTP.

## Layout

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `script.js` | The player. `script.js` holds the `StoryComic` class: scene transitions, audio seeking, chapter nav. |
| `data.js` | **Single source of truth** for the story — `window.storyChapters` and `window.storyScenes` (281 scenes). Everything else reads from it. |
| `assets/images/` | Every scene image. One directory, no exceptions. |
| `assets/audio/` | Per-chapter narration (`introduction.m4a`, `chapter-1.m4a`, …), which is what the site plays. |
| `TheChroniclesOfGatan-Audio.mp3` | The original single-file narration. Kept for the alignment tooling only; the site does not use it. |
| `TheChroniclesOfGatan.pdf`, `-Story.md`, `-Timeline.txt` | Source campaign material. |
| `.agent/` | The `cast-manager` skill and character reference art used when generating new scene images. |
| `scripts/alignment/` | WhisperX-based tooling that writes `startTime` values into `data.js`. See `scripts/alignment/README.md`. |
| `scripts/find_unused_images.js` | Reports images in `assets/images` that no scene references. Read-only. |

## Adding a scene

Add an entry to `window.storyScenes` in `data.js` with `slideNumber`, `audioSrc`,
`startTime`, `image`, `text` and `chapterId`. Image paths are always
`assets/images/…`. `panAnimation` is optional (`top-to-bottom`, `bottom-to-top`,
`left-to-right`, `right-to-left`).

A chapter only becomes playable once its id is in `availableChapterIds`
(`script.js`). Scenes in a chapter that is not listed there render the
"To be continued" end card instead — that is how unfinished chapters are staged.

## Known gap

Slides **144–157** carry `"syncStatus": "unmatched"`: the narration for that stretch
was never matched to a timestamp. The player deliberately skips seeking and
auto-advance for those scenes, so they only move on manual navigation. Re-running
the alignment pass over a chapter-2 audio file that covers them would clear it.
