"""Which country an address is in, from an offline database file (no call to any outside service).

The file is optional: without it every country is unknown and nothing else changes. It must be in MaxMind's .mmdb format with
`country.iso_code` records, such as DB-IP's free "IP to Country Lite" (see DEPLOY.md)."""
import ipaddress
import os

from app.core.config import get_settings

_reader = None
_tried = False


def _open():
    global _reader, _tried
    if _tried:
        return _reader
    _tried = True
    path = get_settings().geoip_db_path
    try:
        if os.path.exists(path):
            import maxminddb

            _reader = maxminddb.open_database(path)
    except Exception:
        _reader = None
    return _reader


def available() -> bool:
    return _open() is not None


def country(ip: str | None) -> str | None:
    """Two-letter country code; "LAN" for a private or local address; None when unknown."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return None
    if addr.is_private or addr.is_loopback or addr.is_link_local:
        return "LAN"
    reader = _open()
    if reader is None:
        return None
    try:
        record = reader.get(ip) or {}
        code = (record.get("country") or {}).get("iso_code")
        return code.upper() if code else None
    except Exception:
        return None
