# mock-subtitles/

Drop subtitle files here for the mock video, named:

    <anything>.<language-code>.<ext>

Examples:

    movie.en.srt
    movie.fa.vtt
    movie.es.srt

Both `.srt` and `.vtt` are supported — SRT is converted to WebVTT in
the browser before playback. The language code (`en`, `fa`, `es`, ...)
is used to label the track in the subtitle menu; unrecognized codes
just show their raw code as the label.

This folder is gitignored (except this README and .gitkeep) — your
test files never get committed.
