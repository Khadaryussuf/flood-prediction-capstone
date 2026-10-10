"""Evaluate the trained LSTM on the test set, in mm of rainfall."""

import joblib
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from tensorflow import keras

from pipeline import config


def to_mm(scaled, scaler, target_idx):
    return scaled * scaler.data_range_[target_idx] + scaler.data_min_[target_idx]


def print_metrics(label, y_true, y_pred):
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)
    r2 = r2_score(y_true, y_pred)
    print(f"{label:12s} RMSE={rmse:.4f} mm  MAE={mae:.4f} mm  R2={r2:.4f}")


def main():
    data = np.load(config.WINDOWS_NPZ)
    X_test, y_test = data["X_test"], data["y_test"]
    scaler = joblib.load(config.SCALER_PATH)
    model = keras.models.load_model(config.LSTM_MODEL_PATH)
    target_idx = config.FEATURES.index(config.TARGET)

    y_true = to_mm(y_test, scaler, target_idx)
    y_pred = to_mm(model.predict(X_test, verbose=0).ravel(), scaler, target_idx)
    y_pred = np.clip(y_pred, 0, None)

    # Persistence baseline: next hour's rainfall equals the last observed hour
    y_persist = to_mm(X_test[:, -1, target_idx], scaler, target_idx)

    print(f"Test set: {len(y_true)} samples")
    print_metrics("LSTM", y_true, y_pred)
    print_metrics("Persistence", y_true, y_persist)


if __name__ == "__main__":
    main()
