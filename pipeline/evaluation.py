"""Shared scoring code, so every model is evaluated by identical code.

Loads the windows, converts to mm, computes the metrics and saves the
evidence for a run to experiments/run_<timestamp>/.
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

from pipeline import config
from pipeline.preprocess import chronological_split, load_hourly

# Packages whose versions are recorded in versions.txt
PACKAGES = ["tensorflow", "keras", "scikit-learn", "statsmodels", "pandas",
            "numpy", "flask", "sqlalchemy", "pytest"]

SPLITS = ["train", "val", "test"]
TARGET_IDX = config.FEATURES.index(config.TARGET)


def to_mm(scaled, scaler, target_idx):
    """Undo Min-Max scaling for the target column only."""
    return scaled * scaler.data_range_[target_idx] + scaler.data_min_[target_idx]


def load_windows():
    return np.load(config.WINDOWS_NPZ)


def load_scaler():
    return joblib.load(config.SCALER_PATH)


def actual_mm(data, split, scaler):
    """True next-hour rainfall in mm for every window of a split."""
    return to_mm(data[f"y_{split}"], scaler, TARGET_IDX)


def persistence_mm(data, split, scaler):
    """Persistence baseline: next hour's rainfall equals the last observed hour."""
    return to_mm(data[f"X_{split}"][:, -1, TARGET_IDX], scaler, TARGET_IDX)


def interpolated_splits():
    """Train/val/test DataFrames in raw units, interpolated as in preprocess."""
    return [s.interpolate(method="linear", limit_direction="both")
            for s in chronological_split(load_hourly())]


def target_times(split):
    """Timestamps of the targets: window i predicts hour i + WINDOW of the split."""
    return chronological_split(load_hourly())[SPLITS.index(split)].index[config.WINDOW:]


def compute_metrics(y_true, y_pred):
    """RMSE, MAE and R2 overall, MAE on dry and wet hours separately, and how
    well hours with actual rainfall >= HEAVY_RAIN_MM are caught."""
    # ERA5 rainfall has 0.1 mm resolution; rounding removes float noise
    wet = np.round(y_true, 1) > 0
    dry = ~wet
    heavy = np.round(y_true, 1) >= config.HEAVY_RAIN_MM
    hits = int((y_pred[heavy] >= config.HEAVY_RAIN_MM).sum())
    return {
        "rmse_mm": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae_mm": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
        "mae_dry_mm": float(mean_absolute_error(y_true[dry], y_pred[dry])),
        "mae_wet_mm": float(mean_absolute_error(y_true[wet], y_pred[wet])),
        "n_dry_hours": int(dry.sum()),
        "n_wet_hours": int(wet.sum()),
        "n_heavy_actual": int(heavy.sum()),
        "n_heavy_hit": hits,
        "heavy_recall": float(hits / heavy.sum()) if heavy.any() else None,
        "max_pred_mm": float(y_pred.max()),
        "max_actual_mm": float(y_true.max()),
        "max_pred_on_heavy_mm": float(y_pred[heavy].max()) if heavy.any() else None,
    }


def print_metrics(label, m):
    print(f"{label:12s} RMSE={m['rmse_mm']:.4f} mm  MAE={m['mae_mm']:.4f} mm  "
          f"R2={m['r2']:.4f}  MAE dry={m['mae_dry_mm']:.4f}  "
          f"MAE wet={m['mae_wet_mm']:.4f}  "
          f">={config.HEAVY_RAIN_MM} mm hit {m['n_heavy_hit']}/{m['n_heavy_actual']}  "
          f"max pred={m['max_pred_mm']:.2f} vs actual={m['max_actual_mm']:.2f}")


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


def score_and_save(name, preds, params, training_log, git, extra_info=None,
                   runs_dir=None, seed=config.SEED):
    """Score a model on val and test, print the metrics, and save the run.

    preds: {"val": y_pred_mm, "test": y_pred_mm}, one prediction per window.
    git: git_info() taken at the start, before the run created any files.
    runs_dir, seed: where the run folder goes and the seed recorded in
    params.json; only the robustness seeds (models/seeds/) change these.
    """
    data = load_windows()
    scaler = load_scaler()

    metrics, val_metrics = {}, {}
    for split, out in [("test", metrics), ("val", val_metrics)]:
        y_true = actual_mm(data, split, scaler)
        y_pred = np.clip(np.asarray(preds[split], dtype=float), 0, None)  # rainfall can't be negative
        assert y_pred.shape == y_true.shape, (split, y_pred.shape, y_true.shape)
        out[name] = compute_metrics(y_true, y_pred)
        out["persistence"] = compute_metrics(y_true, persistence_mm(data, split, scaler))
        print(f"{split} set: {len(y_true)} samples")
        print_metrics(name, out[name])
        print_metrics("persistence", out["persistence"])
    metrics["val_metrics"] = val_metrics

    # Create a new folder for this run
    now = datetime.now()
    run_dir = (runs_dir or config.EXPERIMENTS_DIR) / f"run_{now:%Y%m%d_%H%M%S}"
    run_dir.mkdir(parents=True)

    save_json(run_dir / "metrics.json", metrics)

    y_test = actual_mm(data, "test", scaler)
    pd.DataFrame({
        "time": target_times("test"),
        "actual_mm": y_test,
        f"{name}_mm": np.clip(preds["test"], 0, None),
        "persistence_mm": persistence_mm(data, "test", scaler),
    }).to_csv(run_dir / "predictions.csv", index=False, float_format="%.4f")

    shutil.copy(training_log, run_dir / "training_log.csv")

    save_json(run_dir / "params.json", {
        "window_hours": config.WINDOW,
        "split": {"train": config.TRAIN_RATIO, "val": config.VAL_RATIO,
                  "test": config.TEST_RATIO},
        "seed": seed,
        "features": config.FEATURES,
        "target": config.TARGET,
        "heavy_rain_mm": config.HEAVY_RAIN_MM,
        "model": params,
    })

    (run_dir / "versions.txt").write_text(package_versions())

    save_json(run_dir / "run_info.json", {
        "model": name,
        "timestamp": now.isoformat(timespec="seconds"),
        **git,
        "dataset_rows": len(pd.read_csv(config.RAW_CSV)),
        "val_samples": len(data["y_val"]),
        "test_samples": len(y_test),
        **(extra_info or {}),
    })

    print(f"Saved run evidence to {run_dir}")
    return run_dir
