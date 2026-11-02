"""The map's forecast data. IDs match docs/TESTING.md (M1 onward)."""

from datetime import timedelta

import pytest
import requests

from backend import db, live, map_data
from pipeline import config

POINTS = 1 + len(map_data.GRID_LATITUDES) * len(map_data.GRID_LONGITUDES) + len(map_data.ZONES)


def fake_payload(wet_hour=None, wet_mm=2.0):
    """Times around the real clock: now in the middle, as the API returns them."""
    now = (db.utcnow() + live.NAIROBI_OFFSET).replace(minute=0, second=0, microsecond=0)
    times = [(now + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(-24, 13)]
    item_rain = [0.0] * len(times)
    if wet_hour is not None:
        item_rain[24 + wet_hour] = wet_mm
    return [{"hourly": {"time": times, "precipitation": list(item_rain)}} for _ in range(POINTS)]


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    map_data.clear_cache()
    monkeypatch.setattr(live.time, "sleep", lambda seconds: None)
    yield
    map_data.clear_cache()


def stub(monkeypatch, result):
    calls = []

    def get(url, params=None, timeout=None):
        calls.append(params)
        if isinstance(result, Exception):
            raise result
        return FakeResponse(result)
    monkeypatch.setattr(live.requests, "get", get)
    return calls


# M1
def test_needs_a_session(anon):
    assert anon.get("/api/map/forecast").status_code == 401


# M2
def test_returns_grid_zones_and_the_past_24_and_next_12_hours(client, monkeypatch):
    calls = stub(monkeypatch, fake_payload())
    body = client.get("/api/map/forecast").get_json()
    assert body["available"] is True
    assert len(body["times"]) == 37 and body["now_index"] == 24
    assert len(body["grid"]) == 25
    assert [zone["name"] for zone in body["zones"]] == ["Mathare", "Kibera", "CBD"]
    assert len(calls[0]["latitude"].split(",")) == POINTS  # one multi-location call
    assert calls[0]["past_hours"] == 24


# M3: this is a weather forecast, and the payload has no model risk in it to misuse
def test_is_labelled_forecast_and_carries_no_model_risk(client, monkeypatch):
    stub(monkeypatch, fake_payload())
    response = client.get("/api/map/forecast")
    assert "not model risk" in response.get_json()["label"]
    text = response.get_data(as_text=True)
    assert "risk_level" not in text and "predicted_mm" not in text


# M4
def test_peak_is_the_wettest_future_hour(client, monkeypatch):
    stub(monkeypatch, fake_payload(wet_hour=3))
    peak = client.get("/api/map/forecast").get_json()["peak"]
    assert peak["hours"] == 3 and peak["mm"] == 2.0


# M5
def test_no_peak_when_no_real_rain_is_forecast(client, monkeypatch):
    stub(monkeypatch, fake_payload(wet_hour=2, wet_mm=0.05))
    assert client.get("/api/map/forecast").get_json()["peak"] is None


# M6: past rain doesn't count as a peak
def test_past_rain_is_not_a_peak(client, monkeypatch):
    stub(monkeypatch, fake_payload(wet_hour=-2))
    assert client.get("/api/map/forecast").get_json()["peak"] is None


# M7
def test_is_cached(client, monkeypatch):
    calls = stub(monkeypatch, fake_payload())
    client.get("/api/map/forecast")
    client.get("/api/map/forecast")
    assert len(calls) == 1


# M8
def test_failure_with_nothing_cached_is_a_clear_answer_not_an_error(client, monkeypatch):
    stub(monkeypatch, requests.ConnectionError())
    response = client.get("/api/map/forecast")
    assert response.status_code == 200
    assert response.get_json()["available"] is False


# M9
def test_failure_keeps_the_last_good_copy_and_says_so(client, monkeypatch):
    stub(monkeypatch, fake_payload())
    client.get("/api/map/forecast")
    map_data._cache["at"] = -map_data.CACHE_SECONDS  # the copy has expired
    stub(monkeypatch, requests.ConnectionError())
    body = client.get("/api/map/forecast").get_json()
    assert body["available"] is True and body["stale"] is True


# M10
@pytest.mark.parametrize("payload", [{}, [], [{"hourly": {}}] * POINTS])
def test_malformed_response_is_handled(client, monkeypatch, payload):
    stub(monkeypatch, payload)
    assert client.get("/api/map/forecast").get_json()["available"] is False


# M11: OpenStreetMap's tile servers need a referrer, so the app must send its origin
def test_referrer_policy_allows_map_tiles(anon):
    assert anon.get("/health").headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


# M12: the zones are the named areas, and the centre is the model's cell
def test_zones_are_near_the_city_and_the_centre_is_the_models_cell(client, monkeypatch):
    stub(monkeypatch, fake_payload())
    body = client.get("/api/map/forecast").get_json()
    assert body["centre"] == {"lat": config.LATITUDE, "lon": config.LONGITUDE}
    for zone in body["zones"]:
        assert abs(zone["lat"] - config.LATITUDE) < 0.05 and abs(zone["lon"] - config.LONGITUDE) < 0.05
