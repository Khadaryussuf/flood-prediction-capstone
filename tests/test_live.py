"""Live data, the scheduler and the dashboard API. IDs match docs/TESTING.md (L1 onward)."""

from datetime import datetime, timedelta

import pytest
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import db, live, scheduler
from backend.db import LiveSnapshot, RiskHistory
from pipeline import config

NOW = datetime(2026, 11, 2, 15, 20)  # Nairobi time of the fake "current" reading


def fake_payload(real_window, now=NOW, nulls=False):
    """A forecast-API response: the real test window as the last 24 hours, then 12 forecast hours."""
    current = now.replace(minute=0)
    times = [current + timedelta(hours=h) for h in range(-23, 14)]
    rows = list(real_window) + [real_window[-1]] * 13
    hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
    for feature in config.FEATURES:
        hourly[feature] = [row[feature] for row in rows]
    hourly["precipitation"][24:] = [0.5] * 13
    if nulls:
        hourly["temperature_2m"][5] = None
    return {"current": {"time": now.strftime("%Y-%m-%dT%H:%M")}, "hourly": hourly}


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(live.time, "sleep", lambda seconds: None)


@pytest.fixture
def no_backfill(monkeypatch):
    monkeypatch.setattr(live, "backfill_if_empty", lambda app: 0)


def stub_api(monkeypatch, *results):
    """Each call takes the next result; an exception is raised."""
    calls = []
    results = list(results)

    def get(url, params=None, timeout=None):
        calls.append(params)
        result = results.pop(0) if len(results) > 1 else results[0]
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result)
    monkeypatch.setattr(live.requests, "get", get)
    return calls


# L1: the same window gives the same value as /predict and the saved evaluation
def test_live_prediction_uses_the_same_path_as_predict(app, client, real_window, monkeypatch, no_backfill):
    calls = stub_api(monkeypatch, fake_payload(real_window))
    assert live.refresh(app) is not None

    body = client.get("/api/live/current").get_json()
    direct = client.post("/predict", json={"readings": real_window}).get_json()
    assert body["predicted_mm"] == pytest.approx(0.0570, abs=1e-4)
    assert body["predicted_mm"] == direct["predicted_mm"]
    assert body["risk_level"] == "low"
    assert calls[0]["past_hours"] == 24
    assert calls[0]["timezone"] == config.TIMEZONE


# L2
def test_window_is_the_24_hours_ending_now_and_target_is_next_hour(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    body = client.get("/api/live/current").get_json()
    assert len(body["window"]) == 24
    assert body["window"][0]["time"] == "2026-11-01T16:00:00"
    assert body["window"][-1]["time"] == "2026-11-02T15:00:00"
    assert body["target_time"] == "2026-11-02T16:00:00"
    assert len(body["forecast"]) == live.FORECAST_HOURS
    assert body["forecast"][0] == {"time": "2026-11-02T16:00:00", "precipitation": 0.5}


# L3
def test_fresh_reading_is_live_and_says_inputs_differ_from_training(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    body = client.get("/api/live/current").get_json()
    assert body["freshness"] == "Live"
    assert "differ from the ERA5" in body["source_note"]
    assert body["last_updated"]


# L4
def test_retries_then_succeeds(app, real_window, monkeypatch, no_backfill):
    calls = stub_api(monkeypatch, requests.ConnectionError(), requests.Timeout(), fake_payload(real_window))
    assert live.refresh(app) is not None
    assert len(calls) == 3


# L5
def test_failure_falls_back_to_the_last_good_reading(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    good = client.get("/api/live/current").get_json()

    calls = stub_api(monkeypatch, requests.ConnectionError())
    assert live.refresh(app) is None
    assert len(calls) == live.MAX_ATTEMPTS
    body = client.get("/api/live/current").get_json()
    assert body["freshness"] == "Fallback"
    assert body["predicted_mm"] == good["predicted_mm"]
    assert body["last_updated"] == good["last_updated"]
    assert "ConnectionError" in body["last_error"]


# L6
def test_recovers_after_failure(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, requests.ConnectionError())
    live.refresh(app)
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    assert client.get("/api/live/current").get_json()["freshness"] == "Live"


# L7
def test_old_reading_is_stale(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    real = db.utcnow
    monkeypatch.setattr(db, "utcnow", lambda: real() + timedelta(minutes=91))
    assert client.get("/api/live/current").get_json()["freshness"] == "Stale"


# L8
def test_no_data_yet_is_unavailable_not_an_error(client):
    body = client.get("/api/live/current").get_json()
    assert body["freshness"] == "Unavailable"
    assert body["predicted_mm"] is None


# L9
def test_gaps_are_interpolated(app, client, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window, nulls=True))
    assert live.refresh(app) is not None
    assert client.get("/api/live/current").get_json()["window"][5]["temperature_2m"] is not None


# L10
@pytest.mark.parametrize("payload", [{}, {"hourly": {}}, {"current": {"time": "2026-11-02T15:00"}, "hourly": {"time": []}}])
def test_malformed_response_is_recorded_not_raised(app, client, monkeypatch, payload, no_backfill):
    stub_api(monkeypatch, payload)
    assert live.refresh(app) is None
    with Session(app.config["DB_ENGINE"]) as session:
        assert session.scalars(select(LiveSnapshot)).one().ok is False


# L11
def test_each_hour_is_one_history_row(app, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    live.refresh(app)
    live.refresh(app)
    with Session(app.config["DB_ENGINE"]) as session:
        rows = session.scalars(select(RiskHistory)).all()
        assert [(row.source, row.target_time) for row in rows] == [("live", datetime(2026, 11, 2, 16))]


# L12
def test_backfill_fills_history_once(app, real_window, monkeypatch):
    start = db.utcnow().replace(minute=0, second=0, microsecond=0) + live.NAIROBI_OFFSET
    times = [start - timedelta(hours=h) for h in range(60, -1, -1)]
    rows = (list(real_window) * 3)[:len(times)]
    hourly = {"time": [t.strftime("%Y-%m-%dT%H:%M") for t in times]}
    for feature in config.FEATURES:
        hourly[feature] = [row[feature] for row in rows]
    stub_api(monkeypatch, {"hourly": hourly})
    assert live.backfill_if_empty(app) == len(times) - 24
    assert live.backfill_if_empty(app) == 0
    with Session(app.config["DB_ENGINE"]) as session:
        history = session.scalars(select(RiskHistory)).all()
        assert {row.source for row in history} == {"backfill"}
        assert len(history) == len(times) - 24


# L13
def test_scheduler_waits_until_just_after_the_next_hour():
    assert scheduler.seconds_until_next_run(datetime(2026, 11, 2, 15, 0, 0)) == 120
    assert scheduler.seconds_until_next_run(datetime(2026, 11, 2, 15, 2, 0)) == 3600
    assert scheduler.seconds_until_next_run(datetime(2026, 11, 2, 23, 30, 0)) == 32 * 60


# L14
def test_scheduler_survives_errors_and_retries_sooner(app, monkeypatch):
    monkeypatch.setattr(live, "refresh", lambda a: None)
    assert scheduler.run_once(app) == scheduler.RETRY_AFTER_FAILURE_SECONDS

    def broken(a):
        raise KeyError("bug")
    monkeypatch.setattr(live, "refresh", broken)
    assert scheduler.run_once(app) == scheduler.RETRY_AFTER_FAILURE_SECONDS

    monkeypatch.setattr(live, "refresh", lambda a: 1)
    assert scheduler.run_once(app) <= 3600


# L15
def test_scheduler_thread_runs_and_stops(app, monkeypatch):
    import threading
    ran = threading.Event()

    def refresh(a):
        ran.set()
        return 1
    monkeypatch.setattr(live, "refresh", refresh)
    stop = scheduler.start(app)
    assert ran.wait(5)
    stop.set()


# L16
def test_manual_refresh_is_admin_only(client, admin, real_window, monkeypatch, no_backfill):
    stub_api(monkeypatch, fake_payload(real_window))
    assert client.post("/api/admin/live/refresh").status_code == 403
    assert admin.post("/api/admin/live/refresh").get_json() == {"ok": True}
    stub_api(monkeypatch, requests.ConnectionError())
    assert admin.post("/api/admin/live/refresh").status_code == 502
