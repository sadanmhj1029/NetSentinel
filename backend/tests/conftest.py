"""
Points the app at a dedicated test database *before* any app module is
imported (the env var must be set first -- app.config reads it once, at
import time, via pydantic-settings).

Run with:
    DATABASE_URL=postgresql+psycopg://netsentinel:netsentinel@localhost:5432/netsentinel_test pytest
or just `pytest` if that database already exists locally (the default
below), matching docs/DEPLOYMENT.md's local dev instructions.
"""
import os

os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://netsentinel:netsentinel@localhost:5432/netsentinel_test"
)

import pytest  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app import models  # noqa: E402,F401  (register tables on Base.metadata)


@pytest.fixture()
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _reset_module_singletons():
    """app/detection's rule engine and adaptive baselines are process-wide
    singletons (by design -- see their docstrings) so every test gets a
    clean slate rather than leaking hysteresis/baseline state into the
    next test via a shared device id like "Switch-02"."""
    from app.detection.baseline import baseline_store
    from app.detection.rules import rule_engine

    rule_engine._state.clear()
    baseline_store._baselines.clear()
    yield
    rule_engine._state.clear()
    baseline_store._baselines.clear()
