"""Tests for the Flask backend. IDs match the table in docs/TESTING.md."""

import copy

import pytest

from backend.app import create_app


# T1
def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json()["status"] == "ok"


# T17: the API must serve the model chosen by the validation rule
def test_health_reports_cnn_lstm(client):
    body = client.get("/health").get_json()
    assert body["model"] == "cnn_lstm"
    assert body["model_file"] == "cnn_lstm_model.keras"


# T2
def test_valid_prediction(client, real_window):
    response = client.post("/predict", json={"readings": real_window})
    assert response.status_code == 200
    body = response.get_json()
    # Ground truth: first cnn_lstm_mm value in
    # experiments/run_20261017_210439/predictions.csv (2025-04-03 02:00)
    assert body["predicted_mm"] == pytest.approx(0.0570, abs=1e-4)
    assert body["risk_level"] == "low"
    assert body["thresholds"] == "PROVISIONAL"


# T3
def test_wrong_number_of_hours(client, real_window):
    response = client.post("/predict", json={"readings": real_window[:23]})
    assert response.status_code == 400
    assert "exactly 24" in response.get_json()["error"]


# T4
def test_missing_field(client, real_window):
    readings = copy.deepcopy(real_window)
    del readings[5]["wind_speed_10m"]
    response = client.post("/predict", json={"readings": readings})
    assert response.status_code == 400
    assert "missing field 'wind_speed_10m'" in response.get_json()["error"]


# T5
def test_non_numeric_value(client, real_window):
    readings = copy.deepcopy(real_window)
    readings[0]["temperature_2m"] = "abc"
    response = client.post("/predict", json={"readings": readings})
    assert response.status_code == 400
    assert "must be a number" in response.get_json()["error"]


# T6
def test_missing_model_file(tmp_path):
    missing = tmp_path / "missing.keras"
    with pytest.raises(FileNotFoundError, match="missing.keras"):
        create_app(model_path=missing,
                   database_url=f"sqlite:///{tmp_path.as_posix()}/test.db")


# T7
def test_prediction_saved_to_database(client, real_window):
    predicted = client.post("/predict", json={"readings": real_window}).get_json()

    saved = client.get("/predictions").get_json()
    assert len(saved) == 1
    assert saved[0]["id"] == predicted["id"]
    assert saved[0]["predicted_mm"] == predicted["predicted_mm"]
    assert saved[0]["risk_level"] == predicted["risk_level"]
    assert len(saved[0]["input"]) == 24
