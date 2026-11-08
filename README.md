# FloodWatch: Flood Prediction Capstone

Real-time flood risk prediction for urban flash flooding in Nairobi
(ICS 4111 capstone). A CNN-LSTM, chosen by lowest validation RMSE from an LSTM,
BiLSTM, CNN-LSTM and ARIMA baseline, predicts next-hour rainfall from the
previous 24 hours of weather. A Flask API serves the prediction with a rainfall
intensity risk level and stores every prediction in a database. FloodWatch, the
web app on top of it, gives responders and administrators live risk, a map,
alerts and history.

## Setup

Requires **Python 3.13**. TensorFlow 2.21 has no Windows wheels for 3.14.

```
py -3.13 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt   # the app plus pytest; a server needs only requirements.txt
```

## Run the pipeline

Run from the repo root with the venv active:

```
python -m pipeline.fetch_data    # download 2021-2025 hourly data -> data/nairobi_meteorological_raw.csv
python -m pipeline.preprocess    # split, interpolate, scale, window -> data/processed/, models/scaler.pkl
python -m pipeline.train         # train the LSTM -> models/lstm_model.keras, models/training_log.csv
python -m pipeline.evaluate      # test-set metrics -> experiments/run_<timestamp>/
```

## Run FloodWatch

The built web app is committed, so this needs no Node or npm.

```
copy .env.example .env           # then set SECRET_KEY, as the file explains
python -m scripts.create_admin   # first administrator; prompts for the password
python -m backend.app            # http://127.0.0.1:5000
```

For a server, `python -m backend.wsgi` serves the same app with waitress on
`0.0.0.0:8000` (`PORT`, `HOST`) as one process, and starts the hourly refresh once.
The `Dockerfile` builds an image for it; see `docs/DEVIATIONS.md` for the settings.

The server refuses to start without `SECRET_KEY`. For testing or the defense,
`python -m scripts.seed_demo` creates 1 administrator and 2 responders, prompting
for each password. Set `DATABASE_URL` first to keep them out of the real database.
No passwords are stored in this repository.

On start, and then every hour, the server fetches live data from the Open-Meteo
forecast API. The first run also fills about 30 days of history. Without network
access the app still runs, and says it has no reading or is showing the last good one.

To send alert emails, set the `SMTP_*` values in `.env`. Without them, each alert
records "not sent: email not configured", and in-app alerts still work.

### Screens

| Screen | Who | What |
|--------|-----|------|
| Login, sign-up | Anyone | Sign-up creates a Responder account that an administrator must approve |
| Dashboard | Everyone | Risk banner, Live/Stale/Fallback chip, alert banner, five readings, map, 24-hour rainfall |
| Historical Trends | Everyone | Predicted rainfall with risk shading, 24h/7d/30d, table, CSV export |
| Alerts | Everyone | Level, recipient, delivery status, Acknowledge, search; bell with unread count |
| Settings | Administrators | Users (approve, reject, role, disable), thresholds with preview, activity log |
| Model evidence | Everyone | The replay and model comparison analysis |
| Demo mode | Everyone | The replay with play, pause and speed. Labelled as not live; raises no alerts |

Security choices (sessions, CSRF, lockout, access rules) are described in
[docs/TESTING.md](docs/TESTING.md), under "Security and access control". Changes from
the proposal and Chapter 4 are in [docs/DEVIATIONS.md](docs/DEVIATIONS.md).

### API

Everything needs a session except `/health`, login, sign-up and static files.
Requests that change something also need the session's CSRF token in `X-CSRF-Token`;
`python -m scripts.demo_request` shows how, from a script. `/api/admin/*` needs an
Administrator.

| Endpoint | Description |
|----------|-------------|
| `GET /health` | `status`, and the served `model` and `model_file` |
| `POST /predict` | Body `{"readings": [...]}` with 24 hourly objects, each with `precipitation`, `temperature_2m`, `relative_humidity_2m`, `surface_pressure`, `wind_speed_10m`. Returns `predicted_mm`, `risk_level` and `"thresholds": "AMS rain intensity classes (not calibrated to Nairobi flood records)"`. |
| `GET /predictions` | The 20 most recent stored predictions |
| `/api/auth/*` | Session, login, logout, sign-up |
| `/api/admin/*` | Users, audit log, thresholds and preview, manual refresh |
| `GET /api/live/current` | Latest live prediction, freshness, readings and recent alert |
| `GET /api/map/forecast` | Forecast rainfall grid and watch zones: weather forecast, not model risk |
| `GET /api/history`, `/api/history.csv` | Past predictions, as JSON or CSV |
| `/api/alerts` | Alert rows, unread count, acknowledge |
| `GET /api/meta` | Thresholds, disclaimer, replay period and the wettest test hours |
| `GET /api/replay/<index>` | One 24-hour window from the held-out test split, and the actual next hour |
| `GET /api/comparison` | Model results, read from `docs/model_comparison.csv` and `docs/seed_robustness.csv` |

Predictions are stored with SQLAlchemy. Set the `DATABASE_URL` environment
variable to choose the database. By default it uses `data/predictions.db`
(SQLite, git-ignored).

## About the data on screen

Risk level is hourly rainfall intensity (AMS classes), not flood probability, and
is not calibrated to Nairobi flood records.

- **Dashboard:** live Open-Meteo forecast data, run through the same prediction path
  as `/predict`. These inputs differ from the ERA5 training data, so treat them as
  indicative. The model's risk applies to one grid cell. The map's rainfall grid and
  watch zones are a weather forecast, not model risk.
- **Model evidence and Demo mode:** a replay of the held-out test period, not live.
  Each step stores a row through `/predict`.
- `/predictions` doesn't record which model made a prediction, so the Model evidence
  timeline can show rows from a previously served model. For a demo, start on a fresh
  database by setting `DATABASE_URL`.

The app uses external services from the browser or server: OpenStreetMap map tiles
(browser) and Open-Meteo (server). Its own scripts and styles load only from Flask.

To change the web app, you need Node 24 or newer; see
[frontend/README.md](frontend/README.md). In short:

```
cd frontend
npm ci
npm run build    # writes backend/static/app; commit the result
npm run dev      # dev server, with Flask running
npm test
```

Third-party components and libraries, with versions and licences, are listed in
[THIRD_PARTY.md](THIRD_PARTY.md).

## Tests

```
python -m pytest -v
```

Frontend tests run with `npm test` in `frontend/`. Results are recorded in
[docs/TESTING.md](docs/TESTING.md).

## Demo

With the backend running, in a second terminal:

```
python -m scripts.demo_request
```

This sends the first 24 hours of the real test split and prints the response.

## Data source note

Data comes from the Open-Meteo historical archive API using the **ERA5**
reanalysis. The original plan was ERA5-Land, which has a finer ~9 km grid.
However, for Nairobi, Open-Meteo returned no values under ERA5-Land for 3 of
the 5 variables (precipitation, surface pressure and wind speed), so ERA5 is
used for all five.

## AI assistance

*Draft, for the author to review and adjust.* This project was developed
with the help of Claude Code, an AI coding assistant (Anthropic). It helped
plan the pipeline and backend, and it wrote code, tests and documentation in
response to the author's instructions. The project's design decisions were
made by the author.

## Known limitations

Numbers are for the served CNN-LSTM, from `experiments/run_20261017_210439/`
and [docs/model_comparison.md](docs/model_comparison.md) (test set: 6,550 hours,
2025-04-03 to 2025-12-31).

- **Modest accuracy.** CNN-LSTM R² is 0.3936 (RMSE 0.2999 mm). It beats the
  persistence baseline (R² 0.2188, RMSE 0.3404 mm), but most of the variance
  in hourly rainfall is still unexplained.
- **MAE is worse than persistence.** CNN-LSTM MAE is 0.0809 mm versus 0.0707 mm.
  On the 5,010 dry hours, it predicts small amounts of rain (MAE 0.0393 mm vs
  0.0122 mm). On the 1,540 wet hours it does better than persistence (MAE
  0.2162 mm vs 0.2612 mm).
- **It misses most heavy rain.** It predicted at least 2.5 mm for 7 of the 35
  test hours that reached 2.5 mm. ARIMA caught 9 and persistence 12. Its highest
  prediction is 4.31 mm against a highest actual of 9.30 mm, so on the test
  period it never predicts the high class.
- **Close results between models.** CNN-LSTM and BiLSTM can't be told apart on
  test RMSE: their seed means differ by 0.0002 mm, less than the larger seed SD
  of 0.0037 mm. See [docs/seed_robustness.md](docs/seed_robustness.md).
- **Risk level is a rain-intensity class, not a flood probability.** It uses
  the American Meteorological Society's hourly rain intensity classes
  (Glossary of Meteorology, entry "rain": light up to 2.5 mm/h, moderate up
  to 7.6 mm/h, heavy above), applied as low < 2.5 mm, moderate < 7.6 mm,
  high otherwise. It is not calibrated against Nairobi flood records.
  Kenya Met's own heavy-rain bands are 24-hour totals (heavy 20-50 mm, very
  heavy over 50 mm, per news reports of its October 2025 advisory), so they
  are not directly comparable to these hourly values.
- **SQLite instead of PostgreSQL** for now. The code reads `DATABASE_URL`,
  so switching later only needs a different URL and driver.
- **CPU only.** TensorFlow has no GPU support on native Windows.
- **Coarse ERA5 grid.** At 0.25° (~31 km), one grid cell covers much of
  Nairobi, so local storms smaller than the cell are smoothed out.
