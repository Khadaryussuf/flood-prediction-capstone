# CLAUDE.md

Real-time flood risk prediction for urban flash flooding in Nairobi.
Capstone project for ICS 4111.

## Stack
- Python, TensorFlow/Keras, scikit-learn
- Flask backend (serves predictions)
- React dashboard (planned, not started)

## Layout
- `data/` — raw and processed datasets
- `pipeline/` — data fetching and preprocessing
- `models/` — model definitions, trained models, and fitted scalers
- `notebooks/` — exploration and experiments
- `backend/` — Flask API

## Data
- Source: Open-Meteo historical archive API (ERA5-Land), Nairobi
- Hourly resolution, 2021–2025
- Features: rainfall, temperature, humidity, pressure, wind speed

## Preprocessing pipeline
1. Fill missing values with linear interpolation
2. Min-Max scaling (fit on the training split only)
3. Build sliding windows of 24 hours as model input
4. Chronological 70:15:15 train/val/test split, with **no shuffling**
   at any stage, to avoid leaking future data into training

## Models
1. Standard LSTM (build first)
2. Later: BiLSTM, CNN-LSTM, and an ARIMA baseline for comparison

## Rules
- Save the fitted scaler alongside the model so inference uses the
  exact same scaling as training.
- Every evaluation prints RMSE, MAE, and R² on the test set, for the report.
- Keep the split chronological. Never shuffle the data or the windows.
- Make small, focused commits with clear messages.

## Commands
- Install dependencies: TODO
- Fetch data: TODO
- Run preprocessing: TODO
- Train model: TODO
- Evaluate model: TODO
- Start Flask backend: TODO
