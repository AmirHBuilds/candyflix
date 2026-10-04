"""
Per-user settings: sparse storage, defaults merged at read time.

Why sparse (see models/user_settings.py): a user's row holds only what
they explicitly changed. `resolve()` lays those overrides over the
current defaults and validates the result, so improving a default later
reaches everyone who never touched that setting.

PATCH semantics (the only way settings change):
- nested objects merge ({"appearance": {"theme": "mint"}} leaves the rest
  of "appearance" alone);
- a value of `null` *removes* that override, i.e. "back to the default"
  — that is how a per-setting "reset" works, and how a setting that a
  later feature stops using can be cleared;
- unknown keys and invalid values are rejected as a whole (nothing is
  saved), and what is stored is the *validated* value, not the raw input.
"""
import copy
import uuid
from typing import Any, get_args, get_origin

from pydantic import BaseModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user_settings import SETTINGS_SCHEMA_VERSION, UserSettings as UserSettingsRow
from app.schemas.settings import UserSettings


class SettingsValidationError(Exception):
    """Raised with human-readable problems; the route turns it into a 422."""

    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def deep_merge(base: dict, patch: dict) -> dict:
    """Returns base with `patch` applied; `None` values delete keys.
    Groups left empty by deletions are pruned. Inputs are not mutated."""
    result = copy.deepcopy(base)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict):
            existing = result.get(key)
            merged = deep_merge(existing if isinstance(existing, dict) else {}, value)
            if merged:
                result[key] = merged
            else:
                result.pop(key, None)
        else:
            result[key] = value
    return result


def _model_for(annotation: Any) -> type[BaseModel] | None:
    """The BaseModel class behind a field annotation, if it is one."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    for arg in get_args(annotation) if get_origin(annotation) else ():
        found = _model_for(arg)
        if found:
            return found
    return None


def unknown_paths(overrides: dict, model: type[BaseModel], prefix: str = "") -> list[str]:
    """Dotted paths in `overrides` that aren't real settings."""
    problems: list[str] = []
    for key, value in overrides.items():
        path = f"{prefix}{key}"
        field = model.model_fields.get(key)
        if field is None:
            problems.append(f"Unknown setting '{path}'")
            continue
        child = _model_for(field.annotation)
        if child is not None:
            if isinstance(value, dict):
                problems.extend(unknown_paths(value, child, f"{path}."))
            else:
                problems.append(f"'{path}' must be an object")
    return problems


def _overlay(defaults: dict, overrides: dict) -> dict:
    out = copy.deepcopy(defaults)
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _overlay(out[key], value)
        else:
            out[key] = value
    return out


def resolve(overrides: dict) -> UserSettings:
    """Overrides over defaults, validated. Raises pydantic.ValidationError."""
    defaults = UserSettings().model_dump()
    return UserSettings.model_validate(_overlay(defaults, overrides))


def resolve_leniently(overrides: dict) -> UserSettings:
    """Like resolve(), for *reading* stored data: a stored value that no
    longer validates (a range tightened in a later version, hand-edited
    data) must not break every page — drop the bad override(s) and carry on."""
    current = copy.deepcopy(overrides)
    for _ in range(50):  # each pass removes at least one bad key
        try:
            return resolve(current)
        except ValidationError as exc:
            progressed = False
            for err in exc.errors():
                loc = [str(p) for p in err["loc"]]
                node = current
                for part in loc[:-1]:
                    node = node.get(part, {}) if isinstance(node, dict) else {}
                if isinstance(node, dict) and loc[-1] in node:
                    del node[loc[-1]]
                    progressed = True
            if not progressed:
                break
    return UserSettings()


def _normalise(overrides: dict, resolved: dict) -> dict:
    """Replaces each override leaf with its validated value ("12" -> 12)."""
    out: dict = {}
    for key, value in overrides.items():
        if isinstance(value, dict):
            out[key] = _normalise(value, resolved[key])
        else:
            out[key] = resolved[key]
    return out


async def _get_row(db: AsyncSession, user_id: uuid.UUID) -> UserSettingsRow | None:
    return await db.get(UserSettingsRow, user_id)


async def get_overrides(db: AsyncSession, user_id: uuid.UUID) -> dict:
    row = await _get_row(db, user_id)
    return dict(row.data) if row else {}


async def get_settings(db: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    return resolve_leniently(await get_overrides(db, user_id))


async def patch_settings(db: AsyncSession, user_id: uuid.UUID, patch: dict) -> UserSettings:
    stored = await get_overrides(db, user_id)
    merged = deep_merge(stored, patch)

    problems = unknown_paths(merged, UserSettings)
    if problems:
        raise SettingsValidationError(problems)
    try:
        resolved = resolve(merged)
    except ValidationError as exc:
        raise SettingsValidationError(
            [f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()]
        ) from exc

    cleaned = _normalise(merged, resolved.model_dump())
    row = await _get_row(db, user_id)
    if row is None:
        db.add(UserSettingsRow(user_id=user_id, data=cleaned, version=SETTINGS_SCHEMA_VERSION))
    else:
        row.data = cleaned  # a new dict, so SQLAlchemy sees the change
    await db.commit()
    return resolved


async def reset_settings(db: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    row = await _get_row(db, user_id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return UserSettings()
