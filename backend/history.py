"""Historical predictions, and the administrators' threshold settings."""

import csv
import io
import math
from datetime import timedelta

from flask import Blueprint, Response, current_app, g, jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import accounts, alerts, db, live, security, thresholds as limits
from backend.db import RiskHistory
from pipeline import config

bp = Blueprint("history", __name__)

RANGES = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}
PREVIEW_DAYS = 30
MAX_THRESHOLD_MM = 1000
MAX_COOLDOWN_HOURS = 48


def engine():
    return current_app.config["DB_ENGINE"]


def rows_since(session, span):
    """History rows for the last span of Nairobi time, oldest first."""
    cutoff = db.utcnow() + live.NAIROBI_OFFSET - span
    query = select(RiskHistory).where(RiskHistory.target_time >= cutoff).order_by(RiskHistory.target_time)
    return session.scalars(query).all()


def chosen_range():
    return request.args.get("range", "24h")


@bp.get("/api/history")
def history():
    key = chosen_range()
    if key not in RANGES:
        return jsonify({"error": "range must be 24h, 7d or 30d"}), 400
    with Session(engine()) as session:
        rows = rows_since(session, RANGES[key])
        return jsonify({
            "range": key,
            "thresholds": limits.thresholds_payload(limits.current_thresholds(session)),
            "highest_risk": config.HIGHEST_RISK,
            "rows": [{"time": row.target_time.isoformat(), "predicted_mm": row.predicted_mm,
                      "risk_level": row.risk_level, "source": row.source} for row in rows],
        })


@bp.get("/api/history.csv")
def history_csv():
    key = chosen_range()
    if key not in RANGES:
        return jsonify({"error": "range must be 24h, 7d or 30d"}), 400
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(["time_nairobi", "predicted_mm", "risk_level", "source"])
    with Session(engine()) as session:
        for row in rows_since(session, RANGES[key]):
            writer.writerow([row.target_time.isoformat(), row.predicted_mm, row.risk_level, row.source])
    return Response(buffer.getvalue(), mimetype="text/csv", headers={
        "Content-Disposition": f"attachment; filename=floodwatch-predictions-{key}.csv"})


def number(value):
    """A real, finite number, or None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def parse_settings(data):
    """Returns (thresholds, cooldown_hours, error)."""
    medium_from = number(data.get("medium_from"))
    high_from = number(data.get("high_from"))
    cooldown = number(data.get("cooldown_hours"))
    if medium_from is None or high_from is None or cooldown is None:
        return None, None, "Enter numbers for both limits and the cool-down."
    if not 0 < medium_from < high_from <= MAX_THRESHOLD_MM:
        return None, None, f"Medium must be above 0 and below High, and High at most {MAX_THRESHOLD_MM} mm."
    if not 0 <= cooldown <= MAX_COOLDOWN_HOURS:
        return None, None, f"Cool-down must be between 0 and {MAX_COOLDOWN_HOURS} hours."
    labels = [label for _, label in limits.default_thresholds()]
    return [(medium_from, labels[0]), (high_from, labels[1])], cooldown, None


def settings_payload(session):
    current = limits.current_thresholds(session)
    defaults = limits.default_thresholds()
    return {
        "medium_from": current[0][0],
        "high_from": current[1][0],
        "cooldown_hours": limits.get_setting(session, limits.COOLDOWN_KEY, limits.DEFAULT_COOLDOWN_HOURS),
        "default_medium_from": defaults[0][0],
        "default_high_from": defaults[1][0],
        "overridden": limits.is_overridden(session),
    }


@bp.get("/api/admin/thresholds")
@security.admin_required
def read_thresholds():
    with Session(engine()) as session:
        return jsonify(settings_payload(session))


@bp.post("/api/admin/thresholds/preview")
@security.admin_required
def preview_thresholds():
    """How many alerts these limits would have raised over the last 30 days of
    predictions. Changes nothing."""
    thresholds, cooldown, error = parse_settings(body())
    if error:
        return jsonify({"error": error}), 400
    with Session(engine()) as session:
        rows = rows_since(session, timedelta(days=PREVIEW_DAYS))
        pairs = [(row.target_time, row.predicted_mm) for row in rows]
    levels = [limits.classify(mm, thresholds) for _, mm in pairs]
    return jsonify({
        "days": PREVIEW_DAYS,
        "hours_checked": len(pairs),
        "alerts": alerts.count_alerts(pairs, thresholds, cooldown),
        "medium_hours": levels.count(thresholds[1][1]),
        "high_hours": levels.count(config.HIGHEST_RISK),
        "highest_prediction_mm": max((mm for _, mm in pairs), default=None),
    })


def body():
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


@bp.put("/api/admin/thresholds")
@security.admin_required
def save_thresholds():
    thresholds, cooldown, error = parse_settings(body())
    if error:
        return jsonify({"error": error}), 400
    with Session(engine()) as session:
        limits.set_setting(session, limits.THRESHOLDS_KEY, thresholds)
        limits.set_setting(session, limits.COOLDOWN_KEY, cooldown)
        accounts.audit(session, g.user.email, "set_thresholds", "",
                       f"medium from {thresholds[0][0]} mm, high from {thresholds[1][0]} mm, cool-down {cooldown} h")
        session.commit()
        return jsonify(settings_payload(session))


@bp.delete("/api/admin/thresholds")
@security.admin_required
def reset_thresholds():
    """Back to the defaults in pipeline/config.py."""
    with Session(engine()) as session:
        limits.clear_setting(session, limits.THRESHOLDS_KEY)
        limits.clear_setting(session, limits.COOLDOWN_KEY)
        accounts.audit(session, g.user.email, "reset_thresholds")
        session.commit()
        return jsonify(settings_payload(session))
