"""Sessions, CSRF and access control.

Sessions: Flask's signed cookie holds only a random session id and the CSRF
token. The id points at an auth_sessions row, which is what makes logout, expiry
and disabling an account take effect immediately on the server.

CSRF: a per-session token (the synchronizer pattern). GET /api/auth/session
gives the page its token, and every POST/PUT/PATCH/DELETE must send it back in
the X-CSRF-Token header. Another site can't read the token or set that header,
and SameSite=Lax also keeps the cookie off its form posts.

Access is default-deny: everything needs a session unless it is listed in
PUBLIC_PATHS, or is a static file.
"""

import hmac
import secrets
from datetime import timedelta
from functools import wraps

from flask import g, jsonify, redirect, request, session
from flask.sessions import SecureCookieSessionInterface
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import db
from backend.db import ROLE_ADMIN, STATUS_ACTIVE, AuthSession, User

SESSION_LIFETIME = timedelta(hours=8)
CSRF_HEADER = "X-CSRF-Token"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
LOCALHOST_NAMES = {"localhost", "127.0.0.1", "[::1]", "::1"}

# /api/auth/session only says whether you're logged in and hands out the CSRF
# token that login and sign-up themselves need.
PUBLIC_PATHS = {"/health", "/api/auth/session", "/api/auth/login", "/api/auth/signup",
                "/login", "/signup"}
# The browser pages. Without a session these go to the login page instead of a 401.
PAGE_PATHS = {"/", "/dashboard", "/trends", "/alerts", "/settings", "/evidence", "/demo"}


class FloodWatchSessionInterface(SecureCookieSessionInterface):
    """Signed-cookie sessions, marked Secure except on localhost."""

    def get_cookie_secure(self, app):
        return request.host.rsplit(":", 1)[0].lower() not in LOCALHOST_NAMES


def configure_sessions(app, secret_key):
    app.secret_key = secret_key
    app.session_interface = FloodWatchSessionInterface()
    app.config.update(
        SESSION_COOKIE_NAME="floodwatch_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=SESSION_LIFETIME,
    )


def csrf_token():
    """This session's CSRF token, creating one if needed."""
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


def start_login(engine, user_id):
    """Record a login and give it a fresh session id and CSRF token."""
    session.clear()
    session.permanent = True
    sid = secrets.token_urlsafe(32)
    with Session(engine) as db_session:
        now = db.utcnow()
        db_session.add(AuthSession(id=sid, user_id=user_id, created_at=now,
                                   expires_at=now + SESSION_LIFETIME))
        db_session.get(User, user_id).last_login_at = now
        db_session.commit()
    session["sid"] = sid
    csrf_token()


def end_login(engine):
    sid = session.get("sid")
    if sid:
        with Session(engine) as db_session:
            row = db_session.get(AuthSession, sid)
            if row:
                row.revoked = True
                db_session.commit()
    session.clear()


def revoke_sessions(db_session, user_id):
    """End every login of a user, for example when the account is disabled."""
    rows = db_session.scalars(select(AuthSession).where(AuthSession.user_id == user_id))
    for row in rows:
        row.revoked = True


def load_user(engine):
    """The logged-in user for this request, or None. Checks the server-side
    record, so a copied cookie stops working after logout or expiry."""
    sid = session.get("sid")
    if not sid:
        return None
    with Session(engine) as db_session:
        row = db_session.get(AuthSession, sid)
        if row is None or row.revoked or row.expires_at <= db.utcnow():
            return None
        user = db_session.get(User, row.user_id)
        if user is None or user.status != STATUS_ACTIVE:
            return None
        db_session.expunge(user)
        return user


def check_request(engine):
    """Runs before every request. Returns a response to refuse it, or None."""
    path = request.path.rstrip("/") or "/"
    g.user = load_user(engine)

    is_public = path in PUBLIC_PATHS or path.startswith("/static/")
    if not is_public and g.user is None:
        if path in PAGE_PATHS:
            return redirect("/login")
        return jsonify({"error": "Login required"}), 401

    if path.startswith("/api/admin") and g.user.role != ROLE_ADMIN:
        return jsonify({"error": "Administrator access required"}), 403
    if path == "/settings" and g.user.role != ROLE_ADMIN:
        return redirect("/dashboard")

    if request.method in UNSAFE_METHODS:
        sent = request.headers.get(CSRF_HEADER, "")
        expected = session.get("csrf", "")
        if not expected or not hmac.compare_digest(sent, expected):
            return jsonify({"error": "Missing or invalid CSRF token. Reload the page and try again."}), 403
    return None


def admin_required(view):
    """Second check on admin views, on top of the /api/admin rule above."""
    @wraps(view)
    def wrapper(*args, **kwargs):
        if g.user is None or g.user.role != ROLE_ADMIN:
            return jsonify({"error": "Administrator access required"}), 403
        return view(*args, **kwargs)
    return wrapper


def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if request.path.startswith("/api/") or request.path == "/predictions":
        response.headers.setdefault("Cache-Control", "no-store")
    return response
