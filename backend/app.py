"""Flask API that serves next-hour rainfall predictions.

The default model is config.API_MODEL_PATH (the CNN-LSTM, chosen on
validation RMSE; see docs/model_comparison.md).

Run from the repo root:  python -m backend.app

Endpoints:
  GET  /health               - check the server is up, and which model is loaded
  POST /predict              - predict next-hour rainfall from the last 24 hours
  GET  /predictions          - the 20 most recent stored predictions
  GET  /dashboard            - the dashboard page (built from frontend/)
  GET  /api/meta             - thresholds, disclaimer and replay period for the dashboard
  GET  /api/replay/<index>   - one 24-hour window from the held-out test split
  GET  /api/comparison       - model comparison and seed results, read from docs/

Accounts and sessions are in backend/auth.py and backend/security.py. Everything
needs a session except /health, login, sign-up and static files.
"""

import csv
import json
import math
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from flask import Flask, jsonify, redirect, request, send_file
from sqlalchemy import select
from sqlalchemy.orm import Session
from tensorflow import keras

from backend import alerts, auth, live, map_data, scheduler, security, thresholds as limits
from backend.db import DEFAULT_DATABASE_URL, Prediction, make_engine  # noqa: F401
from backend.env import load_env
from pipeline import config
from pipeline.evaluate import to_mm
from pipeline.preprocess import chronological_split, load_hourly

# Shown on every dashboard view
DISCLAIMER = ("Risk level is hourly rainfall intensity (AMS classes), not flood "
              "probability, and is not calibrated to Nairobi flood records.")
REPLAY_LABEL = "Replay of held-out test period (not live)"

# The built dashboard (npm run build in frontend/ writes here)
DASHBOARD_INDEX = Path(__file__).resolve().parent / "static" / "app" / "index.html"

# Result files the comparison panel reads. Read only, never written here.
COMPARISON_CSV = config.ROOT / "docs" / "model_comparison.csv"
SEED_CSV = config.ROOT / "docs" / "seed_robustness.csv"
BASELINES = {"ARIMA", "Persistence"}
WETTEST_COUNT = 10  # how many of the wettest test hours the dashboard can jump to


# ---- Helpers -------------------------------------------------------------

def is_number(value):
    """True for real, finite numbers. Rejects booleans, strings, null, NaN, inf."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return math.isfinite(value)


def validate_readings(body):
    """Check the request body. Returns an error message, or None if valid."""
    if not isinstance(body, dict):
        return "Request body must be a JSON object"
    readings = body.get("readings")
    if not isinstance(readings, list):
        return "'readings' must be a list"
    if len(readings) != config.WINDOW:
        return f"'readings' must contain exactly {config.WINDOW} hourly readings, got {len(readings)}"

    for i, reading in enumerate(readings):
        if not isinstance(reading, dict):
            return f"Reading {i} must be an object"
        for feature in config.FEATURES:
            if feature not in reading:
                return f"Reading {i} is missing field '{feature}'"
            if not is_number(reading[feature]):
                return f"Reading {i} field '{feature}' must be a number"
    return None


def load_test_split():
    """The held-out test split in raw units, interpolated the same way as
    in preprocess.py (within the split only)."""
    test = chronological_split(load_hourly())[2]
    return test.interpolate(method="linear", limit_direction="both")


def number_or_none(text):
    """CSV cell to float, or None for an empty cell."""
    return float(text) if text.strip() else None


def read_comparison():
    """Combine docs/model_comparison.csv and docs/seed_robustness.csv into
    one entry per model, for the dashboard's comparison panel."""
    with open(COMPARISON_CSV, newline="") as f:
        comparison = list(csv.DictReader(f))
    with open(SEED_CSV, newline="") as f:
        seed_rows = list(csv.DictReader(f))

    served = config.API_MODEL_PATH.stem.removesuffix("_model")  # cnn_lstm
    models = []
    for row in comparison:
        name = row["model"]
        mean = next((r for r in seed_rows if r["model"] == name and r["seed"] == "mean"), None)
        sd = next((r for r in seed_rows if r["model"] == name and r["seed"] == "sd"), None)
        seeds = None
        if mean and sd:
            n_seeds = sum(1 for r in seed_rows if r["model"] == name and r["seed"].isdigit())
            seeds = {
                "n_seeds": n_seeds,
                "seed_list": [int(r["seed"]) for r in seed_rows
                              if r["model"] == name and r["seed"].isdigit()],
                "mean": {key: number_or_none(mean[key])
                         for key in ("val_rmse_mm", "test_rmse_mm", "test_heavy_hit")},
                "sd": {key: number_or_none(sd[key])
                       for key in ("val_rmse_mm", "test_rmse_mm", "test_heavy_hit")},
            }
        models.append({
            "model": name,
            "run": row["run"],
            "is_baseline": name in BASELINES,
            "selected": name.lower().replace("-", "_") == served,
            "val_rmse_mm": number_or_none(row["val_rmse_mm"]),
            "val_mae_mm": number_or_none(row["val_mae_mm"]),
            "val_heavy_hit": int(row["val_heavy_hit"]),
            "val_heavy_actual": int(row["val_heavy_actual"]),
            "test_rmse_mm": number_or_none(row["test_rmse_mm"]),
            "test_mae_mm": number_or_none(row["test_mae_mm"]),
            "test_r2": number_or_none(row["test_r2"]),
            "test_heavy_hit": int(row["test_heavy_hit"]),
            "test_heavy_actual": int(row["test_heavy_actual"]),
            "test_heavy_recall": number_or_none(row["test_heavy_recall"]),
            "test_max_pred_mm": number_or_none(row["test_max_pred_mm"]),
            "test_max_actual_mm": number_or_none(row["test_max_actual_mm"]),
            "seeds": seeds,  # None: single deterministic run
        })
    return {
        "selection_rule": "lowest validation RMSE",
        "heavy_rain_mm": config.HEAVY_RAIN_MM,
        "sources": [f"docs/{COMPARISON_CSV.name}", f"docs/{SEED_CSV.name}"],
        "models": models,
    }


# ---- App -----------------------------------------------------------------

def create_app(model_path=None, scaler_path=None, database_url=None, testing=False):
    """Build the Flask app. Arguments default to the project's real files,
    so tests can pass their own paths and a temporary database. Only tests may
    run without a SECRET_KEY; they get a random one."""
    model_path = Path(model_path or config.API_MODEL_PATH)
    scaler_path = Path(scaler_path or config.SCALER_PATH)

    # Fail fast: without the model and scaler the API can't predict anything
    for path in (model_path, scaler_path):
        if not path.exists():
            raise FileNotFoundError(
                f"Required file not found: {path}. "
                "Run the pipeline (preprocess and train) first."
            )

    load_env()
    secret_key = os.environ.get("SECRET_KEY") or (secrets.token_hex(32) if testing else None)
    if not secret_key:
        raise RuntimeError(
            "SECRET_KEY is not set. Copy .env.example to .env and set it; "
            "the file explains how to generate one."
        )

    # Load the model and scaler once, at startup, not on every request
    model = keras.models.load_model(model_path)
    model_name = model_path.stem.removesuffix("_model")  # cnn_lstm_model.keras -> cnn_lstm
    scaler = joblib.load(scaler_path)
    target_idx = config.FEATURES.index(config.TARGET)

    # Connect to the database and create the tables if they don't exist
    engine = make_engine(database_url)

    app = Flask(__name__)
    app.config["DB_ENGINE"] = engine  # lets tests read the database directly
    app.testing = testing
    security.configure_sessions(app, secret_key)
    app.before_request(lambda: security.check_request(engine))
    app.after_request(security.add_security_headers)
    app.register_blueprint(auth.bp)

    predict_lock = threading.Lock()  # the scheduler thread also uses the model

    def predict_many(frames):
        """The prediction path: readings in training column order, scaled, through
        the model, back to mm. Rainfall can't be negative."""
        scaled = np.stack([scaler.transform(frame) for frame in frames])
        with predict_lock:
            outputs = model.predict(scaled, verbose=0)
        return [round(max(0.0, float(to_mm(value[0], scaler, target_idx))), 4) for value in outputs]

    def predict_mm(frame):
        return predict_many([frame])[0]

    app.config["PREDICT_MM"] = predict_mm
    app.config["PREDICT_MANY"] = predict_many
    app.register_blueprint(live.bp)
    app.register_blueprint(map_data.bp)
    app.register_blueprint(alerts.bp)

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "model": model_name,
                        "model_file": model_path.name})

    @app.post("/predict")
    def predict():
        # 1. Validate the input
        body = request.get_json(silent=True)  # None if the body isn't valid JSON
        error = validate_readings(body)
        if error:
            return jsonify({"error": error}), 400
        readings = body["readings"]

        # 2. Put the readings in the same column order used in training, and predict
        frame = pd.DataFrame(readings)[config.FEATURES]
        predicted_mm = predict_mm(frame)

        # 3. Store the prediction
        with Session(engine) as session:
            level = limits.classify(predicted_mm, limits.current_thresholds(session))
            row = Prediction(
                created_at=datetime.now(timezone.utc),
                input_json=json.dumps(frame.to_dict(orient="records")),
                predicted_mm=predicted_mm,
                risk_level=level,
            )
            session.add(row)
            session.commit()
            row_id = row.id

        return jsonify({
            "id": row_id,
            "predicted_mm": predicted_mm,
            "risk_level": level,
            "thresholds": "AMS rain intensity classes (not calibrated to Nairobi flood records)",
        })

    @app.get("/predictions")
    def latest_predictions():
        with Session(engine) as session:
            query = select(Prediction).order_by(Prediction.id.desc()).limit(20)
            rows = session.scalars(query).all()
            return jsonify([row.to_dict() for row in rows])

    # ---- Dashboard -------------------------------------------------------

    # The test split is loaded the first time the dashboard asks for it,
    # so starting the API stays fast
    replay_cache = {}

    def replay_split():
        if "test" not in replay_cache:
            replay_cache["test"] = load_test_split()
        return replay_cache["test"]

    @app.get("/")
    def home():
        return redirect("/dashboard")

    # The browser pages all load the same built app, which shows the right
    # screen for the address. Access rules are in security.check_request.
    @app.get("/login")
    @app.get("/signup")
    @app.get("/dashboard")
    @app.get("/trends")
    @app.get("/alerts")
    @app.get("/settings")
    @app.get("/evidence")
    @app.get("/demo")
    def page():
        if not DASHBOARD_INDEX.exists():
            return ("Dashboard not built yet. Run: cd frontend; npm ci; npm run build",
                    503, {"Content-Type": "text/plain; charset=utf-8"})
        return send_file(DASHBOARD_INDEX)

    @app.get("/api/meta")
    def meta():
        with Session(engine) as session:
            active_thresholds = limits.current_thresholds(session)
        test = replay_split()
        window_count = len(test) - config.WINDOW
        # Target hour i is row i + WINDOW, the same pairing as make_windows
        targets = test[config.TARGET].iloc[config.WINDOW:].reset_index(drop=True)
        wettest = targets.sort_values(ascending=False, kind="stable").head(WETTEST_COUNT)
        return jsonify({
            "disclaimer": DISCLAIMER,
            "data_label": REPLAY_LABEL,
            "timezone": config.TIMEZONE,
            "thresholds": limits.thresholds_payload(active_thresholds),
            "highest_risk": config.HIGHEST_RISK,
            "test_period": {"start": test.index[0].isoformat(),
                            "end": test.index[-1].isoformat()},
            "window_hours": config.WINDOW,
            "window_count": window_count,
            "wettest": [{"index": int(i), "actual_mm": float(mm),
                         "target_time": test.index[i + config.WINDOW].isoformat()}
                        for i, mm in wettest.items()],
        })

    @app.get("/api/replay/<int(signed=True):index>")
    def replay(index):
        test = replay_split()
        window_count = len(test) - config.WINDOW
        if not 0 <= index < window_count:
            return jsonify({"error": f"index must be between 0 and {window_count - 1}"}), 400
        window = test.iloc[index:index + config.WINDOW]
        target_time = test.index[index + config.WINDOW]
        return jsonify({
            "index": index,
            "window_count": window_count,
            "window_start": window.index[0].isoformat(),
            "window_end": window.index[-1].isoformat(),
            "target_time": target_time.isoformat(),
            "times": [t.isoformat() for t in window.index],
            "readings": window[config.FEATURES].to_dict(orient="records"),
            "actual_next_mm": float(test[config.TARGET].iloc[index + config.WINDOW]),
        })

    @app.get("/api/comparison")
    def comparison():
        return jsonify(read_comparison())

    return app


if __name__ == "__main__":
    flask_app = create_app()
    scheduler.start(flask_app)
    flask_app.run(host="127.0.0.1", port=5000)
