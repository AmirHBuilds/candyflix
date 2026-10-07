"""
The shape, defaults and validation rules of a person's settings.

`UserSettings` here is the *complete, resolved* document the app uses.
What is stored per user is only the sparse set of overrides (see
models/user_settings.py); `settings_service.resolve` merges them over
these defaults and validates the result, so an invalid value can never
be saved and an old/odd stored value can never crash a page.

Several groups are defined before the feature that reads them ships
(playback, subtitles, ...). That is intentional: the storage/API layer
is one stable foundation, and each later phase just starts consuming
fields that already exist.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Theme = Literal["candy-at-night", "midnight", "mint", "lilac", "sunset", "mono"]


class _Group(BaseModel):
    # Unknown keys are dropped on read (e.g. a setting removed in a later
    # version) rather than failing the whole document.
    model_config = ConfigDict(extra="ignore")


class AppearanceSettings(_Group):
    theme: Theme = "candy-at-night"
    # "grid" = the classic wrapped grid; "rows" = one swipeable row per section.
    home_layout: Literal["grid", "rows"] = "grid"
    # How many titles each home section shows (today: 24).
    items_per_section: int = Field(default=24, ge=6, le=48)
    # "list" = rows with thumbnails (today); "blocks" = compact number+name blocks.
    episode_view: Literal["list", "blocks"] = "list"
    # "standard" is exactly what the detail pages show today.
    description_length: Literal["short", "standard", "full"] = "standard"
    text_size: Literal["small", "default", "large"] = "default"
    reduce_motion: Literal["auto", "on", "off"] = "auto"
    hero_enabled: bool = True
    # Show the title's description under the banner heading.
    hero_description: bool = True
    hero_interval_seconds: int = Field(default=7, ge=3, le=30)  # today: 7 s
    show_ratings: bool = True
    show_years: bool = True
    # Detail pages: which rating sources to show.


class SkipButtons(_Group):
    intro: bool = True
    recap: bool = True
    credits: bool = True


class AutoSubtitles(_Group):
    enabled: bool = False
    language: str = Field(default="en", min_length=2, max_length=10)
    fallback_language: str | None = Field(default=None, min_length=2, max_length=10)


class PlayerControls(_Group):
    """Which buttons the player's control bar shows. Play/Pause and Settings
    are always there and so aren't listed. A hidden control's keyboard
    shortcut is switched off too."""

    episodes: bool = True  # previous / next episode (Shift+P / Shift+N)
    volume: bool = True  # mute button + slider (M, up/down arrows)
    time: bool = True  # "12:03 / 45:10"
    captions: bool = True  # subtitles on/off (C)
    fullscreen: bool = True  # (F)
    # Extras, off until chosen.
    seek_back: bool = False  # jump back by the seek time
    seek_forward: bool = False  # jump forward by the seek time
    pip: bool = False  # picture-in-picture (P)


class PlaybackSettings(_Group):
    autoplay_next: bool = True
    # A video starts playing by itself when opened. (Before 9d the player always
    # waited for a click; autoplay-next starts the next episode regardless.)
    autoplay_on_open: bool = True
    auto_skip_intro: bool = False
    skip_buttons: SkipButtons = SkipButtons()
    # Arrow keys, J/L and the double-tap zones all move by this much.
    seek_seconds: Literal[5, 10, 15, 20, 30] = 10
    auto_subtitles: AutoSubtitles = AutoSubtitles()
    # Resume position only: off = don't save where you stopped and don't
    # jump back to it. Which episode you last opened (the "S1:E8" label,
    # Continue Watching) is still recorded either way.
    save_progress: bool = True
    # Remember volume + subtitle tweaks separately for each movie/episode.
    remember_per_video: bool = True
    controls: PlayerControls = PlayerControls()


class SubtitleStyle(_Group):
    """The look of subtitles *everywhere*. Timing offset is deliberately
    not here — every release is synced differently, so it only ever makes
    sense per video."""

    font_family: str = Field(default="Inter, system-ui, sans-serif", max_length=120)
    font_size: int = Field(default=22, ge=10, le=64)
    font_weight: int = Field(default=500, ge=100, le=900)
    color: str = Field(default="#ffffff", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    background_opacity: float = Field(default=0.6, ge=0, le=1)
    outline: bool = True
    outline_color: str = Field(default="#000000", pattern=r"^#[0-9A-Fa-f]{6}$")
    shadow: bool = True
    position: Literal["bottom", "top"] = "bottom"
    align: Literal["left", "center", "right"] = "center"


class UserSettings(_Group):
    appearance: AppearanceSettings = AppearanceSettings()
    playback: PlaybackSettings = PlaybackSettings()
    subtitles: SubtitleStyle = SubtitleStyle()
