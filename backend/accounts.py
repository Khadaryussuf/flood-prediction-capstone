"""Account rules shared by the API and the account scripts. No Flask or TensorFlow
here, so the scripts can use it without loading the model."""

import re

from sqlalchemy import func, select
from werkzeug.security import generate_password_hash

from backend.db import (ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, STATUS_PENDING, AuditLog, User,
                        utcnow)

MIN_PASSWORD_LENGTH = 10
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(email):
    return email.strip().lower() if isinstance(email, str) else ""


def email_error(email):
    """An error message, or None if the (normalised) email is usable."""
    if not EMAIL_PATTERN.match(email) or len(email) > 254:
        return "Enter a valid email address."
    return None


def password_error(password, email):
    """An error message, or None if the password meets the policy."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if password.strip().lower() == email:
        return "Password must not be the same as your email."
    return None


def find_user(session, email):
    return session.scalar(select(User).where(User.email == email))


def new_user(session, name, email, organisation, password, role=ROLE_RESPONDER, status=STATUS_PENDING):
    """Add a user after the checks above. Raises ValueError with a readable message."""
    email = normalise_email(email)
    error = email_error(email) or password_error(password, email)
    if error:
        raise ValueError(error)
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Enter your name.")
    if find_user(session, email):
        raise ValueError("That email is already registered.")
    user = User(
        name=name.strip()[:120],
        email=email,
        organisation=(organisation.strip() if isinstance(organisation, str) else "")[:160],
        password_hash=generate_password_hash(password),
        role=role,
        status=status,
        created_at=utcnow(),
    )
    session.add(user)
    session.flush()
    return user


def active_admin_count(session):
    query = select(func.count()).select_from(User).where(
        User.role == ROLE_ADMIN, User.status == STATUS_ACTIVE)
    return session.scalar(query)


def audit(session, actor_email, action, target="", detail=""):
    session.add(AuditLog(at=utcnow(), actor_email=actor_email, action=action,
                         target=target, detail=detail))


__all__ = ["ROLE_ADMIN", "ROLE_RESPONDER", "active_admin_count", "audit", "email_error",
           "find_user", "new_user", "normalise_email", "password_error"]
