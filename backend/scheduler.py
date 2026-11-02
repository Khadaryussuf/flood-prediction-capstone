"""The hourly refresh, as a plain background thread inside Flask."""

import logging
import threading
from datetime import timedelta

from backend import db, live

log = logging.getLogger(__name__)

RETRY_AFTER_FAILURE_SECONDS = 600
MINUTES_PAST_THE_HOUR = 2  # give the forecast API time to publish the new hour


def seconds_until_next_run(now=None):
    now = now or db.utcnow()
    next_run = now.replace(minute=MINUTES_PAST_THE_HOUR, second=0, microsecond=0)
    if next_run <= now:
        next_run += timedelta(hours=1)
    return (next_run - now).total_seconds()


def run_once(app):
    """One refresh that can't take the thread down. Returns seconds to wait."""
    try:
        if live.refresh(app) is None:
            return RETRY_AFTER_FAILURE_SECONDS
    except Exception:  # a bug here must not stop later hours from running
        log.exception("Live refresh failed")
        return RETRY_AFTER_FAILURE_SECONDS
    return seconds_until_next_run()


def start(app):
    """Refresh now, then every hour. Returns the event that stops the thread."""
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            stop.wait(run_once(app))

    threading.Thread(target=loop, name="floodwatch-scheduler", daemon=True).start()
    return stop
