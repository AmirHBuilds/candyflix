"""
Profile pictures.

Uploads are untrusted files, so nothing about them is taken on faith: the
bytes are decoded with Pillow (a file merely *named* .jpg that isn't an
image fails here), size and pixel count are capped before/while decoding,
EXIF rotation is applied, and the result is re-encoded as a small square
WebP. The original upload is never stored or served — only our re-encoded
copy, under a random filename — which also strips metadata (GPS etc.) and
neutralises anything odd hiding in the original file.
"""
import io
import secrets
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings

AVATAR_SIZE = 256
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
MAX_PIXELS = 40_000_000  # a decompression-bomb guard (~6500x6500)


class AvatarError(Exception):
    """A user-facing reason the upload was refused; `status` is the HTTP code."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def avatars_dir() -> Path:
    path = Path(get_settings().avatars_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


def process_upload(data: bytes) -> bytes:
    """Validates an uploaded image and returns a 256x256 WebP."""
    settings = get_settings()
    if not data:
        raise AvatarError("That file is empty.")
    if len(data) > settings.max_avatar_bytes:
        mb = settings.max_avatar_bytes / 1_000_000
        raise AvatarError(f"That image is too large (max {mb:g} MB).", status=413)

    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in ALLOWED_FORMATS:
                raise AvatarError("Please upload a JPEG, PNG, WebP or GIF image.", status=415)
            if probe.width * probe.height > MAX_PIXELS:
                raise AvatarError("That image's dimensions are too large.", status=413)
            image = ImageOps.exif_transpose(probe)
            image.load()  # forces a full decode, so a truncated/corrupt file fails here
    except AvatarError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
        raise AvatarError("That file couldn't be read as an image.", status=415)

    # Keep transparency if there is some; otherwise plain RGB.
    image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
    square = ImageOps.fit(image, (AVATAR_SIZE, AVATAR_SIZE), method=Image.Resampling.LANCZOS)
    out = io.BytesIO()
    square.save(out, format="WEBP", quality=85)
    return out.getvalue()


def store(user_id: uuid.UUID, webp: bytes) -> str:
    """Writes the picture and returns its filename. The random suffix means
    a new upload gets a new URL, so browsers never show a stale picture."""
    filename = f"{user_id}-{secrets.token_hex(4)}.webp"
    (avatars_dir() / filename).write_bytes(webp)
    return filename


def remove(filename: str | None) -> None:
    if not filename:
        return
    # Only ever delete inside the avatars dir, whatever the stored value says.
    path = avatars_dir() / Path(filename).name
    path.unlink(missing_ok=True)
