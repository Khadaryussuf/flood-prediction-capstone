"""The alert engine: in-app and email alerts on Medium or High, with a cool-down.

One row per recipient, with its delivery status. If email isn't configured, the
row says so and everything carries on. SMTP settings only come from the
environment or the git-ignored .env file.
"""

import logging
import os
import smtplib
from datetime import timedelta
from email.message import EmailMessage

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend import db, thresholds as limits
from backend.db import ROLE_ADMIN, STATUS_ACTIVE, AlertDelivery, AlertEvent, User

bp = Blueprint("alerts", __name__)
log = logging.getLogger(__name__)

NOT_CONFIGURED = "not sent: email not configured"
SENT = "sent"
SMTP_TIMEOUT_SECONDS = 10
BANNER_HOURS = 6  # how long the Dashboard mentions an alert
LEVEL_RANK = {"low": 0, "moderate": 1, "high": 2}
LEVEL_LABEL = {"low": "Low", "moderate": "Medium", "high": "High"}
NAIROBI_OFFSET = timedelta(hours=3)
DISCLAIMER = ("Risk level is hourly rainfall intensity (AMS classes), not flood probability, "
              "and is not calibrated to Nairobi flood records.")


def smtp_settings():
    """The SMTP settings, or None if email isn't configured."""
    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER")
    if not host or not sender:
        return None
    return {"host": host, "port": int(os.environ.get("SMTP_PORT") or 587), "sender": sender,
            "user": os.environ.get("SMTP_USER"), "password": os.environ.get("SMTP_PASSWORD")}


def send_email(settings, recipient, level, predicted_mm, target_time):
    """Send one alert. Returns a delivery status; never raises and never includes
    server responses or credentials in the status."""
    if settings is None:
        return NOT_CONFIGURED
    label = LEVEL_LABEL.get(level, level)
    message = EmailMessage()
    message["Subject"] = f"FloodWatch alert: {label} rainfall intensity expected"
    message["From"] = settings["sender"]
    message["To"] = recipient
    message.set_content(
        f"FloodWatch predicts {predicted_mm:.2f} mm of rain in the hour to "
        f"{target_time:%d %b %Y, %H:%M} (Nairobi time). Risk level: {label}.\n\n"
        f"Log in to FloodWatch to see details and acknowledge this alert.\n\n{DISCLAIMER}\n"
    )
    try:
        client_class = smtplib.SMTP_SSL if settings["port"] == 465 else smtplib.SMTP
        with client_class(settings["host"], settings["port"], timeout=SMTP_TIMEOUT_SECONDS) as client:
            if settings["port"] != 465:
                client.starttls()
            if settings["user"] and settings["password"]:
                client.login(settings["user"], settings["password"])
            client.send_message(message)
    except (smtplib.SMTPException, OSError) as error:
        return f"failed: {type(error).__name__}"
    return SENT


def cooldown_allows(level, last_level, last_at, now, cooldown_hours):
    """A repeat inside the cool-down is held back, unless the level has risen."""
    if last_at is None:
        return True
    if now - last_at >= timedelta(hours=cooldown_hours):
        return True
    return LEVEL_RANK.get(level, 0) > LEVEL_RANK.get(last_level, 0)


def process_prediction(engine, level, predicted_mm, target_time):
    """Raise an alert for a live prediction if it needs one. Returns the event id or None."""
    if LEVEL_RANK.get(level, 1) < 1:
        return None
    now = db.utcnow()
    with Session(engine) as session:
        last = session.scalar(select(AlertEvent).order_by(AlertEvent.id.desc()).limit(1))
        cooldown = limits.get_setting(session, limits.COOLDOWN_KEY, limits.DEFAULT_COOLDOWN_HOURS)
        if not cooldown_allows(level, last.risk_level if last else None,
                               last.created_at if last else None, now, cooldown):
            return None
        event = AlertEvent(created_at=now, risk_level=level, predicted_mm=predicted_mm, target_time=target_time)
        session.add(event)
        session.flush()
        recipients = session.scalars(select(User).where(User.status == STATUS_ACTIVE).order_by(User.id)).all()
        settings = smtp_settings()
        for user in recipients:
            status = send_email(settings, user.email, level, predicted_mm, target_time)
            session.add(AlertDelivery(event_id=event.id, user_id=user.id, recipient_email=user.email,
                                      recipient_name=user.name, delivery_status=status))
        session.commit()
        return event.id


def count_alerts(rows, thresholds, cooldown_hours):
    """How many alerts these (time, mm) rows would raise under these limits, using
    the real cool-down rule. For the Settings preview."""
    count = 0
    last_level = last_at = None
    for moment, mm in rows:
        level = limits.classify(mm, thresholds)
        if LEVEL_RANK.get(level, 1) >= 1 and cooldown_allows(level, last_level, last_at, moment, cooldown_hours):
            count += 1
            last_level, last_at = level, moment
    return count


def latest_banner(session):
    """The most recent alert, if recent enough to mention on the Dashboard."""
    event = session.scalar(select(AlertEvent).order_by(AlertEvent.id.desc()).limit(1))
    if event is None or db.utcnow() - event.created_at > timedelta(hours=BANNER_HOURS):
        return None
    deliveries = session.scalars(select(AlertDelivery).where(AlertDelivery.event_id == event.id)).all()
    return {
        "at": (event.created_at + NAIROBI_OFFSET).isoformat(),
        "risk_level": event.risk_level,
        "predicted_mm": event.predicted_mm,
        "target_time": event.target_time.isoformat(),
        "recipients": len(deliveries),
        "emails_sent": sum(1 for row in deliveries if row.delivery_status == SENT),
    }


def row_to_dict(delivery, event, user):
    return {
        "id": delivery.id,
        "at": (event.created_at + NAIROBI_OFFSET).isoformat(),
        "risk_level": event.risk_level,
        "predicted_mm": event.predicted_mm,
        "target_time": event.target_time.isoformat(),
        "recipient": delivery.recipient_name,
        "recipient_email": delivery.recipient_email,
        "delivery_status": delivery.delivery_status,
        "acknowledged_at": (delivery.acknowledged_at + NAIROBI_OFFSET).isoformat() if delivery.acknowledged_at else None,
        "acknowledged_by": delivery.acknowledged_by,
        "can_acknowledge": delivery.acknowledged_at is None and (user.role == ROLE_ADMIN or delivery.user_id == user.id),
    }


@bp.get("/api/alerts")
def list_alerts():
    """Newest first. q searches recipient, email, risk level and delivery status."""
    query = select(AlertDelivery, AlertEvent).join(AlertEvent, AlertDelivery.event_id == AlertEvent.id)
    term = request.args.get("q", "").strip().lower()
    if term:
        # People search for the label they see, "medium", which is stored as "moderate"
        levels = [level for level, label in LEVEL_LABEL.items() if term in label.lower() or term in level]
        like = f"%{term.replace('%', '').replace('_', '')}%"
        query = query.where(or_(func.lower(AlertDelivery.recipient_name).like(like),
                                func.lower(AlertDelivery.recipient_email).like(like),
                                func.lower(AlertDelivery.delivery_status).like(like),
                                AlertEvent.risk_level.in_(levels)))
    with Session(current_app.config["DB_ENGINE"]) as session:
        rows = session.execute(query.order_by(AlertDelivery.id.desc()).limit(200)).all()
        return jsonify([row_to_dict(delivery, event, g.user) for delivery, event in rows])


@bp.get("/api/alerts/unread")
def unread():
    """The bell's count: this user's alerts not yet acknowledged."""
    with Session(current_app.config["DB_ENGINE"]) as session:
        count = session.scalar(select(func.count()).select_from(AlertDelivery).where(
            AlertDelivery.user_id == g.user.id, AlertDelivery.acknowledged_at.is_(None)))
    return jsonify({"count": count})


@bp.post("/api/alerts/<int:delivery_id>/ack")
def acknowledge(delivery_id):
    """Your own alert, or anyone's if you are an administrator."""
    with Session(current_app.config["DB_ENGINE"]) as session:
        delivery = session.get(AlertDelivery, delivery_id)
        if delivery is None:
            return jsonify({"error": "Alert not found."}), 404
        if delivery.user_id != g.user.id and g.user.role != ROLE_ADMIN:
            return jsonify({"error": "This alert was sent to someone else."}), 403
        if delivery.acknowledged_at is None:
            delivery.acknowledged_at = db.utcnow()
            delivery.acknowledged_by = g.user.email
            session.commit()
        return jsonify({"status": "acknowledged", "acknowledged_by": delivery.acknowledged_by})
