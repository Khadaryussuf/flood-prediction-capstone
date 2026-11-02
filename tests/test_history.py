"""Historical Trends and the threshold settings. IDs match docs/TESTING.md (H1 onward)."""

from datetime import timedelta

import pytest
from sqlalchemy.orm import Session

from backend import db, history, live
from backend.db import RiskHistory
from pipeline import config


def add_history(app, hours_ago_mm):
    """{hours ago: mm}. The level is stored as the app would have classified it then."""
    now = (db.utcnow() + live.NAIROBI_OFFSET).replace(minute=0, second=0, microsecond=0)
    with Session(app.config["DB_ENGINE"]) as session:
        for hours, mm in hours_ago_mm.items():
            level = "low" if mm < 2.5 else "moderate" if mm < 7.6 else "high"
            session.add(RiskHistory(target_time=now - timedelta(hours=hours), predicted_mm=mm,
                                    risk_level=level, source="live", created_at=db.utcnow()))
        session.commit()


SETTINGS = {"medium_from": 1.0, "high_from": 5.0, "cooldown_hours": 3}


# H1
@pytest.mark.parametrize("key,expected", [("24h", 2), ("7d", 3), ("30d", 4)])
def test_ranges_cover_the_right_period(app, client, key, expected):
    add_history(app, {2: 0.1, 20: 0.2, 100: 0.3, 500: 0.4, 1000: 0.5})
    assert len(client.get("/api/history", query_string={"range": key}).get_json()["rows"]) == expected


# H2
def test_rows_are_oldest_first_with_their_fields(app, client):
    add_history(app, {1: 3.0, 5: 0.1})
    body = client.get("/api/history").get_json()
    assert [row["predicted_mm"] for row in body["rows"]] == [0.1, 3.0]
    assert body["rows"][1]["risk_level"] == "moderate"  # the API's value stays "moderate"
    assert body["rows"][1]["source"] == "live"
    assert body["thresholds"][0] == {"below_mm": 2.5, "label": "low"}


# H3
@pytest.mark.parametrize("path", ["/api/history", "/api/history.csv"])
def test_a_bad_range_is_refused(client, path):
    assert client.get(path, query_string={"range": "1y"}).status_code == 400


# H4
def test_csv_export(app, client):
    add_history(app, {1: 3.0, 5: 0.1})
    response = client.get("/api/history.csv", query_string={"range": "7d"})
    assert response.mimetype == "text/csv"
    assert "floodwatch-predictions-7d.csv" in response.headers["Content-Disposition"]
    lines = response.get_data(as_text=True).splitlines()
    assert lines[0] == "time_nairobi,predicted_mm,risk_level,source"
    assert len(lines) == 3 and lines[2].endswith(",3.0,moderate,live")


# H5
def test_csv_and_history_need_a_session(anon):
    assert anon.get("/api/history").status_code == 401
    assert anon.get("/api/history.csv").status_code == 401


# H6
def test_defaults_come_from_config(admin):
    body = admin.get("/api/admin/thresholds").get_json()
    assert body["medium_from"] == config.RISK_THRESHOLDS_MM[0][0] == body["default_medium_from"]
    assert body["high_from"] == config.RISK_THRESHOLDS_MM[1][0] == body["default_high_from"]
    assert body["overridden"] is False


# H7
def test_preview_counts_alerts_and_changes_nothing(app, admin):
    add_history(app, {10: 0.1, 8: 1.5, 7: 1.5, 6: 1.5, 5: 6.0, 1: 1.5})
    body = admin.post("/api/admin/thresholds/preview", json=SETTINGS).get_json()
    # 8h ago alerts; 7 and 6 are held back; the rise at 5 breaks through; 1 is past the cool-down
    assert body["alerts"] == 3
    assert (body["days"], body["hours_checked"], body["medium_hours"], body["high_hours"]) == (30, 6, 4, 1)
    assert body["highest_prediction_mm"] == 6.0
    assert admin.get("/api/admin/thresholds").get_json()["overridden"] is False


# H8
def test_preview_at_default_limits_with_no_rain_is_zero(app, admin):
    add_history(app, {3: 0.5})
    body = admin.post("/api/admin/thresholds/preview",
                      json={"medium_from": 2.5, "high_from": 7.6, "cooldown_hours": 3}).get_json()
    assert body["alerts"] == 0 and body["hours_checked"] == 1


# H9
@pytest.mark.parametrize("bad", [
    {"medium_from": 5, "high_from": 1, "cooldown_hours": 3},
    {"medium_from": 5, "high_from": 5, "cooldown_hours": 3},
    {"medium_from": 0, "high_from": 5, "cooldown_hours": 3},
    {"medium_from": -1, "high_from": 5, "cooldown_hours": 3},
    {"medium_from": "2", "high_from": 5, "cooldown_hours": 3},
    {"medium_from": True, "high_from": 5, "cooldown_hours": 3},
    {"medium_from": 1, "high_from": 5000, "cooldown_hours": 3},
    {"medium_from": 1, "high_from": 5, "cooldown_hours": -1},
    {"medium_from": 1, "high_from": 5, "cooldown_hours": 100},
    {"medium_from": 1, "high_from": 5},
])
def test_bad_settings_are_refused(admin, bad):
    assert admin.put("/api/admin/thresholds", json=bad).status_code == 400
    assert admin.post("/api/admin/thresholds/preview", json=bad).status_code == 400
    assert admin.get("/api/admin/thresholds").get_json()["overridden"] is False


# H10
def test_override_changes_predict_but_keeps_the_api_values(admin, real_window):
    before = admin.post("/predict", json={"readings": real_window}).get_json()
    assert before["risk_level"] == "low"
    assert before["thresholds"] == "AMS rain intensity classes (not calibrated to Nairobi flood records)"

    admin.put("/api/admin/thresholds", json={"medium_from": 0.01, "high_from": 0.02, "cooldown_hours": 3})
    after = admin.post("/predict", json={"readings": real_window}).get_json()
    assert after["predicted_mm"] == before["predicted_mm"]
    assert after["risk_level"] == "high"
    assert "not AMS" in after["thresholds"] and "not calibrated" in after["thresholds"]
    assert after["risk_level"] in ("low", "moderate", "high")


# H11
def test_override_reaches_the_dashboard_and_meta(admin):
    admin.put("/api/admin/thresholds", json=SETTINGS)
    live_body = admin.get("/api/live/current").get_json()
    assert live_body["thresholds"][0]["below_mm"] == 1.0
    assert live_body["thresholds_overridden"] is True
    assert admin.get("/api/meta").get_json()["thresholds"][1]["below_mm"] == 5.0


# H12
def test_reset_goes_back_to_the_defaults_and_config_is_untouched(admin):
    admin.put("/api/admin/thresholds", json=SETTINGS)
    body = admin.delete("/api/admin/thresholds").get_json()
    assert body["medium_from"] == 2.5 and body["overridden"] is False
    assert config.RISK_THRESHOLDS_MM == [(2.5, "low"), (7.6, "moderate")]


# H13
def test_threshold_changes_are_audited(admin):
    admin.put("/api/admin/thresholds", json=SETTINGS)
    admin.delete("/api/admin/thresholds")
    rows = admin.get("/api/admin/audit").get_json()
    assert [row["action"] for row in rows[:2]] == ["reset_thresholds", "set_thresholds"]
    assert "medium from 1.0 mm" in rows[1]["detail"]


# H14
def test_cooldown_setting_is_used_by_the_engine(app, admin, make_user):
    from backend import alerts
    from datetime import datetime
    make_user()
    admin.put("/api/admin/thresholds", json={**SETTINGS, "cooldown_hours": 0})
    engine = app.config["DB_ENGINE"]
    target = datetime(2026, 11, 2, 16)
    assert alerts.process_prediction(engine, "moderate", 2.0, target) is not None
    assert alerts.process_prediction(engine, "moderate", 2.0, target) is not None


# H15: the responder rule for these routes, spelled out
@pytest.mark.parametrize("method,path", [("GET", "/api/admin/thresholds"), ("PUT", "/api/admin/thresholds"),
                                         ("DELETE", "/api/admin/thresholds"), ("POST", "/api/admin/thresholds/preview")])
def test_responders_cannot_touch_thresholds(client, method, path):
    assert client.open(path, method=method, json=SETTINGS if method != "GET" else None).status_code == 403


# H16: the module's lookback really is 30 days
def test_preview_only_looks_back_30_days(app, admin):
    add_history(app, {24 * 31: 9.0, 2: 0.1})
    body = admin.post("/api/admin/thresholds/preview",
                      json={"medium_from": 2.5, "high_from": 7.6, "cooldown_hours": 3}).get_json()
    assert body["hours_checked"] == 1 and body["alerts"] == 0
    assert history.PREVIEW_DAYS == 30
