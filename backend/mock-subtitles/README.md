# mock-subtitles/ — deprecated, no longer used

As of Phase 5b, subtitles are no longer read from local files here.
Every subtitle — including the default English track shown as soon as
someone turns on captions — is fetched live from OpenSubtitles instead
(see `app/services/subtitle_service.py` and `app/services/
opensubtitles_service.py`). This folder and the `<name>.<lang>.srt`
naming convention it used are dead weight at this point; safe to
delete this whole directory whenever you're doing repo cleanup.
