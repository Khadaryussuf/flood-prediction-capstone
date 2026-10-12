"""Evaluate the trained LSTM on the test set, in mm of rainfall.

Prints the metrics and saves the evidence for this run to
experiments/run_<timestamp>/ so results in the report can be traced.
"""

import json
import shutil
import subprocess
import sys
from datetime import datetime
from importlib import metadata

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from tensorflow import keras

from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly

# Packages whose versions are recorded in versions.txt
PACKAGES = ["tensorflow", "keras", "scikit-learn", "pandas", "numpy",
            "flask", "sqlalchemy", "pytest"]


def to_mm(scaled, scaler, target_idx):
    """Undo Min-Max scaling for the target column only."""
    return scaled * scaler.data_range_[target_idx] + scaler.data_min_[target_idx]


def compute_metrics(y_true, y_pred):
    """RMSE, MAE and R2 overall, plus MAE on dry and wet hours separately."""
    # ERA5 rainfall has 0.1 mm resolution; rounding removes float noise
    wet = np.round(y_true, 1) > 0
    dry = ~wet
    return {
        "rmse_mm": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae_mm": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
        "mae_dry_mm": float(mean_absolute_error(y_true[dry], y_pred[dry])),
        "mae_wet_mm": float(mean_absolute_error(y_true[wet], y_pred[wet])),
        "n_dry_hours": int(dry.sum()),
        "n_wet_hours": int(wet.sum()),
    }


def print_metrics(label, m):
    print(f"{label:12s} RMSE={m['rmse_mm']:.4f} mm  MAE={m['mae_mm']:.4f} mm  "
          f"R2={m['r2']:.4f}  MAE dry={m['mae_dry_mm']:.4f}  "
          f"MAE wet={m['mae_wet_mm']:.4f}")


def package_versions():
    """Python version plus the version of each package, one per line."""
    lines = [f"python=={sys.version.split()[0]}"]
    for name in PACKAGES:
        try:
            lines.append(f"{name}=={metadata.version(name)}")
        except metadata.PackageNotFoundError:
            lines.append(f"{name}==not installed")
    return "\n".join(lines) + "\n"


def git_info():
    """Current commit hash, and whether there are uncommitted changes."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=config.ROOT,
                              capture_output=True, text=True).stdout.strip()
    return {"git_commit": git("rev-parse", "HEAD"),
            "git_dirty": git("status", "--porcelain") != ""}


def save_json(path, data):
    path.write_text(json.dumps(data, indent=2) + "\n")


def main():
    # Load the test windows, the scaler and the trained model
    data = np.load(config.WINDOWS_NPZ)
    X_test, y_test = data["X_test"], data["y_test"]
    scaler = joblib.load(config.SCALER_PATH)
    model = keras.models.load_model(config.LSTM_MODEL_PATH)
    target_idx = config.FEATURES.index(config.TARGET)

    # Predict, then convert everything back to mm
    y_true = to_mm(y_test, scaler, target_idx)
    y_pred = to_mm(model.predict(X_test, verbose=0).ravel(), scaler, target_idx)
    y_pred = np.clip(y_pred, 0, None)  # rainfall can't be negative

    # Persistence baseline: next hour's rainfall equals the last observed hour
    y_persist = to_mm(X_test[:, -1, target_idx], scaler, target_idx)

    metrics = {"lstm": compute_metrics(y_true, y_pred),
               "persistence": compute_metrics(y_true, y_persist)}
    print(f"Test set: {len(y_true)} samples")
    print_metrics("LSTM", metrics["lstm"])
    print_metrics("Persistence", metrics["persistence"])

    # Timestamps: window i predicts hour i + WINDOW of the test split
    hourly = load_hourly()
    test_split = chronological_split(hourly)[2]
    times = test_split.index[config.WINDOW:]

    # Create a new folder for this run
    now = datetime.now()
    run_dir = config.EXPERIMENTS_DIR / f"run_{now:%Y%m%d_%H%M%S}"
    run_dir.mkdir(parents=True)

    save_json(run_dir / "metrics.json", metrics)

    pd.DataFrame({
        "time": times,
        "actual_mm": y_true,
        "lstm_mm": y_pred,
        "persistence_mm": y_persist,
    }).to_csv(run_dir / "predictions.csv", index=False, float_format="%.4f")

    shutil.copy(config.TRAINING_LOG_PATH, run_dir / "training_log.csv")

    save_json(run_dir / "params.json", {
        "window_hours": config.WINDOW,
        "split": {"train": config.TRAIN_RATIO, "val": config.VAL_RATIO,
                  "test": config.TEST_RATIO},
        "seed": config.SEED,
        "features": config.FEATURES,
        "target": config.TARGET,
        "model": {"type": "LSTM", "units": config.LSTM_UNITS,
                  "dropout": config.DROPOUT, "batch_size": config.BATCH_SIZE,
                  "max_epochs": config.MAX_EPOCHS,
                  "early_stop_patience": config.EARLY_STOP_PATIENCE,
                  "optimizer": "adam", "loss": "mse"},
    })

    (run_dir / "versions.txt").write_text(package_versions())

    save_json(run_dir / "run_info.json", {
        "timestamp": now.isoformat(timespec="seconds"),
        **git_info(),
        "dataset_rows": len(pd.read_csv(config.RAW_CSV)),
        "test_samples": len(y_true),
    })

    print(f"Saved run evidence to {run_dir}")


if __name__ == "__main__":
    main()
