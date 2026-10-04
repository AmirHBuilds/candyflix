"""Avatar processing: untrusted uploads in, safe 256x256 WebP out."""
import io
import uuid

import pytest
from PIL import Image

from app.core.config import get_settings
from app.services import avatar_service
from app.services.avatar_service import AvatarError, process_upload


@pytest.fixture(autouse=True)
def avatars_in_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "avatars_dir", str(tmp_path))
    return tmp_path


def make_image(fmt="PNG", size=(600, 400), mode="RGB", color=(200, 30, 90)) -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, format=fmt)
    return buf.getvalue()


def decode(webp: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(webp))
    img.load()
    return img


@pytest.mark.parametrize("fmt", ["PNG", "JPEG", "WEBP", "GIF"])
def test_accepts_the_allowed_formats_and_always_returns_a_256_square_webp(fmt):
    out = decode(process_upload(make_image(fmt)))
    assert out.format == "WEBP"
    assert out.size == (256, 256)


@pytest.mark.parametrize("size", [(100, 900), (900, 100), (256, 256), (31, 17)])
def test_any_aspect_ratio_becomes_a_centre_cropped_square(size):
    assert decode(process_upload(make_image(size=size))).size == (256, 256)


def test_the_crop_is_centred():
    img = Image.new("RGB", (600, 200), (255, 0, 0))
    img.paste((0, 0, 255), (200, 0, 400, 200))  # the middle third is blue
    buf = io.BytesIO()
    img.save(buf, "PNG")
    out = decode(process_upload(buf.getvalue())).convert("RGB")
    r, g, b = out.getpixel((128, 128))
    assert b > 200 and r < 60


def test_transparency_is_kept():
    out = decode(process_upload(make_image(mode="RGBA", color=(255, 0, 0, 0))))
    assert out.mode == "RGBA"
    assert out.getpixel((10, 10))[3] == 0


def test_exif_rotation_is_applied():
    img = Image.new("RGB", (300, 300), (255, 0, 0))
    img.paste((0, 0, 255), (0, 0, 150, 300))  # the LEFT half is blue
    exif = img.getexif()
    exif[0x0112] = 6  # "rotate 90 CW to display": the left edge ends up on top
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif, quality=95)

    out = decode(process_upload(buf.getvalue())).convert("RGB")

    top, bottom = out.getpixel((128, 40)), out.getpixel((128, 216))
    assert top[2] > 200 and top[0] < 80  # blue on top
    assert bottom[0] > 200 and bottom[2] < 80  # red below


def test_metadata_is_not_carried_over():
    img = Image.new("RGB", (50, 50), (1, 2, 3))
    exif = img.getexif()
    exif[0x010E] = "SECRET DESCRIPTION"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    assert b"SECRET DESCRIPTION" not in process_upload(buf.getvalue())


@pytest.mark.parametrize(
    "data,status",
    [
        (b"", 400),
        (b"definitely not an image", 415),
        (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", 415),
        (b"GIF89a" + b"\x00" * 5, 415),
    ],
)
def test_rejects_non_images_with_a_friendly_message(data, status):
    with pytest.raises(AvatarError) as exc:
        process_upload(data)
    assert exc.value.status == status
    assert exc.value.message


def test_a_disallowed_but_real_image_format_is_refused():
    with pytest.raises(AvatarError) as exc:
        process_upload(make_image("BMP"))
    assert exc.value.status == 415
    assert "JPEG, PNG, WebP or GIF" in exc.value.message


def test_a_truncated_image_is_refused_not_half_decoded():
    data = make_image("PNG", size=(800, 800))
    with pytest.raises(AvatarError):
        process_upload(data[: len(data) // 2])


def test_oversized_uploads_are_refused_before_decoding(monkeypatch):
    monkeypatch.setattr(get_settings(), "max_avatar_bytes", 1000)
    with pytest.raises(AvatarError) as exc:
        process_upload(b"x" * 1001)
    assert exc.value.status == 413


def test_enormous_dimensions_are_refused(monkeypatch):
    monkeypatch.setattr(avatar_service, "MAX_PIXELS", 10_000)
    with pytest.raises(AvatarError) as exc:
        process_upload(make_image(size=(200, 200)))
    assert exc.value.status == 413


def test_store_uses_a_fresh_random_name_every_time(avatars_in_tmp):
    uid = uuid.uuid4()
    a = avatar_service.store(uid, b"1")
    b = avatar_service.store(uid, b"2")
    assert a != b
    assert a.startswith(str(uid)) and a.endswith(".webp")
    assert (avatars_in_tmp / a).read_bytes() == b"1"


def test_remove_deletes_only_inside_the_avatars_folder(avatars_in_tmp, tmp_path_factory):
    outside = tmp_path_factory.mktemp("outside") / "keep.txt"
    outside.write_text("keep me")
    inside = avatars_in_tmp / "x.webp"
    inside.write_bytes(b"x")

    avatar_service.remove(f"../{outside.parent.name}/keep.txt")  # a hostile stored value
    avatar_service.remove("x.webp")
    avatar_service.remove(None)

    assert outside.exists()
    assert not inside.exists()
