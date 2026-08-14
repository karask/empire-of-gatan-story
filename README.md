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

## Scene timings

`startTime` is relative to the scene's own `audioSrc`, i.e. the per-chapter file in
`assets/audio/`. Every scene now has a real timing; nothing carries `syncStatus`.
To re-sync a chapter after changing its audio or text, see
`scripts/alignment/README.md`.

If a scene ever does get `"syncStatus": "unmatched"` again, be aware that
`handleTimeUpdate` (`script.js`) returns early when the *next* scene is unmatched.
That is a hard stop, not a skip: playback parks on the preceding scene and never
advances again, for the rest of the story. Slides 144–157 carried that flag and
dead-ended chapter 2 at slide 143 until their timings were recovered.
