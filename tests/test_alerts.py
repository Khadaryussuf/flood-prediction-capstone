"""The alert engine and Alerts API. IDs match docs/TESTING.md (A1 onward)."""

import smtplib
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import alerts, db, live, thresholds as limits
from backend.db import ROLE_ADMIN, ROLE_RESPONDER, STATUS_DISABLED, STATUS_PENDING, AlertDelivery, AlertEvent
from tests.test_live import fake_payload, stub_api

TARGET = datetime(2026, 11, 2, 16)


@pytest.fixture(autouse=True)
def no_smtp_settings(monkeypatch):
    """No test may use the machine's real email settings."""
    for name in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def engine(app):
    return app.config["DB_ENGINE"]


def deliveries(engine):
    with Session(engine) as session:
        rows = session.scalars(select(AlertDelivery).order_by(AlertDelivery.id)).all()
        session.expunge_all()
        return rows


def event_count(engine):
    with Session(engine) as session:
        return len(session.scalars(select(AlertEvent)).all())


def raise_alert(engine, level="moderate", mm=4.0):
    return alerts.process_prediction(engine, level, mm, TARGET)


class FakeSMTP:
    """Records messages instead of sending. fail_for raises for those recipients."""
    sent = []
    logins = []
    fail_for = set()

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def starttls(self):
        pass

    def login(self, user, password):
        FakeSMTP.logins.append(user)

    def send_message(self, message):
        if message["To"] in FakeSMTP.fail_for:
            raise smtplib.SMTPRecipientsRefused({})
        FakeSMTP.sent.append(message)


@pytest.fixture
def smtp(monkeypatch, password):
    FakeSMTP.sent, FakeSMTP.logins, FakeSMTP.fail_for = [], [], set()
    monkeypatch.setattr(alerts.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setenv("SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("SMTP_USER", "floodwatch@example.org")
    monkeypatch.setenv("SMTP_PASSWORD", password)
    return FakeSMTP


# A1
@pytest.mark.parametrize("level,raised", [("low", False), ("moderate", True), ("high", True)])
def test_alert_only_on_medium_or_high(engine, make_user, level, raised):
    make_user()
    assert (raise_alert(engine, level) is not None) is raised
    assert event_count(engine) == (1 if raised else 0)


# A2
def test_one_row_per_active_recipient(engine, make_user):
    active = [make_user()[0], make_user()[0], make_user(role=ROLE_ADMIN)[0]]
    make_user(status=STATUS_PENDING)
    make_user(status=STATUS_DISABLED)
    raise_alert(engine)
    assert [row.recipient_email for row in deliveries(engine)] == active


# A3
def test_without_email_settings_it_records_that_and_carries_on(engine, make_user):
    make_user()
    assert raise_alert(engine) is not None
    assert deliveries(engine)[0].delivery_status == "not sent: email not configured"


# A4
def test_email_is_sent_with_status_and_disclaimer(engine, make_user, smtp):
    email, _ = make_user()
    raise_alert(engine, "moderate", 4.03)
    assert deliveries(engine)[0].delivery_status == "sent"
    message = smtp.sent[0]
    assert message["To"] == email
    assert "Medium" in message["Subject"] and "moderate" not in message["Subject"]
    body = message.get_content()
    assert "4.03 mm" in body and "not flood probability" in body
    assert smtp.logins == ["floodwatch@example.org"]


# A5
def test_a_failed_recipient_does_not_stop_the_others(engine, make_user, smtp):
    first, _ = make_user()
    second, _ = make_user()
    smtp.fail_for = {first}
    raise_alert(engine)
    assert [row.delivery_status for row in deliveries(engine)] == ["failed: SMTPRecipientsRefused", "sent"]
    assert [message["To"] for message in smtp.sent] == [second]


# A6
def test_an_unreachable_mail_server_is_recorded(engine, make_user, monkeypatch):
    make_user()
    monkeypatch.setenv("SMTP_HOST", "mail.example.org")
    monkeypatch.setenv("SMTP_USER", "floodwatch@example.org")

    def refuse(*args, **kwargs):
        raise ConnectionRefusedError("server said secret things")
    monkeypatch.setattr(alerts.smtplib, "SMTP", refuse)
    assert raise_alert(engine) is not None
    status = deliveries(engine)[0].delivery_status
    assert status == "failed: ConnectionRefusedError"
    assert "secret" not in status


# A7
def test_cool_down_holds_back_repeats(engine, make_user):
    make_user()
    assert raise_alert(engine) is not None
    assert raise_alert(engine) is None
    assert event_count(engine) == 1


# A8
def test_a_rise_in_level_breaks_through_the_cool_down(engine, make_user):
    make_user()
    raise_alert(engine, "moderate")
    assert raise_alert(engine, "high") is not None
    assert raise_alert(engine, "moderate") is None  # falling back isn't news
    assert raise_alert(engine, "high") is None
    assert event_count(engine) == 2


# A9
def test_alerts_again_after_the_cool_down(engine, make_user, monkeypatch):
    make_user()
    raise_alert(engine)
    real = db.utcnow
    monkeypatch.setattr(db, "utcnow", lambda: real() + timedelta(hours=limits.DEFAULT_COOLDOWN_HOURS, seconds=1))
    assert raise_alert(engine) is not None


# A10: through the real refresh path
def test_a_live_refresh_raises_the_alert(app, engine, make_user, real_window, monkeypatch):
    make_user()
    monkeypatch.setattr(live, "backfill_if_empty", lambda a: 0)
    monkeypatch.setattr(live.time, "sleep", lambda s: None)
    stub_api(monkeypatch, fake_payload(real_window))
    app.config["PREDICT_MM"] = lambda frame: 9.5
    assert live.refresh(app) is not None
    with Session(engine) as session:
        event = session.scalars(select(AlertEvent)).one()
        assert (event.risk_level, event.predicted_mm) == ("high", 9.5)


# A11
def test_a_low_refresh_raises_nothing(app, engine, make_user, real_window, monkeypatch):
    make_user()
    monkeypatch.setattr(live, "backfill_if_empty", lambda a: 0)
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    assert event_count(engine) == 0


# A12: a bug in alerting mustn't lose the reading
def test_alert_failure_does_not_lose_the_reading(app, client, real_window, monkeypatch):
    monkeypatch.setattr(live, "backfill_if_empty", lambda a: 0)
    stub_api(monkeypatch, fake_payload(real_window))

    def broken(*args):
        raise RuntimeError("bug")
    monkeypatch.setattr(alerts, "process_prediction", broken)
    assert live.refresh(app) is not None
    assert client.get("/api/live/current").get_json()["freshness"] == "Live"


# A13
def test_backfill_never_alerts(app, engine, make_user, real_window, monkeypatch):
    make_user()
    start = db.utcnow().replace(minute=0, second=0, microsecond=0) + live.NAIROBI_OFFSET
    times = [start - timedelta(hours=h) for h in range(30, -1, -1)]
    rows = (list(real_window) * 2)[:len(times)]
    hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
    for feature in rows[0]:
        hourly[feature] = [row[feature] for row in rows]
    stub_api(monkeypatch, {"hourly": hourly})
    app.config["PREDICT_MANY"] = lambda frames: [9.5 for _ in frames]
    assert live.backfill_if_empty(app) > 0
    assert event_count(engine) == 0


# A14
def test_the_page_shows_all_rows_with_their_fields(engine, client, admin):
    raise_alert(engine, "moderate", 4.03)
    rows = client.get("/api/alerts").get_json()
    assert len(rows) == 2
    row = rows[0]
    assert row["risk_level"] == "moderate" and row["predicted_mm"] == 4.03
    assert row["recipient_email"] and row["delivery_status"] == alerts.NOT_CONFIGURED and row["at"]
    assert "password" not in str(rows).lower()


# A15
def test_acknowledge_own_alert_and_the_bell_count_falls(engine, client):
    raise_alert(engine)
    assert client.get("/api/alerts/unread").get_json() == {"count": 1}
    row = client.get("/api/alerts").get_json()[0]
    assert row["can_acknowledge"] is True
    assert client.post(f"/api/alerts/{row['id']}/ack").status_code == 200
    assert client.get("/api/alerts/unread").get_json() == {"count": 0}
    after = client.get("/api/alerts").get_json()[0]
    assert after["acknowledged_at"] and after["acknowledged_by"] == client.email
    assert after["can_acknowledge"] is False


# A16
def test_a_responder_cannot_acknowledge_someone_elses_alert(engine, client, make_user):
    other_email, _ = make_user()
    raise_alert(engine)
    other = next(r for r in client.get("/api/alerts").get_json() if r["recipient_email"] == other_email)
    assert other["can_acknowledge"] is False
    assert client.post(f"/api/alerts/{other['id']}/ack").status_code == 403
    assert client.get("/api/alerts").get_json()[0]["acknowledged_at"] is None


# A17
def test_an_administrator_can_acknowledge_any_alert(engine, client, admin):
    raise_alert(engine)
    theirs = next(r for r in admin.get("/api/alerts").get_json() if r["recipient_email"] == client.email)
    assert admin.post(f"/api/alerts/{theirs['id']}/ack").get_json()["acknowledged_by"] == admin.email
    assert client.get("/api/alerts/unread").get_json() == {"count": 0}


# A18
def test_acknowledge_needs_csrf_and_a_real_alert(engine, client):
    raise_alert(engine)
    row = client.get("/api/alerts").get_json()[0]
    assert client.post(f"/api/alerts/{row['id']}/ack", send_csrf=False).status_code == 403
    assert client.post("/api/alerts/99999/ack").status_code == 404


# A19
@pytest.mark.parametrize("term,found", [("medium", 1), ("MODERATE", 1), ("high", 0), ("not sent", 1), ("nobody", 0), ("%", 0)])
def test_search(engine, client, term, found):
    raise_alert(engine, "moderate")
    assert len(client.get("/api/alerts", query_string={"q": term}).get_json()) == (found if term != "%" else 1)


# A20
def test_search_by_recipient(engine, client, make_user):
    email, _ = make_user()
    raise_alert(engine)
    rows = client.get("/api/alerts", query_string={"q": email[:6]}).get_json()
    assert [row["recipient_email"] for row in rows] == [email]


# A21
def test_dashboard_banner_after_an_alert_then_it_clears(engine, client, monkeypatch):
    assert client.get("/api/live/current").get_json()["alert"] is None
    raise_alert(engine, "high", 8.0)
    alert = client.get("/api/live/current").get_json()["alert"]
    assert (alert["risk_level"], alert["recipients"], alert["emails_sent"]) == ("high", 1, 0)
    real = db.utcnow
    monkeypatch.setattr(db, "utcnow", lambda: real() + timedelta(hours=alerts.BANNER_HOURS, seconds=1))
    # The session has expired by now only after 8 hours, so it still works here
    assert client.get("/api/live/current").get_json()["alert"] is None


# A22
def test_count_alerts_uses_the_same_rules():
    start = datetime(2026, 11, 1)
    rows = [(start + timedelta(hours=h), mm) for h, mm in enumerate([0, 3, 3, 3, 3, 3, 8, 3, 0])]
    assert alerts.count_alerts(rows, limits.default_thresholds(), 3) == 3  # hour 1, hour 4, the rise at 6
    assert alerts.count_alerts(rows, limits.default_thresholds(), 100) == 2
    assert alerts.count_alerts(rows, [(100, "low"), (200, "moderate")], 3) == 0


# A23: roles don't change who gets a row
def test_responders_and_admins_both_get_rows(engine, make_user):
    make_user(role=ROLE_RESPONDER)
    make_user(role=ROLE_ADMIN)
    raise_alert(engine)
    assert len(deliveries(engine)) == 2


# A24: an alert email names the hour as a range, and whose limits raised it
def test_email_names_the_hour_and_the_limits_in_use(engine, make_user, smtp):
    from backend import thresholds as limits
    make_user()
    with Session(engine) as session:
        limits.set_setting(session, limits.THRESHOLDS_KEY, [[1.0, "low"], [5.0, "moderate"]])
        session.commit()
    raise_alert(engine, "moderate", 2.0)
    body = smtp.sent[0].get_content()
    start = TARGET - timedelta(hours=1)
    assert f"between {start:%H:%M} and {TARGET:%H:%M} on {start:%d %b %Y}" in body
    assert limits.DISCLAIMER_OVERRIDDEN in body and "AMS" not in body


# A25: the Demo replay goes through /predict, which never raises an alert, even
# when its prediction is Medium or High under the limits in use
def test_replay_predictions_never_raise_alerts(admin, engine, real_window):
    admin.put("/api/admin/thresholds", json={"medium_from": 0.0001, "high_from": 0.0002, "cooldown_hours": 3})
    body = admin.post("/predict", json={"readings": real_window}).get_json()
    assert body["risk_level"] in ("moderate", "high")
    assert event_count(engine) == 0 and deliveries(engine) == []
