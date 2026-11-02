"""Database tables and connection. SQLite by default; DATABASE_URL can change it.

All times in the tables added for FloodWatch are naive UTC, from utcnow().
"""

import json
import os
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from backend.env import load_env
from pipeline import config

# Used when the DATABASE_URL environment variable is not set.
# The .db file is git-ignored.
DEFAULT_DATABASE_URL = "sqlite:///" + (config.ROOT / "data" / "predictions.db").as_posix()

ROLE_RESPONDER = "responder"
ROLE_ADMIN = "admin"
STATUS_PENDING = "pending"
STATUS_ACTIVE = "active"
STATUS_REJECTED = "rejected"
STATUS_DISABLED = "disabled"


def utcnow():
    """The current time as naive UTC. Tests replace this to move the clock."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def make_engine(database_url=None):
    """Connect and create any missing tables. Existing tables aren't altered."""
    load_env()
    url = database_url or os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    return engine


class Base(DeclarativeBase):
    pass


class Prediction(Base):
    """One row per prediction made by /predict."""
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    input_json: Mapped[str] = mapped_column(Text)  # the 24 readings as JSON
    predicted_mm: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "input": json.loads(self.input_json),
            "predicted_mm": self.predicted_mm,
            "risk_level": self.risk_level,
        }


class User(Base):
    """An account. Rows are never deleted; "remove" means disabled."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)  # lower-case
    organisation: Mapped[str] = mapped_column(String(160), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=ROLE_RESPONDER)
    status: Mapped[str] = mapped_column(String(20), default=STATUS_PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    def to_dict(self):
        """What the API may show. Never includes the password hash."""
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "organisation": self.organisation,
            "role": self.role,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "last_login_at": self.last_login_at.isoformat() if self.last_login_at else None,
        }


class AuthSession(Base):
    """Server-side record of a login, so logging out really ends it: the signed
    cookie only carries this row's random id."""
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class LoginThrottle(Base):
    """Failed logins per email, for the lockout. Works for unknown emails too,
    so the lockout doesn't reveal which accounts exist."""
    __tablename__ = "login_throttle"

    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    first_failure_at: Mapped[datetime] = mapped_column(DateTime)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AppSetting(Base):
    """Settings changed in the app, such as threshold overrides. Values are JSON."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class LiveSnapshot(Base):
    """One attempt to fetch live data. Failed attempts are kept (ok=False) so the
    dashboard can say it is showing the last good reading."""
    __tablename__ = "live_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)
    ok: Mapped[bool] = mapped_column(Boolean)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # Nairobi time
    window_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    forecast_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    predicted_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(String(20), nullable=True)


class RiskHistory(Base):
    """The model's prediction for each hour, for the Historical page."""
    __tablename__ = "risk_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_time: Mapped[datetime] = mapped_column(DateTime, unique=True, index=True)  # Nairobi time
    predicted_mm: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))
    source: Mapped[str] = mapped_column(String(20))  # live or backfill
    created_at: Mapped[datetime] = mapped_column(DateTime)


class AuditLog(Base):
    """Administrator actions: who did what, and when."""
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, index=True)
    actor_email: Mapped[str] = mapped_column(String(254))
    action: Mapped[str] = mapped_column(String(60))
    target: Mapped[str] = mapped_column(String(254), default="")
    detail: Mapped[str] = mapped_column(Text, default="")

    def to_dict(self):
        return {
            "id": self.id,
            "at": self.at.isoformat(),
            "actor": self.actor_email,
            "action": self.action,
            "target": self.target,
            "detail": self.detail,
        }
