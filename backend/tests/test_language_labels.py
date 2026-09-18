"""Tests for language_labels.label_for — the bug this guards against:
a small hand-typed dict meant codes like "id" (Indonesian) or "el"
(Greek) fell through to a raw uppercased code instead of a real name."""
from app.core.language_labels import label_for


def test_common_language_previously_covered_by_the_hand_typed_dict():
    assert label_for("en") == "English"
    assert label_for("fa") == "Persian"


def test_languages_the_old_hand_typed_dict_did_not_cover():
    assert label_for("id") == "Indonesian"
    assert label_for("el") == "Greek"
    assert label_for("vi") == "Vietnamese"
    assert label_for("th") == "Thai"


def test_macrolanguage_qualifier_is_stripped():
    """pycountry's raw ISO 639-3 names some languages after their
    macrolanguage grouping (e.g. "Malay (macrolanguage)") — technically
    correct, not what anyone expects to see in a subtitle language list."""
    assert label_for("ms") == "Malay"
    assert label_for("sw") == "Swahili"
    assert label_for("ne") == "Nepali"


def test_case_insensitive():
    assert label_for("EN") == "English"


def test_opensubtitles_composite_codes_use_overrides():
    assert label_for("pt-br") == "Portuguese (Brazil)"
    assert label_for("pt-BR") == "Portuguese (Brazil)"
    assert label_for("zh-cn") == "Chinese (Simplified)"


def test_hebrew_both_old_and_new_iso_codes():
    assert label_for("he") == "Hebrew"
    assert label_for("iw") == "Hebrew"


def test_unrecognized_code_falls_back_to_uppercased_raw_code():
    assert label_for("xx-totally-made-up") == "XX-TOTALLY-MADE-UP"
