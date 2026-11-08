"""The production entry (backend/wsgi.py), first-start accounts, DATA_DIR, and
cookies over HTTPS and behind a proxy. IDs match docs/TESTING.md (W1 onward).
Nothing here starts a real server or reaches the network."""

import threading

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import bootstrap, db, scheduler, wsgi
from backend.app import create_app
from backend.db import ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, AuditLog, User
from tests.conftest import ApiClient, new_password

ENTRY_SETTINGS = ("PORT", "HOST", "WAITRESS_THREADS", "DEMO_ADMIN_EMAIL", "DEMO_ADMIN_PASSWORD",
                  "DEMO_RESPONDER_EMAIL", "DEMO_RESPONDER_PASSWORD", "DEMO_ORGANISATION")


@pytest.fixture
def entry(app, monkeypatch):
    """wsgi.main() against the test app, with waitress and the scheduler recorded
    instead of run. Empty values keep the machine's .env out of it."""
    for name in ENTRY_SETTINGS:
        monkeypatch.setenv(name, "")
    calls = {"serve": [], "scheduler": []}
    monkeypatch.setattr(wsgi, "create_app", lambda: app)
    monkeypatch.setattr(wsgi.scheduler, "start", lambda a: calls["scheduler"].append(a))
    monkeypatch.setattr(wsgi, "serve", lambda a, **options: calls["serve"].append((a, options)))
    return calls


def users(app):
    with Session(app.config["DB_ENGINE"]) as session:
        return {user.email: (user.role, user.status) for user in session.scalars(select(User))}


# W1: one waitress process with threads on 0.0.0.0:8000 by default, scheduler started once
def test_entry_serves_with_waitress_and_starts_the_scheduler_once(app, entry):
    wsgi.main()
    assert entry["serve"] == [(app, {"host": "0.0.0.0", "port": 8000, "threads": 8})]
    assert entry["scheduler"] == [app]


# W2: host, port and threads come from the environment; bad values stop it with a message
def test_entry_reads_host_port_and_threads(app, entry, monkeypatch):
    monkeypatch.setenv("PORT", "9123")
    monkeypatch.setenv("HOST", "127.0.0.1")
    monkeypatch.setenv("WAITRESS_THREADS", "4")
    wsgi.main()
    assert entry["serve"][-1][1] == {"host": "127.0.0.1", "port": 9123, "threads": 4}
    for bad in ("eighty", "0", "-1"):
        monkeypatch.setenv("PORT", bad)
        with pytest.raises(SystemExit, match="PORT"):
            wsgi.main()


# W3: the scheduler can't run twice in one app, whoever starts it
def test_scheduler_starts_only_once_per_app(app, monkeypatch):
    runs = []
    monkeypatch.setattr(scheduler, "run_once", lambda a: runs.append(a) or 3600)
    before = sum(t.name == "floodwatch-scheduler" for t in threading.enumerate())
    first = scheduler.start(app)
    second = scheduler.start(app)
    try:
        assert second is first
        assert sum(t.name == "floodwatch-scheduler" for t in threading.enumerate()) == before + 1
    finally:
        first.set()


# W4: first start creates the demo accounts from the environment, active, with an audit row
def test_first_start_creates_demo_accounts_from_the_environment(app, entry, monkeypatch):
    admin_password, responder_password = new_password(), new_password()
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "Admin@Example.org")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", admin_password)
    monkeypatch.setenv("DEMO_RESPONDER_EMAIL", "responder@example.org")
    monkeypatch.setenv("DEMO_RESPONDER_PASSWORD", responder_password)
    wsgi.main()
    assert users(app) == {"admin@example.org": (ROLE_ADMIN, STATUS_ACTIVE),
                          "responder@example.org": (ROLE_RESPONDER, STATUS_ACTIVE)}
    with Session(app.config["DB_ENGINE"]) as session:
        assert session.query(AuditLog).filter_by(actor_email="first-start").count() == 2
    assert app.test_client().login("admin@example.org", admin_password).status_code == 200


# W5: a restart never adds, changes or resets accounts
def test_restart_leaves_existing_accounts_alone(app, entry, monkeypatch, make_user):
    email, _ = make_user(role=ROLE_ADMIN, email="existing@example.org")
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "someone.else@example.org")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", new_password())
    wsgi.main()
    assert list(users(app)) == [email]


# W6: without the variables nothing is created (the log says how to add an admin);
# a password that breaks the rules stops start-up and creates nobody, not even the admin
def test_no_or_bad_demo_settings(app, entry, monkeypatch, caplog):
    wsgi.main()
    assert users(app) == {}
    assert "DEMO_ADMIN_EMAIL" in caplog.text
    monkeypatch.setenv("DEMO_ADMIN_EMAIL", "admin@example.org")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", new_password())
    monkeypatch.setenv("DEMO_RESPONDER_EMAIL", "responder@example.org")
    monkeypatch.setenv("DEMO_RESPONDER_PASSWORD", "short")
    with pytest.raises(SystemExit, match="Demo accounts not created"):
        wsgi.main()
    assert users(app) == {}


# W7: DATA_DIR puts the database in that folder (created if missing); DATABASE_URL wins
def test_data_dir_holds_the_database(tmp_path, monkeypatch):
    folder = tmp_path / "volume" / "data"
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("DATA_DIR", str(folder))
    engine = db.make_engine()
    engine.dispose()
    assert (folder / "floodwatch.db").exists()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path.as_posix()}/chosen.db")
    assert db.configured_url().endswith("/chosen.db")


def secure_flag(response):
    cookie = response.headers.get("Set-Cookie", "")
    assert cookie.startswith("floodwatch_session=")
    return "Secure" in [part.strip() for part in cookie.split(";")]


# W8: the session cookie is Secure over HTTPS (even on localhost), and on any other host
def test_session_cookie_is_secure_over_https(app):
    client = app.test_client()
    assert secure_flag(client.get("/api/auth/session", base_url="https://localhost")) is True
    assert secure_flag(app.test_client().get("/api/auth/session", base_url="https://floodwatch.example")) is True
    assert secure_flag(app.test_client().get("/api/auth/session", base_url="http://floodwatch.example")) is True
    assert secure_flag(app.test_client().get("/api/auth/session", base_url="http://localhost:5000")) is False


FORWARDED = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "floodwatch.example", "X-Forwarded-For": "203.0.113.9"}


# W9: behind a proxy that ends HTTPS and talks to the app as localhost, the cookie is
# Secure only when TRUSTED_PROXIES says to believe the proxy's headers
def test_proxy_headers_count_only_when_trusted(app, tmp_path, monkeypatch):
    untrusted = app.test_client().get("/api/auth/session", base_url="http://localhost:8000", headers=FORWARDED)
    assert secure_flag(untrusted) is False  # anyone can send these headers
    monkeypatch.setenv("TRUSTED_PROXIES", "1")
    for name in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"):
        monkeypatch.setenv(name, "")
    proxied = create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/proxy.db", testing=True)
    proxied.test_client_class = ApiClient
    try:
        trusted = proxied.test_client().get("/api/auth/session", base_url="http://localhost:8000", headers=FORWARDED)
        assert secure_flag(trusted) is True
        # CSRF doesn't depend on the host or scheme: a POST without the token is still refused
        refused = proxied.test_client().post("/api/auth/login", base_url="http://localhost:8000", headers=FORWARDED,
                                             json={"email": "a@example.org", "password": "x"}, send_csrf=False)
        assert refused.status_code == 403
    finally:
        proxied.config["DB_ENGINE"].dispose()


# W10: a TRUSTED_PROXIES that isn't a whole number stops start-up with a clear message
def test_bad_trusted_proxies_value(tmp_path, monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXIES", "yes")
    with pytest.raises(RuntimeError, match="TRUSTED_PROXIES"):
        create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/bad.db", testing=True)


# W11: the runtime requirements carry waitress and no test tools; pytest is in the dev file
def test_requirements_split():
    from pipeline import config
    runtime = (config.ROOT / "requirements.txt").read_text(encoding="utf-8").split()
    dev = (config.ROOT / "requirements-dev.txt").read_text(encoding="utf-8").split()
    assert "waitress==3.0.2" in runtime
    assert not any(line.startswith("pytest") for line in runtime)
    assert "pytest==9.1.1" in dev and "requirements.txt" in dev
    assert all("==" in line for line in runtime)


# W12: THIRD_PARTY.md lists every pinned Python package with its version and a licence
def test_third_party_lists_the_python_pins():
    from pipeline import config
    text = (config.ROOT / "THIRD_PARTY.md").read_text(encoding="utf-8")
    for file in ("requirements.txt", "requirements-dev.txt"):
        for line in (config.ROOT / file).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith(("#", "-r")):
                continue
            name, version = line.split("==")
            assert f"| `{name}` | {version} | " in text, line
    assert "| `waitress` | 3.0.2 | ZPL 2.1 |" in text
    assert "see its PyPI page" not in text  # every licence was found
