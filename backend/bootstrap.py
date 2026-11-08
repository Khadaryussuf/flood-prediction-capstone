"""First start of a fresh database: create the demo accounts from environment
variables, so a new deployment can be logged into without a shell. Nothing is
hard-coded; with the variables unset, nothing is created.

  DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD          the administrator
  DEMO_RESPONDER_EMAIL, DEMO_RESPONDER_PASSWORD  a responder (optional)
  DEMO_ORGANISATION                              optional, default "Demo"

Runs only while the database has no accounts at all, so restarting never adds,
changes or resets anyone. The passwords follow the same rules as sign-up.
"""

import os

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend import accounts
from backend.db import ROLE_ADMIN, ROLE_RESPONDER, STATUS_ACTIVE, User

DEMO_ACCOUNTS = [
    ("DEMO_ADMIN", "Demo Administrator", ROLE_ADMIN),
    ("DEMO_RESPONDER", "Demo Responder", ROLE_RESPONDER),
]


def account_count(engine):
    with Session(engine) as session:
        return session.scalar(select(func.count()).select_from(User))


def seed_if_empty(engine, environ=None):
    """Create the demo accounts if there are no accounts yet. Returns the emails
    created. Raises ValueError if a given email or password breaks the rules."""
    environ = os.environ if environ is None else environ
    if account_count(engine):
        return []
    with Session(engine) as session:
        organisation = environ.get("DEMO_ORGANISATION", "").strip() or "Demo"
        created = []
        for prefix, name, role in DEMO_ACCOUNTS:
            email = environ.get(f"{prefix}_EMAIL", "").strip()
            password = environ.get(f"{prefix}_PASSWORD", "")
            if not email or not password:
                continue
            user = accounts.new_user(session, name, email, organisation, password, role=role, status=STATUS_ACTIVE)
            accounts.audit(session, "first-start", "create_user", user.email, f"role={role}")
            created.append(user.email)
        session.commit()  # all or nothing: a bad second account leaves no first one
        return created
