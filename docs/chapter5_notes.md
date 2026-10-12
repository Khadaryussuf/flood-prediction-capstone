# Chapter 5 evidence notes

Evidence notes for the report, not prose. Every number below is copied from
a saved file, and the file is named in brackets. Run folder:
`experiments/run_20261012_132216/` (shortened to `run/` below).

## Run identity
- Timestamp 2026-10-12T13:22:16 [run/run_info.json]
- Git commit 6f340083f1d670854e163889a500a23158260bc8, `git_dirty` false [run/run_info.json]
- Dataset rows: 43,824 hourly rows, 2021-01-01 00:00 to 2025-12-31 23:00 [run/run_info.json; data/nairobi_meteorological_raw.csv]
- Test samples: 6,550 [run/run_info.json]
- Test predictions cover 2025-04-03 02:00 to 2025-12-31 23:00 [run/predictions.csv, first and last rows]
- Software: Python 3.13.14, TensorFlow 2.21.0, Keras 3.15.1, scikit-learn 1.9.1, pandas 3.0.6, numpy 2.5.3 [run/versions.txt]
  - Flask, SQLAlchemy and pytest are listed as "not installed" because they were added after this run. They don't affect the model results.

## Setup
- Data source: Open-Meteo archive, ERA5 reanalysis (ERA5-Land returned no precipitation, pressure or wind for Nairobi) [pipeline/fetch_data.py docstring]
- Features: precipitation, temperature_2m, relative_humidity_2m, surface_pressure, wind_speed_10m. Target: precipitation, 1 hour ahead [run/params.json]
- Window: 24 hours [run/params.json]
- Split: 0.70 / 0.15 / 0.15, chronological, no shuffling [run/params.json; pipeline/preprocess.py]
- Seed: 42 [run/params.json]
- Model: LSTM 64 units → Dropout 0.2 → Dense 1. Adam optimiser, MSE loss, batch size 64, max 100 epochs, early-stopping patience 10 [run/params.json]

## Training
- Ran 12 epochs; early stopping restored the best weights [run/training_log.csv: 12 rows, epoch 0–11]
- Best val_loss: 0.0006355688 at epoch index 1, which is epoch 2 when counting from 1 [run/training_log.csv]
- Training loss at that epoch: 0.0009914784 [run/training_log.csv]
- Last epoch (index 11): loss 0.0007549846, val_loss 0.0006426086 [run/training_log.csv]
- Training loss kept falling while validation loss didn't improve → early overfitting [run/training_log.csv]

## Test metrics (mm) [run/metrics.json]

| Metric | LSTM | Persistence |
|---|---|---|
| RMSE | 0.3223 | 0.3404 |
| MAE | 0.1095 | 0.0707 |
| R² | 0.2997 | 0.2188 |
| MAE, dry hours | 0.0750 | 0.0122 |
| MAE, wet hours | 0.2216 | 0.2612 |
| Dry hours (n) | 5,010 | 5,010 |
| Wet hours (n) | 1,540 | 1,540 |

- The LSTM is better on RMSE, R² and wet-hour MAE.
- It is worse on overall MAE and dry-hour MAE, because it predicts small amounts of rain when none falls.
- First test row: actual 0.0000, LSTM 0.0703, persistence 0.0000 [run/predictions.csv]

## Peaks [derived from run/predictions.csv]
- Largest actual hourly rainfall: 9.3 mm. Largest LSTM prediction: 3.2404 mm → the model underpredicts peaks.
- Hours with actual ≥ 2.5 mm (moderate or higher under the provisional thresholds): 35. Hours where the LSTM predicted ≥ 2.5 mm: 4.

## Backend and tests
- Risk thresholds (PROVISIONAL): low < 2.5 mm, moderate < 7.6 mm, high otherwise [pipeline/config.py]
- pytest: 7 passed in 1.29 s, all on the first run [docs/TESTING.md]
- API prediction for the first real test window: 0.0703 mm, "low". This matches the LSTM value in the first row of run/predictions.csv [docs/TESTING.md T2]
- Bug found and fixed during development: the `git_dirty` flag was always true [docs/TESTING.md]

## Gaps (not in any saved file yet)
- Train and validation sample counts and split date ranges are only printed by `pipeline.preprocess`, not saved. Save them if the report needs them.
