# mock-videos/

Drop one test video file here (`.mp4`, `.webm`, `.mkv`, or `.mov`) —
any filename. The mock playback provider picks up whichever video file
it finds first, so this folder should contain exactly one.

This folder is gitignored (except this README) — your test file never
gets committed.

## If seeking/duration/metadata acts weird: re-encode with faststart

An MP4 whose `moov` atom (its metadata/seek table) sits at the *end* of
the file instead of the front will misbehave in the browser — seeking is
unreliable, and `duration`/`loadedmetadata` can be wrong. This bit us once
during Phase 5a: see the project handoff, "five real bugs" section.

Fix it with:

```
ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4
```

This just moves the moov atom — no re-encoding, so it's fast and lossless.
Drop `out.mp4` in here in place of `in.mp4`.

**Note for later (Candy Server / any self-hosted real playback source):**
whatever pipeline eventually serves real video files should run this
faststart pass (or the equivalent) on ingest, so this class of bug can't
resurface once we're past mock playback.
