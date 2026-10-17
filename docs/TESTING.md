# Testing

Backend tests live in `tests/test_app.py`; the model comparison tests are
described further down. All of them run with:

```
python -m pytest -v
```

Each test builds the real app (real `models/lstm_model.keras` and
`models/scaler.pkl`) with a fresh temporary SQLite database. The valid input
is the first 24 hours of the real test split (2025-04-02 02:00 to
2025-04-03 01:00), in raw units.

Run recorded: 2026-10-12, at commit `c942a72`. Result: **7 passed in 1.29 s**
(Python 3.13.14, pytest 9.1.1). The status codes and messages in the Actual
column were captured by sending the same requests through the Flask test
client on the same code.

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T1 | `GET /health` | 200, `{"status": "ok"}` | 200, `{"status": "ok"}`. PASSED | None |
| T2 | `POST /predict` with a real 24-hour test window | 200, `predicted_mm >= 0`, risk level is low/moderate/high, thresholds marked PROVISIONAL | 200, `predicted_mm` 0.0703, `risk_level` "low", `thresholds` "PROVISIONAL". PASSED | None |
| T3 | `POST /predict` with 23 hours | 400 with an error naming the required count | 400, "'readings' must contain exactly 24 hourly readings, got 23". PASSED | None |
| T4 | `POST /predict` with `wind_speed_10m` removed from hour 5 | 400 naming the missing field | 400, "Reading 5 is missing field 'wind_speed_10m'". PASSED | None |
| T5 | `POST /predict` with `temperature_2m` = `"abc"` in hour 0 | 400 saying the value must be a number | 400, "Reading 0 field 'temperature_2m' must be a number". PASSED | None |
| T6 | Start the app with a model path that doesn't exist | `FileNotFoundError` naming the file | `FileNotFoundError`: "Required file not found: missing.keras. Run the pipeline (preprocess and train) first." PASSED | None |
| T7 | `POST /predict`, then `GET /predictions` | 1 stored row with the same id, `predicted_mm` and `risk_level`, and 24 input hours | 1 row: id 1, `predicted_mm` 0.0703, `risk_level` "low", 24 input hours. PASSED | None |

All seven tests passed on their first run, so no corrective actions were
needed for these tests.

## Model comparison tests

Added with the BiLSTM, CNN-LSTM and ARIMA comparison. They check the shared
scoring code, the selection rule and the training guard on small hand-built
inputs. None of them trains or fits a real model.

Run recorded: 2026-10-17, at commit `bfb3478`. Result: **16 passed in 3.01 s**
(the 7 backend tests above plus the 9 below; Python 3.13.14, pytest 9.1.1,
statsmodels 0.15.0).

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T8 | `test_evaluation.py::test_dry_wet_and_heavy_counts`: 6 hand-made hours | 2 dry / 4 wet, 3 hours ≥ 2.5 mm with 2 hit (recall 2/3), max pred 6.0, max actual 9.0 | As expected. PASSED | None |
| T9 | `test_evaluation.py::test_float_noise_does_not_change_classes`: 1e-7 and 2.4999999 mm | 1e-7 counts as dry; 2.4999999 counts as wet and ≥ 2.5 mm (rounded to ERA5's 0.1 mm) | As expected. PASSED | None |
| T10 | `test_evaluation.py::test_no_heavy_hours` | recall and max-on-heavy are `None`, not a division error | As expected. PASSED | None |
| T11 | `test_train_guard.py::test_refuses_to_overwrite_the_lstm`: calls `check_can_write` with `models/lstm_model.keras` | `SystemExit`, nothing trained | `SystemExit`. PASSED | None |
| T12 | `test_train_guard.py::test_allows_a_new_model_path` | No exit for a path that doesn't exist | As expected. PASSED | None |
| T13 | `test_train_guard.py::test_each_model_has_its_own_files` | Every model has its own `.keras` and log path | No shared paths. PASSED | None |
| T14 | `test_arima.py::test_apply_uses_fixed_params_and_one_step_ahead`: AR(1) with hand-set params applied to new data | Forecast for hour t = μ + φ(y[t−1] − μ), same params, no refit | Matches to 1e-8. PASSED | None |
| T15 | `test_compare.py::test_lowest_val_rmse_wins_even_if_test_is_worse` | Model with the lowest val RMSE is chosen even if its test RMSE is worse; persistence is never chosen | As expected. PASSED | None |
| T16 | `test_compare.py::test_tie_goes_to_higher_val_heavy_recall`: val RMSE equal to 4 d.p. | Higher val heavy recall wins | As expected. PASSED | None |

All nine tests passed on their first run.

Checks done outside pytest during the comparison:
- SHA-256 of `models/lstm_model.keras`, `models/scaler.pkl`,
  `models/training_log.csv` and `data/processed/windows.npz` were the same
  before the work and after every training and evaluation run.
- Re-scoring the saved LSTM through the new shared code reproduced every
  test metric in `experiments/run_20261012_132216/metrics.json` exactly.
- All four new run folders have the 6 evidence files and `git_dirty: false`.

## Issues found during development (outside the pytest suite)

| Issue | How it was found | Corrective action |
|-------|------------------|-------------------|
| `run_info.json` always had `git_dirty: true`, even with a clean working tree | First run of the new `pipeline/evaluate.py` showed `true` right after committing | The git check ran after the run folder was created, so it saw its own new files. Moved the check to the start of `main()` (commit `6f34008`), deleted the bad run folder, and re-ran. `git_dirty` is now `false`. |
