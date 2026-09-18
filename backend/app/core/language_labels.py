"""
Language code -> human label lookup, used to build subtitle track menu
labels (e.g. "en" -> "English").

Originally a ~19-entry hand-typed dict, which was fine while the only
source of subtitles was a handful of mock files. OpenSubtitles returns
the full ISO 639-1 set (~180 languages) plus a handful of its own
non-standard composite codes for regional variants ISO 639 can't
express (see https://github.com/clsid2/mpc-hc/issues/2498) — a
hand-typed table was never going to keep up, which is why codes like
"id" (Indonesian) or "el" (Greek) were showing up as raw uppercased
codes instead of names. pycountry's bundled ISO 639 data covers the
standard codes properly; only OpenSubtitles' own composite codes need
a small override table on top of it.
"""
import pycountry

# OpenSubtitles-specific composite codes that aren't in ISO 639 at all
# (region info tacked onto a base language code), plus a couple of
# legacy/ambiguous codes worth pinning down explicitly rather than
# leaving to pycountry's exact-match lookup to miss.
_OVERRIDES: dict[str, str] = {
    "pt-br": "Portuguese (Brazil)",
    "pt-pt": "Portuguese (Portugal)",
    "zh-cn": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
    "ze": "Chinese/English (bilingual)",
    "ze-en": "Chinese/English (bilingual) — English",
    "ze-zh": "Chinese/English (bilingual) — Chinese",
    "he": "Hebrew",
    "iw": "Hebrew",  # older ISO 639-1 code for Hebrew, still seen in the wild
    "el": "Greek",  # pycountry's formal ISO 639-3 name is "Modern Greek (1453-)"
    "und": "Unknown",
}


def label_for(language_code: str) -> str:
    """Falls back to the raw (uppercased) code if pycountry doesn't
    recognize it either — better an unfamiliar code shown as-is than a
    silently wrong name."""
    code = language_code.lower()
    if code in _OVERRIDES:
        return _OVERRIDES[code]

    # pycountry's languages table is keyed by alpha_2 (2-letter) for
    # most languages, alpha_3 for others that never got a 2-letter code.
    lang = pycountry.languages.get(alpha_2=code) or pycountry.languages.get(alpha_3=code)
    if lang:
        # ISO 639-3 tags some languages as their macrolanguage's formal
        # name (e.g. "Malay (macrolanguage)", "Nepali (macrolanguage)")
        # — technically correct, but nobody picking a subtitle language
        # thinks of it that way.
        return lang.name.removesuffix(" (macrolanguage)")

    return language_code.upper()
