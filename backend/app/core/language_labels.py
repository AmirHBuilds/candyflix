"""
Shared ISO-639-1-ish language code -> human label lookup, used to build
subtitle track menu labels. Originally lived only in the mock provider;
pulled out here once the OpenSubtitles service (Phase 5b) needed the
same mapping, so both stay in sync from one place.
"""

LANGUAGE_LABELS: dict[str, str] = {
    "en": "English",
    "fa": "Persian",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ar": "Arabic",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese",
    "pt": "Portuguese",
    "pt-br": "Portuguese (Brazil)",
    "it": "Italian",
    "ru": "Russian",
    "tr": "Turkish",
    "hi": "Hindi",
    "nl": "Dutch",
    "pl": "Polish",
    "sv": "Swedish",
    "und": "Unknown",
}


def label_for(language_code: str) -> str:
    """Falls back to the raw (uppercased) code for anything not in the
    map — OpenSubtitles in particular returns a long tail of codes this
    table will never fully cover."""
    return LANGUAGE_LABELS.get(language_code.lower(), language_code.upper())
