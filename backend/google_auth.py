"""Sign in with Google: server-side OpenID Connect through Authlib.

Switched on only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (in .env or
the environment); otherwise the routes give 404 and the pages show no button.

The rules:
- Authlib keeps the state, nonce and PKCE verifier in the session, and refuses a
  callback whose state doesn't match (MismatchingStateError) before anything else.
- Google must say the email is verified. Unverified emails are refused.
- An existing account is matched on that verified email only, and keeps its own
  role and status: a pending account still waits for approval, a disabled one is
  still refused.
- A new email becomes a pending Responder that an administrator must approve.
  The role is never taken from Google; nothing in the claims is read for it.
"""

import os
import secrets
from urllib.parse import urlencode

from authlib.integrations.base_client import OAuthError
from authlib.integrations.flask_client import OAuth
from flask import Blueprint, current_app, jsonify, redirect, url_for
from sqlalchemy.orm import Session

from backend import accounts, security
from backend.db import ROLE_RESPONDER, STATUS_ACTIVE, STATUS_PENDING, STATUS_REJECTED

bp = Blueprint("google_auth", __name__)

LOGIN_PATH = "/api/auth/google/login"
CALLBACK_PATH = "/api/auth/google/callback"
# Google's endpoints, written out so starting a login needs no metadata download
GOOGLE = {
    "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
    "access_token_url": "https://oauth2.googleapis.com/token",
    "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
    "issuer": "https://accounts.google.com",
}

# Results the login page explains (see GOOGLE_MESSAGES in LoginPage.tsx)
FAILED = "google_failed"
UNVERIFIED = "google_unverified"
PENDING = "google_pending"
DISABLED = "google_disabled"


def credentials():
    """(client id, client secret), or None when Google sign-in is off."""
    client_id = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
    return (client_id, client_secret) if client_id and client_secret else None


def init_app(app):
    """Register the Google client if it's configured, and the routes either way."""
    oauth = OAuth(app)
    creds = credentials()
    if creds:
        oauth.register(
            "google", client_id=creds[0], client_secret=creds[1],
            client_kwargs={"scope": "openid email profile", "code_challenge_method": "S256"},
            **GOOGLE,
        )
    app.config["GOOGLE_OAUTH"] = oauth if creds else None
    app.register_blueprint(bp)


def enabled():
    return current_app.config.get("GOOGLE_OAUTH") is not None


def back_to_login(result):
    return redirect("/login?" + urlencode({"google": result}))


def resolve_user(db_session, claims):
    """The account for these verified ID-token claims, and the result code.
    Returns (user or None, code). Creates a pending Responder for a new email."""
    if claims.get("email_verified") is not True:  # a string "true" or a missing claim isn't enough
        return None, UNVERIFIED
    email = accounts.normalise_email(claims.get("email"))
    if accounts.email_error(email):
        return None, FAILED

    user = accounts.find_user(db_session, email)
    if user is None:
        name = claims.get("name") if isinstance(claims.get("name"), str) else ""
        # The password is random and never shown, so this account signs in with Google
        # (or after a password reset by an administrator, if that's ever added)
        user = accounts.new_user(db_session, name.strip() or email.split("@")[0], email, "",
                                 secrets.token_urlsafe(32), role=ROLE_RESPONDER, status=STATUS_PENDING)
        accounts.audit(db_session, email, "google_signup", email, "pending responder")
        db_session.commit()
        return user, PENDING
    if user.status in (STATUS_PENDING, STATUS_REJECTED):
        return user, PENDING
    if user.status != STATUS_ACTIVE:
        return user, DISABLED
    return user, "ok"


@bp.get(LOGIN_PATH)
def start():
    if not enabled():
        return jsonify({"error": "Google sign-in isn't set up on this server."}), 404
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI") or url_for("google_auth.callback", _external=True)
    return current_app.config["GOOGLE_OAUTH"].google.authorize_redirect(redirect_uri)


@bp.get(CALLBACK_PATH)
def callback():
    if not enabled():
        return jsonify({"error": "Google sign-in isn't set up on this server."}), 404
    client = current_app.config["GOOGLE_OAUTH"].google
    try:
        # Checks state first, then exchanges the code and validates the ID token
        # (signature, issuer, audience, expiry and nonce)
        token = client.authorize_access_token()
    except (OAuthError, ValueError, KeyError):
        return back_to_login(FAILED)
    except Exception:  # Google unreachable, bad token signature, and so on
        current_app.logger.exception("Google sign-in failed")
        return back_to_login(FAILED)
    claims = token.get("userinfo") if isinstance(token, dict) else None
    if not claims:
        return back_to_login(FAILED)

    engine = current_app.config["DB_ENGINE"]
    with Session(engine) as db_session:
        user, result = resolve_user(db_session, dict(claims))
        user_id = user.id if user is not None else None
    if result != "ok":
        return back_to_login(result)
    security.start_login(engine, user_id)
    return redirect("/dashboard")
