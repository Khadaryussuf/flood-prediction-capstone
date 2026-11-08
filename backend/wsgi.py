"""Production entry: builds the app, creates the demo accounts on a fresh database,
starts the hourly scheduler once, and serves with waitress.

  python -m backend.wsgi

One process with several threads, on purpose: a second process would run its own
scheduler (two refreshes an hour) and two processes would fight over the SQLite
file. So scale with WAITRESS_THREADS, never with more processes.

Settings, read from the environment (or .env):
  PORT              default 8000
  HOST              default 0.0.0.0 (all interfaces, as a container needs)
  WAITRESS_THREADS  default 8
  DATA_DIR          if set and DATABASE_URL isn't: the database is
                    DATA_DIR/floodwatch.db (backend/db.py; the folder is created)
  plus everything create_app reads (SECRET_KEY, DATABASE_URL, TRUSTED_PROXIES,
  SMTP_*, GOOGLE_*) and bootstrap's DEMO_* accounts.

Local development is unchanged: python -m backend.app still serves on
127.0.0.1:5000 with Flask's own server.
"""

import logging
import os

from waitress import serve

from backend import bootstrap, scheduler
from backend.app import create_app
from backend.env import load_env

log = logging.getLogger("floodwatch")
DEFAULT_PORT = 8000
DEFAULT_THREADS = 8


def whole_number(name, default):
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    if not raw.isdigit() or int(raw) == 0:
        raise SystemExit(f"{name} must be a whole number above 0, not {raw!r}")
    return int(raw)


def build():
    """The app, ready to serve: accounts seeded on a fresh database, scheduler running."""
    load_env()
    app = create_app()
    try:
        created = bootstrap.seed_if_empty(app.config["DB_ENGINE"])
    except ValueError as error:
        raise SystemExit(f"Demo accounts not created: {error}") from error
    for email in created:
        log.info("Created demo account %s", email)
    if not created and not bootstrap.account_count(app.config["DB_ENGINE"]):
        log.warning("No accounts yet. Set DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD and restart, "
                    "or run: python -m scripts.create_admin")
    scheduler.start(app)
    return app


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    load_env()  # so PORT, HOST and WAITRESS_THREADS can come from .env too
    port = whole_number("PORT", DEFAULT_PORT)
    threads = whole_number("WAITRESS_THREADS", DEFAULT_THREADS)
    host = os.environ.get("HOST", "").strip() or "0.0.0.0"
    app = build()
    log.info("FloodWatch on http://%s:%s with %s threads", host, port, threads)
    serve(app, host=host, port=port, threads=threads)


if __name__ == "__main__":
    main()
