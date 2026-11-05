"""Tests for the dashboard endpoints. IDs match the table in docs/TESTING.md.

None of these write to models/, experiments/ or docs/; the result files
are only read, to check the API returns exactly what is in them.
"""

import csv
import json
import re
from pathlib import Path

import pytest

import backend.app as backend_app
from pipeline import config

CNN_LSTM_PREDICTIONS = config.EXPERIMENTS_DIR / "run_20261017_210439" / "predictions.csv"


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


@pytest.fixture(scope="module")
def evaluation_rows():
    """The CNN-LSTM's saved test predictions, one row per target hour."""
    return read_csv(CNN_LSTM_PREDICTIONS)


# T27: replay window 0 is the first 24 hours of the real test split
def test_replay_first_window(client, real_window):
    body = client.get("/api/replay/0").get_json()
    assert body["window_start"] == "2025-04-02T02:00:00"
    assert body["window_end"] == "2025-04-03T01:00:00"
    assert body["target_time"] == "2025-04-03T02:00:00"
    assert len(body["times"]) == 24 and len(body["readings"]) == 24
    for sent, expected in zip(body["readings"], real_window):
        assert set(sent) == set(config.FEATURES)  # jsonify sorts keys
        for feature in config.FEATURES:
            assert sent[feature] == pytest.approx(expected[feature])
    assert body["actual_next_mm"] == 0.0


# T28: replaying through /predict gives the evaluated CNN-LSTM value
def test_replay_through_predict_matches_evaluation(client, evaluation_rows):
    readings = client.get("/api/replay/0").get_json()["readings"]
    predicted = client.post("/predict", json={"readings": readings}).get_json()
    assert predicted["predicted_mm"] == pytest.approx(
        float(evaluation_rows[0]["cnn_lstm_mm"]), abs=1e-4)  # 0.0570


# T29: every replay index lines up with the evaluation's target hours,
# checked on the wettest hours, where a misalignment would matter most
def test_replay_indices_line_up_with_evaluation(client, evaluation_rows):
    meta = client.get("/api/meta").get_json()
    assert meta["window_count"] == len(evaluation_rows) == 6550
    assert len(meta["wettest"]) == backend_app.WETTEST_COUNT

    actuals = [float(r["actual_mm"]) for r in evaluation_rows]
    assert meta["wettest"][0]["actual_mm"] == pytest.approx(max(actuals), abs=1e-4)

    for entry in meta["wettest"]:
        i = entry["index"]
        body = client.get(f"/api/replay/{i}").get_json()
        row = evaluation_rows[i]
        assert body["target_time"].replace("T", " ") == row["time"]
        assert entry["target_time"] == body["target_time"]
        assert body["actual_next_mm"] == pytest.approx(float(row["actual_mm"]), abs=1e-4)
        predicted = client.post("/predict", json={"readings": body["readings"]}).get_json()
        assert predicted["predicted_mm"] == pytest.approx(float(row["cnn_lstm_mm"]), abs=1e-3)


# T30
@pytest.mark.parametrize("index", [-1, 6550, 100000])
def test_replay_index_out_of_range(client, index):
    response = client.get(f"/api/replay/{index}")
    assert response.status_code == 400
    assert "between 0 and 6549" in response.get_json()["error"]


# T31: the comparison panel gets exactly what is in the two result files
def test_comparison_matches_result_files(client):
    body = client.get("/api/comparison").get_json()
    comparison = read_csv(backend_app.COMPARISON_CSV)
    seeds = read_csv(backend_app.SEED_CSV)

    assert [m["model"] for m in body["models"]] == [r["model"] for r in comparison]
    for model, row in zip(body["models"], comparison):
        for key in ("val_rmse_mm", "val_mae_mm", "test_rmse_mm", "test_mae_mm",
                    "test_r2", "test_heavy_recall", "test_max_pred_mm", "test_max_actual_mm"):
            assert model[key] == float(row[key])
        for key in ("val_heavy_hit", "val_heavy_actual", "test_heavy_hit", "test_heavy_actual"):
            assert model[key] == int(row[key])
        assert model["run"] == row["run"]

        if model["model"] in ("ARIMA", "Persistence"):
            assert model["is_baseline"] and model["seeds"] is None
            continue
        assert not model["is_baseline"]
        mean = next(r for r in seeds if r["model"] == model["model"] and r["seed"] == "mean")
        sd = next(r for r in seeds if r["model"] == model["model"] and r["seed"] == "sd")
        assert model["seeds"]["n_seeds"] == 5
        assert model["seeds"]["seed_list"] == [42, 1, 2, 3, 4]
        for key in ("val_rmse_mm", "test_rmse_mm", "test_heavy_hit"):
            assert model["seeds"]["mean"][key] == float(mean[key])
            assert model["seeds"]["sd"][key] == float(sd[key])

    names = {m["model"] for m in body["models"]}
    assert {"ARIMA", "Persistence"} <= names
    assert [m["model"] for m in body["models"] if m["selected"]] == ["CNN-LSTM"]


# T32
def test_meta_uses_config_thresholds_and_disclaimer(client):
    meta = client.get("/api/meta").get_json()
    assert meta["thresholds"] == [{"below_mm": limit, "label": label}
                                  for limit, label in config.RISK_THRESHOLDS_MM]
    assert meta["highest_risk"] == config.HIGHEST_RISK
    assert meta["disclaimer"] == (
        "Risk level is hourly rainfall intensity (AMS classes), not flood "
        "probability, and is not calibrated to Nairobi flood records.")
    assert meta["data_label"] == "Replay of held-out test period (not live)"
    assert meta["test_period"]["start"] == "2025-04-02T02:00:00"


# T33
def test_dashboard_missing_build_returns_503(client, monkeypatch, tmp_path):
    monkeypatch.setattr(backend_app, "DASHBOARD_INDEX", tmp_path / "missing" / "index.html")
    response = client.get("/dashboard")
    assert response.status_code == 503
    assert "npm run build" in response.get_data(as_text=True)


# T34
def test_dashboard_serves_built_page(client, monkeypatch, tmp_path):
    page = tmp_path / "index.html"
    page.write_text("<!doctype html><title>built</title>", encoding="utf-8")
    monkeypatch.setattr(backend_app, "DASHBOARD_INDEX", page)
    response = client.get("/dashboard")
    assert response.status_code == 200
    assert "<title>built</title>" in response.get_data(as_text=True)


# T35: replay steps are stored through /predict, in the test's own database
def test_replay_step_is_stored_in_temporary_database(app, client, tmp_path):
    database = Path(app.config["DB_ENGINE"].url.database)
    assert database.parent == tmp_path
    assert database != config.ROOT / "data" / "predictions.db"

    # Reading the dashboard data stores nothing
    client.get("/api/meta")
    client.get("/api/replay/5")
    client.get("/api/comparison")
    assert client.get("/predictions").get_json() == []

    readings = client.get("/api/replay/5").get_json()["readings"]
    predicted = client.post("/predict", json={"readings": readings}).get_json()
    saved = client.get("/predictions").get_json()
    assert [row["id"] for row in saved] == [predicted["id"]]
    for stored, sent in zip(saved[0]["input"], readings):
        assert stored == pytest.approx(sent)


# ---- The built dashboard (backend/static/app, from npm run build) --------

BUILT_ASSETS = re.compile(r'(?:src|href)="(/static/app/[^"]+)"')


def built_page_assets(client):
    page = client.get("/dashboard").get_data(as_text=True)
    return page, BUILT_ASSETS.findall(page)


# T36: the committed build is served, and everything it loads comes from Flask
def test_built_dashboard_loads_only_local_files(client):
    assert backend_app.DASHBOARD_INDEX.exists(), "run npm run build in frontend/"
    page, assets = built_page_assets(client)
    assert '<div id="root">' in page
    assert any(a.endswith(".js") for a in assets) and any(a.endswith(".css") for a in assets)

    # No script, stylesheet, font or image from another host (no CDN)
    assert not re.search(r'(?:src|href)="(?:https?:)?//', page)
    for asset in assets:
        response = client.get(asset)
        assert response.status_code == 200, asset
        text = response.get_data(as_text=True)
        response.close()
        if asset.endswith(".css"):
            assert not re.search(r'(?:url\(|@import)\s*["\']?(?:https?:)?//', text), asset
        if asset.endswith(".js"):
            assert not re.search(r'(?:import\(|from)\s*["\'](?:https?:)?//', text), asset


# T37: the built page carries the exact disclaimer and replay label
def test_built_dashboard_contains_disclaimer(client):
    _, assets = built_page_assets(client)
    bundle = ""
    for asset in assets:
        if asset.endswith(".js"):
            response = client.get(asset)
            bundle += response.get_data(as_text=True)
            response.close()
    assert backend_app.DISCLAIMER in bundle
    assert backend_app.DISCLAIMER_OVERRIDDEN in bundle
    assert backend_app.REPLAY_LABEL in bundle


# ---- THIRD_PARTY.md ------------------------------------------------------

THIRD_PARTY = config.ROOT / "THIRD_PARTY.md"
FRONTEND = config.ROOT / "frontend"


# T38: every direct dependency is recorded with its installed version and a licence
def test_third_party_lists_every_direct_dependency():
    text = THIRD_PARTY.read_text(encoding="utf-8")
    package = json.loads((FRONTEND / "package.json").read_text(encoding="utf-8"))
    lock = json.loads((FRONTEND / "package-lock.json").read_text(encoding="utf-8"))
    for name in {**package["dependencies"], **package["devDependencies"]}:
        info = lock["packages"][f"node_modules/{name}"]
        assert f"| `{name}` | {info['version']} | {info['license']} |" in text, name
    assert "UNKNOWN" not in text


# T39: every copied component is listed, and the production tree is complete
def test_third_party_lists_components_and_production_tree():
    text = THIRD_PARTY.read_text(encoding="utf-8")
    components = sorted(p.name for p in (FRONTEND / "src" / "components" / "ui").glob("*.tsx"))
    assert components
    for component in components:
        assert f"- `{component}`" in text, component

    lock = json.loads((FRONTEND / "package-lock.json").read_text(encoding="utf-8"))
    for path, info in lock["packages"].items():
        if path and not info.get("dev") and not info.get("optional"):
            name = path.rsplit("node_modules/", 1)[1]
            assert f"| `{name}` | {info['version']} | {info['license']} |" in text, path


# T40: the Demo page's map gets positions only, no forecast for replayed hours
def test_meta_gives_the_demo_map_positions(client):
    from backend import map_data
    body = client.get("/api/meta").get_json()["map"]
    assert body["centre"] == {"lat": config.LATITUDE, "lon": config.LONGITUDE}
    assert [zone["name"] for zone in body["zones"]] == [zone["name"] for zone in map_data.ZONES]
    assert all(set(zone) == {"name", "lat", "lon"} for zone in body["zones"])
