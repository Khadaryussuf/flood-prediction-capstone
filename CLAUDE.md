# CLAUDE.md

Real-time flood risk prediction for urban flash flooding in Nairobi.
Capstone project for ICS 4111.

## Stack
- Python, TensorFlow/Keras, scikit-learn
- Flask backend (serves predictions)
- React dashboard (Vite, Tailwind, shadcn/ui), built into `backend/static/app/`
  and served by Flask at `/dashboard`

## Layout
- `data/` — raw and processed datasets
- `pipeline/` — data fetching and preprocessing
- `models/` — model definitions, trained models, and fitted scalers
- `notebooks/` — exploration and experiments
- `backend/` — Flask API; `tests/` — pytest; `scripts/` — demo client
- `frontend/` — dashboard source; `backend/static/app/` — its committed build
- `experiments/` — saved evaluation runs; `docs/` — testing and report notes

## Data
- Source: Open-Meteo historical archive API (ERA5), Nairobi. Not ERA5-Land:
  it returns no precipitation, pressure or wind for this location.
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
Use Python 3.13 (TensorFlow has no 3.14 wheels on Windows). Run from the
repo root with the venv active.
- Set up: `py -3.13 -m venv .venv`, `.venv\Scripts\Activate.ps1`,
  `pip install -r requirements.txt`
- Fetch data: `python -m pipeline.fetch_data`
- Run preprocessing: `python -m pipeline.preprocess`
- Train model: `python -m pipeline.train`
- Evaluate model: `python -m pipeline.evaluate` (writes `experiments/run_<timestamp>/`)
- Seed robustness (seeds 1-4 into git-ignored `models/seeds/`, then the
  summary in `docs/seed_robustness.*`): `python -m pipeline.run_seeds`,
  then `python -m pipeline.seed_robustness`
- Start Flask backend: `python -m backend.app` (http://127.0.0.1:5000)
- Run tests: `python -m pytest -v` (record results in `docs/TESTING.md`)
- Demo (server running): `python -m scripts.demo_request`
- Dashboard (server running): http://127.0.0.1:5000/dashboard

Frontend commands run in `frontend/` and need Node 24 or newer. Running the
dashboard needs neither.
- Set up: `npm ci`
- Build: `npm run build` (writes `backend/static/app/`; commit the result)
- Dev server (Flask running): `npm run dev`
- Tests: `npm test` (record results in `docs/TESTING.md`)
- Contrast check: `npm run contrast`
- Third-party list: `npm run third-party` (regenerates `THIRD_PARTY.md`; run
  after changing dependencies)
- Screenshots (Flask running on a scratch `DATABASE_URL`):
  `node scripts/screenshots.mjs <label>`
