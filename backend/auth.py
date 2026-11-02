"""Login, sign-up and the administrators' user management and activity log."""

import secrets
from datetime import timedelta

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.security import check_password_hash, generate_password_hash

from backend import accounts, db, security
from backend.db import (ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, STATUS_DISABLED, STATUS_PENDING,
                        STATUS_REJECTED, AuditLog, LoginThrottle, User)

bp = Blueprint("auth", __name__)

MAX_FAILED_LOGINS = 5
FAILURE_WINDOW = timedelta(minutes=10)
LOCK_DURATION = timedelta(minutes=10)

BAD_CREDENTIALS = "Incorrect email or password."
AWAITING_APPROVAL = "Your account is awaiting approval by an administrator."
ACCOUNT_DISABLED = "This account has been disabled. Contact an administrator."
LOCKED_OUT = "Too many failed attempts. Try again in 10 minutes."

# Checked when the email is unknown, so that case takes as long as a wrong password
DUMMY_HASH = generate_password_hash(secrets.token_hex(16))


def engine():
    return current_app.config["DB_ENGINE"]


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


# ---- Login ---------------------------------------------------------------

def is_locked(db_session, email):
    row = db_session.get(LoginThrottle, email)
    return bool(row and row.locked_until and row.locked_until > db.utcnow())


def record_failure(db_session, email):
    now = db.utcnow()
    row = db_session.get(LoginThrottle, email)
    if row is None or now - row.first_failure_at > FAILURE_WINDOW:
        if row is not None:
            db_session.delete(row)
            db_session.flush()
        row = LoginThrottle(email=email, failures=0, first_failure_at=now)
        db_session.add(row)
    row.failures += 1
    if row.failures >= MAX_FAILED_LOGINS:
        row.locked_until = now + LOCK_DURATION
        row.failures = 0
        row.first_failure_at = now
    db_session.commit()


@bp.get("/api/auth/session")
def auth_session():
    user = g.user.to_dict() if g.user else None
    return jsonify({"user": user, "csrf_token": security.csrf_token()})


@bp.post("/api/auth/login")
def login():
    data = body()
    email = accounts.normalise_email(data.get("email"))
    password = data.get("password")
    if not isinstance(password, str):
        password = ""

    with Session(engine()) as db_session:
        if is_locked(db_session, email):
            return jsonify({"error": LOCKED_OUT}), 429

        user = accounts.find_user(db_session, email)
        correct = check_password_hash(user.password_hash if user else DUMMY_HASH, password)
        if not user or not correct:
            record_failure(db_session, email)
            if is_locked(db_session, email):
                return jsonify({"error": LOCKED_OUT}), 429
            return jsonify({"error": BAD_CREDENTIALS}), 401

        # Status is only revealed to someone who knows the password
        if user.status in (STATUS_PENDING, STATUS_REJECTED):
            return jsonify({"error": AWAITING_APPROVAL, "code": "awaiting_approval"}), 403
        if user.status != STATUS_ACTIVE:
            return jsonify({"error": ACCOUNT_DISABLED, "code": "disabled"}), 403

        user_id = user.id
        row = db_session.get(LoginThrottle, email)
        if row:
            db_session.delete(row)
            db_session.commit()

    security.start_login(engine(), user_id)
    with Session(engine()) as db_session:
        fresh = db_session.get(User, user_id).to_dict()
    return jsonify({"user": fresh, "csrf_token": security.csrf_token()})


@bp.post("/api/auth/logout")
def logout():
    security.end_login(engine())
    return jsonify({"status": "logged out", "csrf_token": security.csrf_token()})


@bp.post("/api/auth/signup")
def signup():
    """Creates a pending Responder. Any role or status in the request is ignored."""
    data = body()
    confirm = data.get("confirm_password")
    if confirm is not None and confirm != data.get("password"):
        return jsonify({"error": "The passwords don't match."}), 400
    with Session(engine()) as db_session:
        try:
            user = accounts.new_user(db_session, data.get("name"), data.get("email"),
                                     data.get("organisation"), data.get("password"),
                                     role=ROLE_RESPONDER, status=STATUS_PENDING)
        except ValueError as error:
            status = 409 if "already registered" in str(error) else 400
            return jsonify({"error": str(error)}), status
        db_session.commit()
        return jsonify({"status": user.status,
                        "message": "Account created. An administrator must approve it before you can log in."}), 201


# ---- Administrators: users ----------------------------------------------

@bp.get("/api/admin/users")
@security.admin_required
def list_users():
    with Session(engine()) as db_session:
        users = db_session.scalars(select(User).order_by(User.created_at.desc(), User.id.desc())).all()
        return jsonify([user.to_dict() for user in users])


@bp.post("/api/admin/users")
@security.admin_required
def add_user():
    """An administrator adds an account directly, active from the start."""
    data = body()
    role = data.get("role", ROLE_RESPONDER)
    if role not in (ROLE_RESPONDER, ROLE_ADMIN):
        return jsonify({"error": "Role must be responder or admin."}), 400
    with Session(engine()) as db_session:
        try:
            user = accounts.new_user(db_session, data.get("name"), data.get("email"),
                                     data.get("organisation"), data.get("password"),
                                     role=role, status=STATUS_ACTIVE)
        except ValueError as error:
            status = 409 if "already registered" in str(error) else 400
            return jsonify({"error": str(error)}), status
        accounts.audit(db_session, g.user.email, "create_user", user.email, f"role={role}")
        db_session.commit()
        return jsonify(user.to_dict()), 201


def change_refused(db_session, user, action, new_role):
    """The reason a change isn't allowed, or None."""
    removes_admin = action in ("disable", "reject") or (action == "set_role" and new_role != ROLE_ADMIN)
    if user.id == g.user.id and removes_admin:
        return "You can't disable or demote your own account."
    is_active_admin = user.role == ROLE_ADMIN and user.status == STATUS_ACTIVE
    if removes_admin and is_active_admin and accounts.active_admin_count(db_session) <= 1:
        return "This is the last active administrator."
    return None


@bp.patch("/api/admin/users/<int:user_id>")
@security.admin_required
def change_user(user_id):
    """action: approve, reject, disable, enable or set_role (with role)."""
    data = body()
    action = data.get("action")
    new_role = data.get("role")
    if action not in ("approve", "reject", "disable", "enable", "set_role"):
        return jsonify({"error": "Unknown action."}), 400
    if action == "set_role" and new_role not in (ROLE_RESPONDER, ROLE_ADMIN):
        return jsonify({"error": "Role must be responder or admin."}), 400

    with Session(engine()) as db_session:
        user = db_session.get(User, user_id)
        if user is None:
            return jsonify({"error": "User not found."}), 404
        refused = change_refused(db_session, user, action, new_role)
        if refused:
            return jsonify({"error": refused}), 409

        detail = ""
        if action == "approve":
            if user.status not in (STATUS_PENDING, STATUS_REJECTED):
                return jsonify({"error": "Only pending or rejected accounts can be approved."}), 409
            user.status = STATUS_ACTIVE
        elif action == "reject":
            if user.status != STATUS_PENDING:
                return jsonify({"error": "Only pending accounts can be rejected."}), 409
            user.status = STATUS_REJECTED
        elif action == "disable":
            if user.status != STATUS_ACTIVE:
                return jsonify({"error": "Only active accounts can be disabled."}), 409
            user.status = STATUS_DISABLED
            security.revoke_sessions(db_session, user.id)
        elif action == "enable":
            if user.status != STATUS_DISABLED:
                return jsonify({"error": "Only disabled accounts can be enabled."}), 409
            user.status = STATUS_ACTIVE
        else:
            detail = f"{user.role} -> {new_role}"
            user.role = new_role

        accounts.audit(db_session, g.user.email, action, user.email, detail)
        db_session.commit()
        return jsonify(user.to_dict())


@bp.get("/api/admin/audit")
@security.admin_required
def audit_log():
    with Session(engine()) as db_session:
        rows = db_session.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(200)).all()
        return jsonify([row.to_dict() for row in rows])
