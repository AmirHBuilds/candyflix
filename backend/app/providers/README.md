# providers/

Playback source providers. Currently just one:

- `mock_provider.py` — scans `mock-videos/` (see its README) for a
  single local test video file and returns its URL. No abstraction
  layer (no `PlaybackSource` ABC, no `ProviderRegistry`) was actually
  built — that was the original plan sketched out early on, but with
  only one provider ever implemented, the abstraction had no second
  caller to justify it, so it was never built. Subtitles do NOT come
  from here — see `app/services/subtitle_service.py` and
  `opensubtitles_service.py` (Phase 5b onward).

No real third-party *playback* providers will ever be implemented per
product decision — only mock/local playback, by design, indefinitely.
(This restriction is specific to playback. OpenSubtitles, a real
third-party integration, is fine and already built — it's a metadata/
subtitle lookup, not a source of the video stream itself.)

If/when this actually needs more than one provider (e.g. the planned
"Candy Server" self-hosted pipeline, still unbuilt), introduce the
abstraction layer *then*, shaped by what the second real provider
actually needs — not speculatively ahead of time.
