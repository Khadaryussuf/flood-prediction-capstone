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

# Paths
RAW_CSV = ROOT / "data" / "nairobi_meteorological_raw.csv"
WINDOWS_NPZ = ROOT / "data" / "processed" / "windows.npz"
SCALER_PATH = ROOT / "models" / "scaler.pkl"
LSTM_MODEL_PATH = ROOT / "models" / "lstm_model.keras"
