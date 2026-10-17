"""Flask API that serves next-hour rainfall predictions.

The default model is config.API_MODEL_PATH (the CNN-LSTM, chosen on
validation RMSE; see docs/model_comparison.md).

Run from the repo root:  python -m backend.app

Endpoints:
  GET  /health       - check the server is up, and which model is loaded
  POST /predict      - predict next-hour rainfall from the last 24 hours
  GET  /predictions  - the 20 most recent stored predictions
"""

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
from flask import Flask, jsonify, request
from sqlalchemy import DateTime, Float, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from tensorflow import keras

from pipeline import config
from pipeline.evaluate import to_mm

# Used when the DATABASE_URL environment variable is not set.
# The .db file is git-ignored.
DEFAULT_DATABASE_URL = "sqlite:///" + (config.ROOT / "data" / "predictions.db").as_posix()


# ---- Database table ------------------------------------------------------

class Base(DeclarativeBase):
    pass


class Prediction(Base):
    """One row per prediction made by /predict."""
    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    input_json: Mapped[str] = mapped_column(Text)  # the 24 readings as JSON
    predicted_mm: Mapped[float] = mapped_column(Float)
    risk_level: Mapped[str] = mapped_column(String(20))

    def to_dict(self):
        return {
            "id": self.id,
            "created_at": self.created_at.isoformat(),
            "input": json.loads(self.input_json),
            "predicted_mm": self.predicted_mm,
            "risk_level": self.risk_level,
        }


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


def risk_level(predicted_mm):
    """Map predicted rainfall to a risk level using the PROVISIONAL thresholds."""
    for limit, label in config.RISK_THRESHOLDS_MM:
        if predicted_mm < limit:
            return label
    return config.HIGHEST_RISK


# ---- App -----------------------------------------------------------------

def create_app(model_path=None, scaler_path=None, database_url=None):
    """Build the Flask app. Arguments default to the project's real files,
    so tests can pass their own paths and a temporary database."""
    model_path = Path(model_path or config.API_MODEL_PATH)
    scaler_path = Path(scaler_path or config.SCALER_PATH)
    database_url = database_url or os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)

    # Fail fast: without the model and scaler the API can't predict anything
    for path in (model_path, scaler_path):
        if not path.exists():
            raise FileNotFoundError(
                f"Required file not found: {path}. "
                "Run the pipeline (preprocess and train) first."
            )

    # Load the model and scaler once, at startup, not on every request
    model = keras.models.load_model(model_path)
    model_name = model_path.stem.removesuffix("_model")  # cnn_lstm_model.keras -> cnn_lstm
    scaler = joblib.load(scaler_path)
    target_idx = config.FEATURES.index(config.TARGET)

    # Connect to the database and create the table if it doesn't exist
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)

    app = Flask(__name__)
    app.config["DB_ENGINE"] = engine  # lets tests read the database directly

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

        # 2. Put the readings in the same column order used in training, and scale
        frame = pd.DataFrame(readings)[config.FEATURES]
        scaled = scaler.transform(frame)

        # 3. Predict. The model expects shape (samples, hours, features)
        window = scaled.reshape(1, config.WINDOW, len(config.FEATURES))
        scaled_pred = model.predict(window, verbose=0)[0, 0]

        # 4. Convert back to mm; rainfall can't be negative
        predicted_mm = round(max(0.0, float(to_mm(scaled_pred, scaler, target_idx))), 4)
        level = risk_level(predicted_mm)

        # 5. Store the prediction
        row = Prediction(
            created_at=datetime.now(timezone.utc),
            input_json=json.dumps(frame.to_dict(orient="records")),
            predicted_mm=predicted_mm,
            risk_level=level,
        )
        with Session(engine) as session:
            session.add(row)
            session.commit()
            row_id = row.id

        return jsonify({
            "id": row_id,
            "predicted_mm": predicted_mm,
            "risk_level": level,
            "thresholds": "PROVISIONAL",
        })

    @app.get("/predictions")
    def latest_predictions():
        with Session(engine) as session:
            query = select(Prediction).order_by(Prediction.id.desc()).limit(20)
            rows = session.scalars(query).all()
            return jsonify([row.to_dict() for row in rows])

    return app


if __name__ == "__main__":
    create_app().run(host="127.0.0.1", port=5000)
