"""Shared pytest fixtures for the backend tests."""

import pytest

from backend.app import create_app
from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly


@pytest.fixture(scope="session")
def real_window():
    """The first 24 hours of the real test split, in raw units (not scaled).

    Returns a list of 24 dicts, one per hour, keyed by feature name.
    """
    test_split = chronological_split(load_hourly())[2]
    return test_split.iloc[:config.WINDOW].to_dict(orient="records")


@pytest.fixture
def app(tmp_path):
    """The real app with the real model, but a fresh temporary database."""
    app = create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/test.db")
    yield app
    # Close database connections so Windows can delete the temp file
    app.config["DB_ENGINE"].dispose()


@pytest.fixture
def client(app):
    return app.test_client()
