"""Live data: the Open-Meteo forecast API, run through the same prediction path as
/predict. The scheduler in backend/scheduler.py calls refresh() every hour.

These inputs differ from the ERA5 data the model was trained on, and the dashboard
says so. The model's risk applies to this one grid cell only.
"""

import json
import logging
import time
from datetime import timedelta

import pandas as pd
import requests
from flask import Blueprint, current_app, jsonify
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import alerts, db, security, thresholds as limits
from backend.db import LiveSnapshot, RiskHistory
from pipeline import config

bp = Blueprint("live", __name__)
log = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_SECONDS = 20
MAX_ATTEMPTS = 3
RETRY_WAIT_SECONDS = 5
# Live until the scheduler has missed its hourly run by a good margin
LIVE_MAX_AGE = timedelta(minutes=90)
BACKFILL_DAYS = 31
FORECAST_HOURS = 12
NAIROBI_OFFSET = timedelta(hours=3)  # Kenya has no daylight saving
SOURCE_NOTE = ("Inputs: Open-Meteo forecast data for one grid cell. These differ from the "
               "ERA5 data the model was trained on, so treat this as indicative.")


class LiveDataError(Exception):
    """The forecast API gave no usable data."""


def fetch(params):
    """One forecast API call, with retries. Raises LiveDataError if all fail."""
    last_error = "unknown"
    for attempt in range(MAX_ATTEMPTS):
        if attempt:
            time.sleep(RETRY_WAIT_SECONDS * attempt)
        try:
            response = requests.get(FORECAST_URL, params=params, timeout=TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.json()
        except (requests.RequestException, ValueError) as error:
            last_error = type(error).__name__
    raise LiveDataError(f"Forecast API failed after {MAX_ATTEMPTS} attempts ({last_error})")


def base_params():
    return {"latitude": config.LATITUDE, "longitude": config.LONGITUDE,
            "timezone": config.TIMEZONE, "hourly": ",".join(config.FEATURES)}


def hourly_frame(payload):
    """The response's hourly block as a table indexed by Nairobi time. Gaps are
    filled the same way as in preprocess.py."""
    try:
        hourly = payload["hourly"]
        frame = pd.DataFrame(hourly)
        frame["time"] = pd.to_datetime(frame["time"])
        frame = frame.set_index("time")[config.FEATURES].astype(float)
    except (KeyError, TypeError, ValueError) as error:
        raise LiveDataError(f"Forecast API response not usable ({type(error).__name__})") from error
    return frame.interpolate(method="linear", limit_direction="both")


def fetch_latest():
    """Returns (window of 24 hours ending at the current hour, the forecast hours after it)."""
    payload = fetch({**base_params(), "past_hours": config.WINDOW,
                     "forecast_hours": FORECAST_HOURS + 1, "current": config.TARGET})
    frame = hourly_frame(payload)
    try:
        current = pd.Timestamp(payload["current"]["time"]).floor("h")
        end = frame.index.get_loc(current)
    except (KeyError, TypeError, ValueError) as error:
        raise LiveDataError("Forecast API response has no usable current time") from error
    window = frame.iloc[end - config.WINDOW + 1:end + 1]
    forecast = frame.iloc[end + 1:end + 1 + FORECAST_HOURS]
    if len(window) != config.WINDOW or window[config.FEATURES].isna().any(axis=None) or forecast.empty:
        raise LiveDataError("Forecast API returned too few complete hours")
    return window, forecast


def rows_with_time(frame, columns=None):
    frame = frame[columns] if columns else frame
    return [{"time": index.isoformat(), **row} for index, row in zip(frame.index, frame.to_dict(orient="records"))]


def save_history(session, target_time, predicted_mm, level, source):
    row = session.scalar(select(RiskHistory).where(RiskHistory.target_time == target_time))
    if row is None:
        row = RiskHistory(target_time=target_time, created_at=db.utcnow())
        session.add(row)
    row.predicted_mm = predicted_mm
    row.risk_level = level
    row.source = source
    return row


def refresh(app):
    """Fetch, predict and store. On failure records it, and the last good reading
    stays in use. Returns the new snapshot's id, or None on failure."""
    engine = app.config["DB_ENGINE"]
    try:
        window, forecast = fetch_latest()
        backfill_if_empty(app)
        predicted_mm = app.config["PREDICT_MM"](window[config.FEATURES])
    except LiveDataError as error:
        with Session(engine) as session:
            session.add(LiveSnapshot(fetched_at=db.utcnow(), ok=False, error=str(error)))
            session.commit()
        return None

    target_time = (window.index[-1] + pd.Timedelta(hours=1)).to_pydatetime()
    with Session(engine) as session:
        level = limits.classify(predicted_mm, limits.current_thresholds(session))
        snapshot = LiveSnapshot(
            fetched_at=db.utcnow(), ok=True, target_time=target_time,
            window_json=json.dumps(rows_with_time(window)),
            forecast_json=json.dumps(rows_with_time(forecast, [config.TARGET])),
            predicted_mm=predicted_mm, risk_level=level,
        )
        session.add(snapshot)
        save_history(session, target_time, predicted_mm, level, "live")
        session.commit()
        snapshot_id = snapshot.id
    # Hours missed while the computer slept or the server was off. A problem here
    # mustn't lose the reading either
    try:
        fill_gaps(app, target_time)
    except Exception:
        log.exception("Filling missed hours failed")
    # A problem with alerting mustn't lose the reading
    try:
        alerts.process_prediction(engine, level, predicted_mm, target_time)
    except Exception:
        log.exception("Alert processing failed")
    return snapshot_id


def backfill_if_empty(app):
    """On first run, fills about 30 days of history by running the model over past
    forecast-API data, so the Historical page and threshold preview have something
    to show. These rows are marked "backfill" and never raise alerts."""
    engine = app.config["DB_ENGINE"]
    with Session(engine) as session:
        if session.scalar(select(RiskHistory).limit(1)) is not None:
            return 0
    payload = fetch({**base_params(), "past_days": BACKFILL_DAYS, "forecast_days": 1})
    frame = hourly_frame(payload)
    now_local = pd.Timestamp(db.utcnow() + NAIROBI_OFFSET).floor("h")
    frame = frame[frame.index <= now_local]
    windows = [frame.iloc[i - config.WINDOW:i] for i in range(config.WINDOW, len(frame))]
    if not windows:
        return 0
    predictions = app.config["PREDICT_MANY"]([w[config.FEATURES] for w in windows])
    with Session(engine) as session:
        thresholds = limits.current_thresholds(session)
        for window, mm in zip(windows, predictions):
            session.add(RiskHistory(
                target_time=(window.index[-1] + pd.Timedelta(hours=1)).to_pydatetime(),
                predicted_mm=mm, risk_level=limits.classify(mm, thresholds),
                source="backfill", created_at=db.utcnow()))
        session.commit()
    return len(windows)


def missing_hours(session, target_time):
    """Hours with no prediction between the first stored hour (or BACKFILL_DAYS
    back, if later) and target_time, oldest first."""
    earliest = target_time - timedelta(days=BACKFILL_DAYS)
    stored = set(session.scalars(select(RiskHistory.target_time).where(
        RiskHistory.target_time >= earliest, RiskHistory.target_time < target_time)))
    if not stored:
        return []  # nothing to measure a gap from; backfill_if_empty fills a new database
    hour, missing = min(stored), []
    while hour < target_time:
        if hour not in stored:
            missing.append(hour)
        hour += timedelta(hours=1)
    return missing


def fill_gaps(app, target_time):
    """Predict the hours the hourly run missed, from the forecast API's past data,
    on the same path as backfill_if_empty. Marked "backfill", so they never raise
    alerts: those hours are already over. Returns how many hours were filled."""
    engine = app.config["DB_ENGINE"]
    with Session(engine) as session:
        missing = missing_hours(session, target_time)
    if not missing:
        return 0
    hours_back = int((target_time - missing[0]) / timedelta(hours=1)) + config.WINDOW + 1
    frame = hourly_frame(fetch({**base_params(), "past_hours": hours_back, "forecast_hours": 1}))
    windows, targets = [], []
    for hour in missing:
        window = frame[(frame.index >= hour - timedelta(hours=config.WINDOW)) & (frame.index < hour)]
        if len(window) == config.WINDOW and not window[config.FEATURES].isna().any(axis=None):
            windows.append(window[config.FEATURES])
            targets.append(hour)
    if not windows:
        return 0
    predictions = app.config["PREDICT_MANY"](windows)
    with Session(engine) as session:
        thresholds = limits.current_thresholds(session)
        for hour, mm in zip(targets, predictions):
            if session.scalar(select(RiskHistory).where(RiskHistory.target_time == hour)) is None:
                session.add(RiskHistory(target_time=hour, predicted_mm=mm,
                                        risk_level=limits.classify(mm, thresholds),
                                        source="backfill", created_at=db.utcnow()))
        session.commit()
    log.info("Filled %d missed hours", len(targets))
    return len(targets)


def freshness(snapshot, last_attempt_ok):
    """Live: recent data from a working feed. Fallback: the latest fetch failed, so
    this is the last good reading. Stale: nothing failed, but it's too old."""
    if snapshot is None:
        return "Unavailable"
    if not last_attempt_ok:
        return "Fallback"
    return "Live" if db.utcnow() - snapshot.fetched_at <= LIVE_MAX_AGE else "Stale"


def to_local(moment):
    return (moment + NAIROBI_OFFSET).isoformat()


@bp.get("/api/live/current")
def current():
    engine = current_app.config["DB_ENGINE"]
    with Session(engine) as session:
        latest = session.scalar(select(LiveSnapshot).order_by(LiveSnapshot.id.desc()).limit(1))
        good = session.scalar(select(LiveSnapshot).where(LiveSnapshot.ok.is_(True))
                              .order_by(LiveSnapshot.id.desc()).limit(1))
        thresholds = limits.current_thresholds(session)
        body = {
            "freshness": freshness(good, bool(latest and latest.ok)),
            "thresholds": limits.thresholds_payload(thresholds),
            "highest_risk": config.HIGHEST_RISK,
            "thresholds_overridden": limits.is_overridden(session),
            "source_note": SOURCE_NOTE,
            "timezone": config.TIMEZONE,
            "last_error": latest.error if latest and not latest.ok else None,
            "alert": alerts.latest_banner(session),
        }
        if good is None:
            return jsonify({**body, "last_updated": None, "target_time": None, "predicted_mm": None,
                            "risk_level": None, "window": [], "forecast": []})
        return jsonify({
            **body,
            "last_updated": to_local(good.fetched_at),
            "target_time": good.target_time.isoformat(),
            "predicted_mm": good.predicted_mm,
            "risk_level": limits.classify(good.predicted_mm, thresholds),
            "window": json.loads(good.window_json),
            "forecast": json.loads(good.forecast_json),
        })


@bp.post("/api/admin/live/refresh")
@security.admin_required
def manual_refresh():
    """An administrator can ask for a refresh now instead of waiting for the hour."""
    snapshot_id = refresh(current_app._get_current_object())
    return jsonify({"ok": snapshot_id is not None}), 200 if snapshot_id else 502
