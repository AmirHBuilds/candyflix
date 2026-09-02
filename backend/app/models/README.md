# models/

Reserved for SQLAlchemy ORM models.

Per the approved architecture, this will hold:
- `user.py` — `User` (Phase 2)
- `watchlist_item.py` — `WatchlistItem` (Phase 5)
- `watch_progress.py` — `WatchProgress` (Phase 7)

Intentionally empty in Phase 1 — no tables are needed yet for the
project skeleton, and Alembic is already wired up to pick up models
from `app.core.db.Base.metadata` as soon as they're added.
