"""The app applies pending migrations itself at startup (covers `--reload`)."""
import inspect
import logging

import pytest
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import engine
from app.core.migrate import run_migrations, upgrade_to_head
from app.main import app, lifespan


@pytest.fixture(autouse=True)
async def dispose_db_pool():
    yield
    await engine.dispose()


@pytest.mark.asyncio
async def test_running_against_an_up_to_date_database_is_a_harmless_no_op():
    await run_migrations()
    await run_migrations()  # idempotent: nothing pending the second time either
    async with engine.connect() as conn:
        version = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
    assert version


@pytest.mark.asyncio
async def test_it_works_whatever_directory_the_app_was_started_from(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # alembic.ini is resolved from the code's location, not the cwd
    await run_migrations()


@pytest.mark.asyncio
async def test_running_inside_the_app_does_not_silence_its_loggers():
    """Alembic's logging setup would, by default, disable every existing
    logger — which would make the live app go quiet after startup."""
    logger = logging.getLogger("candyflix.test.sentinel")
    logger.disabled = False
    uvicorn_logger = logging.getLogger("uvicorn.error")

    await run_migrations()

    assert logger.disabled is False
    assert uvicorn_logger.disabled is False


@pytest.mark.asyncio
async def test_the_app_migrates_on_startup_when_enabled(monkeypatch):
    calls = []

    async def fake():
        calls.append(1)

    monkeypatch.setattr("app.main.run_migrations", fake)
    monkeypatch.setattr(get_settings(), "auto_migrate", True)
    async with lifespan(app):
        pass
    assert calls == [1]


@pytest.mark.asyncio
async def test_it_can_be_switched_off(monkeypatch):
    calls = []

    async def fake():
        calls.append(1)

    monkeypatch.setattr("app.main.run_migrations", fake)
    monkeypatch.setattr(get_settings(), "auto_migrate", False)
    async with lifespan(app):
        pass
    assert calls == []


def test_upgrade_to_head_is_blocking_and_run_off_the_event_loop():
    # Contract: env.py drives a synchronous engine, so it must not run on the loop.
    assert not inspect.iscoroutinefunction(upgrade_to_head)
    assert inspect.iscoroutinefunction(run_migrations)
