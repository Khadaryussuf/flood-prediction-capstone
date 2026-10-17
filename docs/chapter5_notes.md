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
- The API now serves the CNN-LSTM (chosen by the validation rule, see Model comparison below) [pipeline/config.py API_MODEL_PATH; `/health` reports `"model": "cnn_lstm"`, docs/TESTING.md T17]
- API prediction for the first real test window: 0.0570 mm, "low". Verified equal to the first `cnn_lstm_mm` value (2025-04-03 02:00) in experiments/run_20261017_210439/predictions.csv [docs/TESTING.md, "API switched to the CNN-LSTM"; T2]
- 0.0703 mm was the original LSTM's prediction for that window, when the API served the LSTM; it matches the LSTM value in the first row of run/predictions.csv [docs/TESTING.md, 2026-10-12 table, T2]
- Bug found and fixed during development: the `git_dirty` flag was always true [docs/TESTING.md]

## Model comparison

Sources: docs/model_comparison.md and docs/model_comparison.csv (tables
copied, not recomputed). Run folders: LSTM experiments/run_20261017_210204/
(the original model re-scored, not retrained), BiLSTM run_20261017_210341/,
CNN-LSTM run_20261017_210439/, ARIMA run_20261017_204804/.

### Selection rule [docs/model_comparison.md]
- The API model is the one with the lowest validation RMSE. Ties (equal to 4 d.p.) go to higher validation heavy recall.
- Persistence is a reference only. Test metrics are reported once and never used to choose.
- The rule was committed (commit 9271c15) before any comparison model was trained or evaluated [git log]
- Result: CNN-LSTM selected. Not a tie: 0.1899 vs ARIMA 0.1946 [docs/model_comparison.csv]

### Setup [run params.json files; docs/model_comparison.md notes]
- Networks: same training as the LSTM (Adam, MSE, batch 64, patience 10, shuffle=False, seed 42), ~18k parameters each: LSTM 17,985 / BiLSTM 17,689 / CNN-LSTM 18,245
- ARIMA(3,0,1) with a constant, rainfall only. Order chosen by lowest training AIC over p 0–3, q 0–2 (d=0, ADF p=1.6e-28). Fitted parameters applied to val/test without refitting
- "Hit" = an hour with actual ≥ 2.5 mm where the model also predicted ≥ 2.5 mm. This differs from the 4 in the Peaks section above, which counts every hour the LSTM predicted ≥ 2.5 mm (3 hits + 1 false alarm) [derived from run/predictions.csv]

### Validation (used for selection) [docs/model_comparison.csv]

| Model | RMSE (mm) | MAE (mm) | ≥ 2.5 mm hit | Recall |
|---|---|---|---|---|
| LSTM | 0.2089 | 0.0930 | 0/14 | 0.0000 |
| BiLSTM | 0.1969 | 0.0801 | 0/14 | 0.0000 |
| CNN-LSTM | 0.1899 | 0.0574 | 1/14 | 0.0714 |
| ARIMA | 0.1946 | 0.0545 | 1/14 | 0.0714 |
| Persistence | 0.2195 | 0.0442 | 2/14 | 0.1429 |

### Test (final result, reported once) [docs/model_comparison.csv]

| Model | RMSE (mm) | MAE (mm) | R² | MAE dry | MAE wet | ≥ 2.5 mm hit | Recall | Max pred on heavy hours | Max pred | Max actual |
|---|---|---|---|---|---|---|---|---|---|---|
| LSTM | 0.3223 | 0.1095 | 0.2997 | 0.0750 | 0.2216 | 3/35 | 0.0857 | 3.2404 | 3.2404 | 9.3000 |
| BiLSTM | 0.3028 | 0.0947 | 0.3817 | 0.0589 | 0.2110 | 6/35 | 0.1714 | 4.7471 | 4.7471 | 9.3000 |
| CNN-LSTM | 0.2999 | 0.0809 | 0.3936 | 0.0393 | 0.2162 | 7/35 | 0.2000 | 4.0260 | 4.3128 | 9.3000 |
| ARIMA | 0.3041 | 0.0739 | 0.3764 | 0.0285 | 0.2217 | 9/35 | 0.2571 | 5.9504 | 5.9504 | 9.3000 |
| Persistence | 0.3404 | 0.0707 | 0.2188 | 0.0122 | 0.2612 | 12/35 | 0.3429 | 9.3000 | 9.3000 | 9.3000 |

### Limitations (state plainly in the chapter)
- One seed per network. The test RMSE gaps between CNN-LSTM and BiLSTM (0.0029 mm) and between CNN-LSTM and ARIMA (0.0042 mm) are not firm; another seed could reorder them.
- ARIMA is within noise of the best network. It has the best test MAE of the four models (0.0739 vs CNN-LSTM 0.0809) and more test heavy-hour hits than CNN-LSTM (9/35 vs 7/35; on validation both have 1/14).
- No model beats persistence on overall MAE (test 0.0707, val 0.0442) or on heavy hours (12/35 test, 2/14 val). The models only win on RMSE and R².
- Every model underpredicts the 9.3 mm test peak: the largest prediction is 5.9504 mm (ARIMA), and the selected CNN-LSTM's is 4.3128 mm.
- Only 14 validation and 35 test hours are ≥ 2.5 mm. One hit moves test recall by ~0.03 and validation recall by ~0.07.
- Input history differs: ARIMA's Kalman filter carries state over the whole test split up to the forecast hour (no train/val data), while the networks see only the last 24 hours.
- ARIMA has no seasonal term, so the diurnal rain cycle isn't modelled. A SARIMA with a 24 h season would be a stronger baseline.

## Gaps (not in any saved file yet)
- Train and validation sample counts and split date ranges are only printed by `pipeline.preprocess`, not saved. Save them if the report needs them.
