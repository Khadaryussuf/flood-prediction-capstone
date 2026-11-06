"""Shared pytest fixtures for the backend tests."""

import secrets

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from backend import accounts
from backend.app import create_app
from backend.db import ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE
from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly


@pytest.fixture(scope="session")
def real_window():
    """The first 24 hours of the real test split, in raw units (not scaled).

    Returns a list of 24 dicts, one per hour, keyed by feature name.
    """
    test_split = chronological_split(load_hourly())[2]
    return test_split.iloc[:config.WINDOW].to_dict(orient="records")


class ApiClient(FlaskClient):
    """A browser-like client: it fetches a CSRF token and sends it on every
    state-changing request, as the page does. Pass send_csrf=False to leave it off."""

    def open(self, *args, send_csrf=True, **kwargs):
        method = kwargs.get("method", "GET")
        if send_csrf and method in ("POST", "PUT", "PATCH", "DELETE"):
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("X-CSRF-Token", self.csrf_token())
            kwargs["headers"] = headers
        return super().open(*args, **kwargs)

    def csrf_token(self):
        return self.get("/api/auth/session").get_json()["csrf_token"]

    def login(self, email, password):
        return self.post("/api/auth/login", json={"email": email, "password": password})


def new_password():
    """A random password for one test. The repo holds none."""
    return secrets.token_urlsafe(16)


@pytest.fixture
def password():
    return new_password()


@pytest.fixture
def app(tmp_path, monkeypatch):
    """The real app with the real model, but a fresh temporary database. Google
    sign-in is off, whatever the machine's .env says (an empty value wins over it)."""
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"):
        monkeypatch.setenv(name, "")
    app = create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/test.db", testing=True)
    app.test_client_class = ApiClient
    yield app
    # Close database connections so Windows can delete the temp file
    app.config["DB_ENGINE"].dispose()


@pytest.fixture
def make_user(app):
    """Adds an account directly. Returns (email, password)."""
    count = iter(range(1, 1000))

    def make(role=ROLE_RESPONDER, status=STATUS_ACTIVE, email=None):
        email = email or f"user{next(count)}@example.org"
        password = new_password()
        with Session(app.config["DB_ENGINE"]) as session:
            accounts.new_user(session, "Test User", email, "Test Org", password,
                              role=role, status=status)
            session.commit()
        return email, password
    return make


@pytest.fixture
def anon(app):
    """A client with no session."""
    return app.test_client()


def logged_in_client(app, make_user, role):
    email, password = make_user(role=role)
    client = app.test_client()
    assert client.login(email, password).status_code == 200
    client.email = email
    client.password = password
    return client


@pytest.fixture
def client(app, make_user):
    """A logged-in Responder: /predict and /predictions need a session."""
    return logged_in_client(app, make_user, ROLE_RESPONDER)


@pytest.fixture
def admin(app, make_user):
    """A logged-in Administrator."""
    return logged_in_client(app, make_user, ROLE_ADMIN)
