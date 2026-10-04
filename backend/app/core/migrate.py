"""
Applies pending Alembic migrations from inside the app.

`docker compose up` already runs `alembic upgrade head` (entrypoint.sh),
but the dev server runs with `uvicorn --reload`, which restarts the app
process *without* going back through the entrypoint — so a migration that
arrived with new code was silently skipped until the container was
restarted by hand. Running the same idempotent upgrade at app startup
closes that gap: whichever way the app starts, the schema matches the code.
"""
import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _alembic_config() -> Config:
    config = Config(str(_BACKEND_DIR / "alembic.ini"))
    # Absolute, so it works whatever directory the app was started from.
    config.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    return config


def upgrade_to_head() -> None:
    command.upgrade(_alembic_config(), "head")


async def run_migrations() -> None:
    # Alembic's env.py drives a synchronous engine; keep it off the event loop.
    await asyncio.to_thread(upgrade_to_head)
