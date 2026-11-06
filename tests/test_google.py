"""Sign in with Google. IDs match docs/TESTING.md (G1 onward). No request reaches
Google: the parts that would are replaced, and the state check runs for real."""

import secrets
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy.orm import Session

from backend import accounts, google_auth
from backend.app import create_app
from backend.db import ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING, AuditLog
from tests.conftest import ApiClient

CLIENT_ID = "floodwatch-test.apps.googleusercontent.com"


@pytest.fixture
def app(tmp_path, monkeypatch):
    """The real app with Google sign-in switched on, with a made-up client."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", secrets.token_urlsafe(24))
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "")
    app = create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/test.db", testing=True)
    app.test_client_class = ApiClient
    yield app
    app.config["DB_ENGINE"].dispose()


def google(app):
    return app.config["GOOGLE_OAUTH"].google


def claims(email="new.person@example.org", verified=True, **extra):
    return {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1234567890",
            "email": email, "email_verified": verified, "name": "New Person", **extra}


def sign_in_with(app, monkeypatch, userinfo):
    """Stands in for Google's validated answer (after the state check) and runs the callback."""
    monkeypatch.setattr(google(app), "authorize_access_token", lambda **kw: {"userinfo": userinfo})
    client = app.test_client()
    response = client.get("/api/auth/google/callback?code=abc&state=xyz")
    return client, response


def result(response):
    return parse_qs(urlparse(response.headers["Location"]).query).get("google", [None])[0]


def session_user(client):
    return client.get("/api/auth/session").get_json()["user"]


def user_row(app, email):
    with Session(app.config["DB_ENGINE"]) as session:
        user = accounts.find_user(session, email)
        if user:
            session.expunge(user)
        return user


def activate(app, email):
    with Session(app.config["DB_ENGINE"]) as session:
        accounts.find_user(session, email).status = STATUS_ACTIVE
        session.commit()


# G1: off unless both settings are present
def test_off_without_both_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "")
    off = create_app(database_url=f"sqlite:///{tmp_path.as_posix()}/off.db", testing=True)
    client = off.test_client()
    assert client.get("/api/auth/session").get_json()["providers"] == {"google": False}
    assert client.get("/api/auth/google/login").status_code == 404
    assert client.get("/api/auth/google/callback?code=a&state=b").status_code == 404
    off.config["DB_ENGINE"].dispose()


# G2: starting a sign-in sends the browser to Google with state, nonce and PKCE
def test_start_redirects_to_google_with_state_nonce_and_pkce(app, anon):
    assert anon.get("/api/auth/session").get_json()["providers"] == {"google": True}
    response = anon.get("/api/auth/google/login")
    assert response.status_code == 302
    url = urlparse(response.headers["Location"])
    query = parse_qs(url.query)
    assert url.netloc == "accounts.google.com"
    assert query["client_id"] == [CLIENT_ID]
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert len(query["state"][0]) >= 20 and len(query["nonce"][0]) >= 20
    assert query["redirect_uri"] == ["http://localhost/api/auth/google/callback"]
    assert "client_secret" not in query


# G3: the state check. A callback whose state this browser didn't start is refused
# before any code exchange, and logs nobody in
def test_callback_with_a_forged_state_is_refused(app, anon, monkeypatch):
    exchanged = []
    monkeypatch.setattr(google(app), "fetch_access_token", lambda **kw: exchanged.append(kw) or {})
    # No sign-in started at all
    response = anon.get("/api/auth/google/callback?code=abc&state=forged")
    assert response.status_code == 302 and result(response) == google_auth.FAILED
    # A sign-in started, but the callback carries someone else's state
    anon.get("/api/auth/google/login")
    response = anon.get("/api/auth/google/callback?code=abc&state=" + secrets.token_urlsafe(20))
    assert result(response) == google_auth.FAILED
    assert exchanged == []
    assert session_user(anon) is None


# G4: positive control for G3. The real state goes on to the code exchange, once,
# and the same state can't be used twice
def test_matching_state_reaches_the_code_exchange_once(app, anon, monkeypatch):
    exchanged = []
    monkeypatch.setattr(google(app), "fetch_access_token",
                        lambda **kw: exchanged.append(kw) or {"access_token": "t"})
    location = anon.get("/api/auth/google/login").headers["Location"]
    state = parse_qs(urlparse(location).query)["state"][0]
    response = anon.get(f"/api/auth/google/callback?code=abc&state={state}")
    assert len(exchanged) == 1 and exchanged[0]["code"] == "abc"
    assert result(response) == google_auth.FAILED  # this stand-in answer has no ID token
    anon.get(f"/api/auth/google/callback?code=abc&state={state}")
    assert len(exchanged) == 1
    assert session_user(anon) is None


# G5: Google reporting an error (for example, the person pressed Cancel)
def test_google_error_is_refused(app, anon):
    anon.get("/api/auth/google/login")
    response = anon.get("/api/auth/google/callback?error=access_denied&state=x")
    assert result(response) == google_auth.FAILED and session_user(anon) is None


# G6: unverified email refused, including a string "true" or a missing claim, even
# for an email that already has an account
@pytest.mark.parametrize("verified", [False, "true", None])
def test_unverified_email_is_refused(app, monkeypatch, make_user, verified):
    email, _ = make_user(role=ROLE_ADMIN, email="boss@example.org")
    info = claims(email, verified)
    if verified is None:
        del info["email_verified"]
    client, response = sign_in_with(app, monkeypatch, info)
    assert result(response) == google_auth.UNVERIFIED
    assert session_user(client) is None
    sign_in_with(app, monkeypatch, claims("stranger@example.org", verified))
    assert user_row(app, "stranger@example.org") is None  # and no account is made


# G7: the role is never taken from Google
def test_new_google_user_is_a_pending_responder_whatever_the_claims_say(app, monkeypatch):
    info = claims("New.Person@Example.org", role="admin", roles=["admin"], groups=["admin"],
                  hd="example.org", status="active")
    client, response = sign_in_with(app, monkeypatch, info)
    assert result(response) == google_auth.PENDING
    assert session_user(client) is None
    user = user_row(app, "new.person@example.org")
    assert (user.role, user.status, user.name) == (ROLE_RESPONDER, STATUS_PENDING, "New Person")
    with Session(app.config["DB_ENGINE"]) as session:
        assert session.query(AuditLog).filter_by(action="google_signup").count() == 1


# G8: an existing account is matched on the verified email and keeps its own role
@pytest.mark.parametrize("role", [ROLE_ADMIN, ROLE_RESPONDER])
def test_existing_account_matches_on_verified_email_and_keeps_its_role(app, monkeypatch, make_user, role):
    email, _ = make_user(role=role, email=f"{role}@example.org")
    other = ROLE_RESPONDER if role == ROLE_ADMIN else ROLE_ADMIN
    client, response = sign_in_with(app, monkeypatch, claims(email.upper(), role=other))
    assert response.headers["Location"] == "/dashboard"
    assert session_user(client)["role"] == role
    assert user_row(app, email).role == role


# G9: pending and disabled accounts stay that way
@pytest.mark.parametrize("status,expected", [(STATUS_PENDING, google_auth.PENDING),
                                             (STATUS_DISABLED, google_auth.DISABLED)])
def test_pending_or_disabled_accounts_are_not_let_in(app, monkeypatch, make_user, status, expected):
    email, _ = make_user(status=status)
    client, response = sign_in_with(app, monkeypatch, claims(email))
    assert result(response) == expected and session_user(client) is None


# G10: once approved, the Google account signs in as a Responder, and CSRF still applies
def test_approved_google_account_signs_in(app, monkeypatch):
    sign_in_with(app, monkeypatch, claims())
    activate(app, "new.person@example.org")
    client, response = sign_in_with(app, monkeypatch, claims())
    assert response.headers["Location"] == "/dashboard"
    assert session_user(client)["role"] == ROLE_RESPONDER
    assert client.post("/api/auth/logout", send_csrf=False).status_code == 403


# G11: the account Google created can't be logged into with a guessed password
def test_google_created_account_has_no_known_password(app, monkeypatch):
    sign_in_with(app, monkeypatch, claims())
    activate(app, "new.person@example.org")
    for guess in ("", "password", "new.person@example.org"):
        assert app.test_client().login("new.person@example.org", guess).status_code == 401
