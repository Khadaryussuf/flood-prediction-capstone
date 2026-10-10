"""Turn the raw CSV into scaled 24-hour windows for the models.

Order matters to avoid leakage: split by time first, then interpolate
within each split, then fit the scaler on the training split only.
"""

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler

from pipeline import config


def load_hourly():
    df = pd.read_csv(config.RAW_CSV, parse_dates=["time"]).set_index("time")
    full_range = pd.date_range(df.index.min(), df.index.max(), freq="h")
    missing = len(full_range) - len(df)
    if missing:
        print(f"Reindexing: {missing} missing hours added as NaN")
    return df.reindex(full_range)[config.FEATURES]


def chronological_split(df):
    n = len(df)
    train_end = int(n * config.TRAIN_RATIO)
    val_end = int(n * (config.TRAIN_RATIO + config.VAL_RATIO))
    return df.iloc[:train_end], df.iloc[train_end:val_end], df.iloc[val_end:]


def make_windows(values, target_idx):
    X, y = [], []
    for i in range(len(values) - config.WINDOW):
        X.append(values[i : i + config.WINDOW])
        y.append(values[i + config.WINDOW, target_idx])
    return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)


def main():
    df = load_hourly()
    splits = chronological_split(df)
    splits = [s.interpolate(method="linear", limit_direction="both") for s in splits]

    scaler = MinMaxScaler()
    scaler.fit(splits[0])
    config.SCALER_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(scaler, config.SCALER_PATH)

    target_idx = config.FEATURES.index(config.TARGET)
    arrays = {}
    for name, split in zip(["train", "val", "test"], splits):
        scaled = scaler.transform(split)
        X, y = make_windows(scaled, target_idx)
        arrays[f"X_{name}"] = X
        arrays[f"y_{name}"] = y
        print(f"{name:5s} {split.index.min()} to {split.index.max()}  "
              f"X={X.shape} y={y.shape}")

    config.WINDOWS_NPZ.parent.mkdir(parents=True, exist_ok=True)
    np.savez(config.WINDOWS_NPZ, **arrays)
    print(f"Saved windows to {config.WINDOWS_NPZ}")
    print(f"Saved scaler to {config.SCALER_PATH}")


if __name__ == "__main__":
    main()
