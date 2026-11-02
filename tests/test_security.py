"""Security and access control. IDs match the table in docs/TESTING.md (S1 onward)."""

import json
import re
import subprocess
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import auth, db, env
from backend.app import create_app
from backend.db import (ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING,
                        AuditLog, AuthSession, User)
from pipeline import config
from tests.conftest import new_password


def signup(client, **overrides):
    password = overrides.pop("password", new_password())
    body = {"name": "New Person", "email": "new.person@example.org", "organisation": "Red Cross",
            "password": password, "confirm_password": password, **overrides}
    return client.post("/api/auth/signup", json=body), password


def user_row(app, email):
    with Session(app.config["DB_ENGINE"]) as session:
        user = session.scalar(select(User).where(User.email == email))
        session.expunge(user)
        return user


def user_id(app, email):
    return user_row(app, email).id


def move_clock(monkeypatch, delta):
    real = db.utcnow
    monkeypatch.setattr(db, "utcnow", lambda: real() + delta)


# S1
def test_signup_creates_pending_responder(app, anon):
    response, _ = signup(anon)
    assert response.status_code == 201
    assert response.get_json()["status"] == STATUS_PENDING
    row = user_row(app, "new.person@example.org")
    assert (row.status, row.role, row.organisation) == (STATUS_PENDING, ROLE_RESPONDER, "Red Cross")


# S2
def test_pending_account_cannot_log_in(anon):
    _, password = signup(anon)
    response = anon.login("new.person@example.org", password)
    assert response.status_code == 403
    assert "awaiting approval" in response.get_json()["error"]
    assert anon.get("/api/alerts").status_code == 401


# S3
def test_rejected_account_gets_the_awaiting_message_only_with_the_right_password(app, admin, anon):
    _, password = signup(anon)
    uid = user_id(app, "new.person@example.org")
    assert admin.patch(f"/api/admin/users/{uid}", json={"action": "reject"}).status_code == 200
    assert "awaiting approval" in anon.login("new.person@example.org", password).get_json()["error"]
    assert anon.login("new.person@example.org", new_password()).get_json()["error"] == auth.BAD_CREDENTIALS


# S4
def test_approve_then_login_works(app, admin, anon):
    _, password = signup(anon)
    uid = user_id(app, "new.person@example.org")
    assert admin.patch(f"/api/admin/users/{uid}", json={"action": "approve"}).status_code == 200
    response = anon.login("New.Person@Example.org", password)  # emails aren't case sensitive
    assert response.status_code == 200
    assert response.get_json()["user"]["role"] == ROLE_RESPONDER
    assert user_row(app, "new.person@example.org").last_login_at is not None


# S5
def test_wrong_credentials_give_one_generic_error(anon, make_user):
    email, _ = make_user()
    wrong = anon.login(email, new_password())
    unknown = anon.login("nobody@example.org", new_password())
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.get_json() == unknown.get_json() == {"error": auth.BAD_CREDENTIALS}


# S6
def test_lockout_after_five_failures_and_release_after_ten_minutes(anon, make_user, monkeypatch):
    email, password = make_user()
    for attempt in range(4):
        assert anon.login(email, new_password()).status_code == 401, attempt
    assert anon.login(email, new_password()).status_code == 429
    # Locked, even with the right password
    assert anon.login(email, password).status_code == 429

    move_clock(monkeypatch, timedelta(minutes=9))
    assert anon.login(email, password).status_code == 429
    move_clock(monkeypatch, timedelta(minutes=1, seconds=1))
    assert anon.login(email, password).status_code == 200


# S7
def test_failures_outside_the_window_do_not_add_up(anon, make_user, monkeypatch):
    email, _ = make_user()
    for _ in range(4):
        anon.login(email, new_password())
    move_clock(monkeypatch, timedelta(minutes=11))
    assert anon.login(email, new_password()).status_code == 401


# S8: default deny, checked against every route the app has
def test_no_session_gives_401_on_every_api_route(app, anon):
    public = {"/api/auth/session", "/api/auth/login", "/api/auth/signup", "/health"}
    checked = 0
    for rule in app.url_map.iter_rules():
        path = rule.rule
        if path in public or path.startswith("/static") or not (
                path.startswith("/api/") or path in ("/predict", "/predictions")):
            continue
        url = re.sub(r"<[^>]+>", "1", path)
        for method in rule.methods - {"HEAD", "OPTIONS"}:
            response = anon.open(url, method=method, json={} if method != "GET" else None, send_csrf=False)
            assert response.status_code == 401, f"{method} {url}"
            checked += 1
    assert checked >= 8


# S9
@pytest.mark.parametrize("path", ["/dashboard", "/trends", "/alerts", "/settings", "/evidence", "/demo", "/"])
def test_pages_send_anyone_without_a_session_to_login(anon, path):
    response = anon.get(path)
    assert response.status_code == 302
    assert response.headers["Location"] == "/login"


# S10
def test_public_paths_stay_public(anon):
    assert anon.get("/health").status_code == 200
    assert anon.get("/api/auth/session").get_json()["user"] is None


# S11: every admin route, checked against the app's own list of routes
def test_responder_gets_403_on_every_admin_route(app, client):
    checked = 0
    for rule in app.url_map.iter_rules():
        if not rule.rule.startswith("/api/admin"):
            continue
        url = re.sub(r"<[^>]+>", "1", rule.rule)
        for method in rule.methods - {"HEAD", "OPTIONS"}:
            response = client.open(url, method=method, json={} if method != "GET" else None)
            assert response.status_code == 403, f"{method} {url}"
            checked += 1
    assert checked >= 4


# S12
def test_responder_is_redirected_away_from_the_settings_page(client, admin):
    assert client.get("/settings").headers["Location"] == "/dashboard"
    assert admin.get("/settings").status_code in (200, 503)


# S13
def test_admin_can_disable_and_enable_and_it_ends_their_session(app, admin, client):
    uid = user_id(app, client.email)
    assert client.get("/predictions").status_code == 200
    assert admin.patch(f"/api/admin/users/{uid}", json={"action": "disable"}).get_json()["status"] == STATUS_DISABLED
    assert client.get("/predictions").status_code == 401  # the open session ended
    response = app.test_client().login(client.email, client.password)
    assert response.status_code == 403 and "disabled" in response.get_json()["error"]

    assert admin.patch(f"/api/admin/users/{uid}", json={"action": "enable"}).get_json()["status"] == STATUS_ACTIVE
    assert app.test_client().login(client.email, client.password).status_code == 200


# S14
def test_remove_never_deletes_the_row(app, admin, client):
    uid = user_id(app, client.email)
    admin.patch(f"/api/admin/users/{uid}", json={"action": "disable"})
    assert user_row(app, client.email).status == STATUS_DISABLED
    assert admin.delete(f"/api/admin/users/{uid}").status_code == 405


# S15
@pytest.mark.parametrize("extra", [{"role": ROLE_ADMIN}, {"role": ROLE_ADMIN, "status": STATUS_ACTIVE},
                                   {"is_admin": True}])
def test_role_in_signup_is_ignored(app, anon, extra):
    response, password = signup(anon, **extra)
    assert response.status_code == 201
    row = user_row(app, "new.person@example.org")
    assert (row.role, row.status) == (ROLE_RESPONDER, STATUS_PENDING)
    assert anon.login("new.person@example.org", password).status_code == 403


# S16
def test_duplicate_email_rejected_whatever_the_case(anon):
    assert signup(anon)[0].status_code == 201
    response, _ = signup(anon, email="NEW.PERSON@example.org")
    assert response.status_code == 409


# S17
def test_weak_passwords_rejected(anon):
    assert signup(anon, password="x" * 9)[0].status_code == 400
    email = "longenough@example.org"
    assert signup(anon, email=email, password=email)[0].status_code == 400
    response = anon.post("/api/auth/signup", json={"name": "A", "email": "a@example.org",
                                                   "password": new_password(), "confirm_password": new_password()})
    assert response.status_code == 400 and "match" in response.get_json()["error"]


# S18
def test_logout_invalidates_the_session_even_for_a_copied_cookie(app, client):
    stolen = client.get_cookie("floodwatch_session").value
    assert client.get("/predictions").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/predictions").status_code == 401

    replay = app.test_client()
    replay.set_cookie("floodwatch_session", stolen)
    assert replay.get("/predictions").status_code == 401


# S19
def test_expired_session_rejected(client, monkeypatch):
    assert client.get("/predictions").status_code == 200
    move_clock(monkeypatch, timedelta(hours=8, seconds=1))
    assert client.get("/predictions").status_code == 401


# S20
def test_session_expiry_is_eight_hours(app, client):
    with Session(app.config["DB_ENGINE"]) as session:
        row = session.scalars(select(AuthSession)).one()
        assert row.expires_at - row.created_at == timedelta(hours=8)
    assert app.config["PERMANENT_SESSION_LIFETIME"] == timedelta(hours=8)


# S21
def test_last_admin_cannot_be_removed_and_no_self_demotion(app, admin, make_user):
    uid = user_id(app, admin.email)
    for change in ({"action": "disable"}, {"action": "set_role", "role": ROLE_RESPONDER}):
        response = admin.patch(f"/api/admin/users/{uid}", json=change)
        assert response.status_code == 409, change
        assert "your own account" in response.get_json()["error"]
    assert user_row(app, admin.email).role == ROLE_ADMIN


# S22: reaching the last-admin rule needs two admins, one of whom was already
# removed in a way the self-check doesn't cover
def test_last_active_admin_rule_blocks_another_admin(app, admin, make_user, monkeypatch):
    email, password = make_user(role=ROLE_ADMIN)
    second = app.test_client()
    assert second.login(email, password).status_code == 200
    # Two admins: removing the other one is fine
    assert second.patch(f"/api/admin/users/{user_id(app, admin.email)}",
                        json={"action": "disable"}).status_code == 200
    # Now only `second` is active. Pretend a different admin session asks to remove them.
    monkeypatch.setattr(auth.accounts, "active_admin_count", lambda session: 1)
    third_email, third_password = make_user(role=ROLE_ADMIN)
    third = app.test_client()
    assert third.login(third_email, third_password).status_code == 200
    response = third.patch(f"/api/admin/users/{user_id(app, email)}", json={"action": "disable"})
    assert response.status_code == 409
    assert "last active administrator" in response.get_json()["error"]


# S23
@pytest.mark.parametrize("method,path,body", [
    ("POST", "/predict", {"readings": []}),
    ("POST", "/api/auth/logout", {}),
    ("POST", "/api/admin/users", {}),
])
def test_csrf_missing_or_wrong_token_rejected(admin, method, path, body):
    assert admin.open(path, method=method, json=body, send_csrf=False).status_code == 403
    bad = admin.open(path, method=method, json=body, headers={"X-CSRF-Token": new_password()}, send_csrf=False)
    assert bad.status_code == 403
    assert "CSRF" in bad.get_json()["error"]


# S24
def test_csrf_required_on_login_and_signup_and_token_changes_at_login(anon, make_user):
    email, password = make_user()
    assert anon.post("/api/auth/login", json={"email": email, "password": password},
                     send_csrf=False).status_code == 403
    assert anon.post("/api/auth/signup", json={}, send_csrf=False).status_code == 403
    before = anon.csrf_token()
    after = anon.login(email, password).get_json()["csrf_token"]
    assert before != after


# S25: nothing that returns user data may contain a hash
def test_no_password_hash_in_responses(app, admin, make_user, anon):
    email, password = make_user(status=STATUS_PENDING)
    hashed = user_row(app, email).password_hash
    for response in (admin.get("/api/admin/users"), admin.get("/api/auth/session"),
                     admin.get("/api/admin/audit"), anon.login(email, password),
                     admin.post("/api/admin/users", json={"name": "B", "email": "b@example.org",
                                                          "password": new_password()})):
        text = response.get_data(as_text=True)
        assert hashed not in text
        assert "password" not in text.lower() and "scrypt" not in text


# S26
def test_cookie_flags_on_localhost(anon, make_user):
    email, password = make_user()
    cookie = anon.login(email, password).headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie
    assert "Secure" not in cookie
    assert "Expires=" in cookie  # a dated cookie, not left open


# S27
def test_cookie_is_secure_when_not_on_localhost(app, make_user):
    email, password = make_user()
    client = app.test_client()
    url = "https://floodwatch.example.org"
    token = client.get("/api/auth/session", base_url=url).get_json()["csrf_token"]
    response = client.post("/api/auth/login", base_url=url, send_csrf=False,
                           json={"email": email, "password": password},
                           headers={"X-CSRF-Token": token})
    assert response.status_code == 200
    assert "Secure" in response.headers["Set-Cookie"]


# S28
def test_refuses_to_start_without_a_secret_key(tmp_path, monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setattr(env, "ENV_PATH", tmp_path / "no.env")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/test.db")


# S29
def test_admin_actions_are_in_the_audit_log(app, admin, anon):
    signup(anon)
    uid = user_id(app, "new.person@example.org")
    admin.patch(f"/api/admin/users/{uid}", json={"action": "approve"})
    admin.patch(f"/api/admin/users/{uid}", json={"action": "set_role", "role": ROLE_ADMIN})
    rows = admin.get("/api/admin/audit").get_json()
    assert [(r["action"], r["actor"], r["target"]) for r in rows[:2]] == [
        ("set_role", admin.email, "new.person@example.org"),
        ("approve", admin.email, "new.person@example.org"),
    ]
    assert rows[0]["at"]
    with Session(app.config["DB_ENGINE"]) as session:
        assert len(session.scalars(select(AuditLog)).all()) == 2


# S30: predict needs a session
def test_predict_and_predictions_need_a_session(anon, real_window):
    assert anon.post("/predict", json={"readings": real_window}).status_code == 401
    assert anon.get("/predictions").status_code == 401


# ---- Repo scans --------------------------------------------------------

def tracked_files():
    output = subprocess.run(["git", "ls-files"], cwd=config.ROOT, capture_output=True, text=True, check=True)
    return output.stdout.splitlines()


def repo_files():
    """Tracked files plus new ones that aren't ignored, so the scan also covers
    what is about to be committed."""
    output = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                            cwd=config.ROOT, capture_output=True, text=True, check=True)
    return output.stdout.splitlines()


SKIP_SUFFIXES = (".png", ".keras", ".pkl", ".npz", ".lock", ".svg", ".csv")
SKIP_PARTS = ("package-lock.json", "backend/static/", "experiments/", "THIRD_PARTY.md", "frontend/src/test/fixtures/")
# A credential-like name given a literal value in quotes
HARD_CODED = re.compile(
    r"""(?ix)\b(password|passwd|pwd|secret|secret_key|api_?key|token|smtp_password)\b["']?\s*[:=]\s*["'][^"'\s{}$<]{4,}["']""")
# Assignments in env-style files
ENV_VALUE = re.compile(r"(?m)^[ \t]*(SECRET_KEY|SMTP_PASSWORD|SMTP_USER)[ \t]*=[ \t]*\S+")


# S31
def test_no_hard_coded_passwords_or_secrets_in_the_repo():
    findings = []
    for name in repo_files():
        if name.endswith(SKIP_SUFFIXES) or any(part in name for part in SKIP_PARTS):
            continue
        path = config.ROOT / name
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for match in HARD_CODED.finditer(text):
            findings.append(f"{name}: {match.group(0)}")
        if name.startswith(".env") or name.endswith(".env.example"):
            findings += [f"{name}: {m.group(0)}" for m in ENV_VALUE.finditer(text)]
    assert not findings, json.dumps(findings, indent=1)


# S32
def test_env_file_is_ignored_and_not_tracked():
    assert ".env" not in tracked_files()
    result = subprocess.run(["git", "check-ignore", ".env"], cwd=config.ROOT, capture_output=True, text=True)
    assert result.returncode == 0
