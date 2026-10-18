"""Shared settings for the data pipeline and models."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Location and period
LATITUDE = -1.2921
LONGITUDE = 36.8219
TIMEZONE = "Africa/Nairobi"
START_YEAR = 2021
END_YEAR = 2025

# Open-Meteo hourly variable names
FEATURES = [
    "precipitation",
    "temperature_2m",
    "relative_humidity_2m",
    "surface_pressure",
    "wind_speed_10m",
]
TARGET = "precipitation"

# Modelling settings
WINDOW = 24  # hours of history per sample
TRAIN_RATIO = 0.70
VAL_RATIO = 0.15
TEST_RATIO = 0.15
SEED = 42

# LSTM settings (used by train.py and recorded by evaluate.py)
LSTM_UNITS = 64
DROPOUT = 0.2
BATCH_SIZE = 64
MAX_EPOCHS = 100
EARLY_STOP_PATIENCE = 10

# Comparison models, sized to roughly the LSTM's ~18k parameters.
# They use the same dropout, batch size, epochs and early stopping.
BILSTM_UNITS = 44  # per direction
CNN_FILTERS = 32
CNN_KERNEL = 3
CNN_POOL = 2
CNN_LSTM_UNITS = 52

# ARIMA(p, 0, q) orders tried; the one with the lowest training AIC is used
ARIMA_P_VALUES = [0, 1, 2, 3]
ARIMA_Q_VALUES = [0, 1, 2]

# Flood risk levels from predicted next-hour rainfall (mm).
# Source: American Meteorological Society, Glossary of Meteorology, entry
# "rain": light = trace to 0.25 cm/h (2.5 mm/h), moderate = 0.26-0.76 cm/h
# (up to 7.6 mm/h), heavy = over 0.76 cm/h. Below 2.5 mm is "low", below
# 7.6 mm is "moderate", anything higher is "high" (so exactly 2.5 or 7.6 mm
# falls in the class above the AMS one). These are rain-intensity classes,
# NOT calibrated against Nairobi flood records.
RISK_THRESHOLDS_MM = [(2.5, "low"), (7.6, "moderate")]
HIGHEST_RISK = "high"
# Evaluation reports how many hours at or above this were predicted as such
HEAVY_RAIN_MM = RISK_THRESHOLDS_MM[0][0]

# Paths
RAW_CSV = ROOT / "data" / "nairobi_meteorological_raw.csv"
WINDOWS_NPZ = ROOT / "data" / "processed" / "windows.npz"
SCALER_PATH = ROOT / "models" / "scaler.pkl"
LSTM_MODEL_PATH = ROOT / "models" / "lstm_model.keras"
TRAINING_LOG_PATH = ROOT / "models" / "training_log.csv"
MODELS_DIR = ROOT / "models"  # other models: <name>_model.keras, <name>_training_log.csv
CNN_LSTM_MODEL_PATH = MODELS_DIR / "cnn_lstm_model.keras"
ARIMA_MODEL_PATH = MODELS_DIR / "arima_model.pkl"
# Model served by the Flask API: CNN-LSTM, chosen by lowest validation RMSE
# (rule and results in docs/model_comparison.md)
API_MODEL_PATH = CNN_LSTM_MODEL_PATH
ARIMA_LOG_PATH = MODELS_DIR / "arima_training_log.csv"
EXPERIMENTS_DIR = ROOT / "experiments"
SPLIT_SUMMARY_PATH = ROOT / "docs" / "split_summary.json"
