# Testing

Backend tests live in `tests/test_app.py`; the model comparison tests are
described further down. All of them run with:

```
python -m pytest -v
```

Each test builds the real app (real model and `models/scaler.pkl`) with a
fresh temporary SQLite database. The valid input is the first 24 hours of the
real test split (2025-04-02 02:00 to 2025-04-03 01:00), in raw units.

The table below is the 2026-10-12 run, when the app served
`models/lstm_model.keras`. Since 2026-10-17 it serves the CNN-LSTM; see
"API switched to the CNN-LSTM" at the end for the updated results. Since
2026-10-18 the `thresholds` field cites its source instead of saying
"PROVISIONAL"; see "Risk thresholds cited" at the end.

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

## API switched to the CNN-LSTM (deliberate change)

On 2026-10-17 the API's default model changed from the LSTM
(`models/lstm_model.keras`) to the CNN-LSTM (`models/cnn_lstm_model.keras`),
the model chosen by the validation rule in `docs/model_comparison.md`. The
path is set once, as `API_MODEL_PATH` in `pipeline/config.py`. The scaler
(`models/scaler.pkl`) is unchanged, and no model file was retrained or
modified (SHA-256 of all `.keras` files and the scaler were the same before
and after).

Ground-truth check, done before updating any expected value: the first test
window from `data/processed/windows.npz`, inverse-scaled to raw units and sent
to `/predict`, returned **0.0570 mm**. The first `cnn_lstm_mm` value in
`experiments/run_20261017_210439/predictions.csv` (2025-04-03 02:00) is
**0.0570 mm**, so they're equal. The raw-CSV window that the tests use differs
from the inverse-scaled one by at most 6.1e-5 (float32 rounding) and also
returns 0.0570 mm.

Check that the new assertions catch the old model: an app built with the LSTM
reports `"model": "lstm"` from `/health` and predicts 0.0703 mm, so T17 and
T2 would both fail.

Run recorded: 2026-10-17, at commit `11f6abe`. Result: **17 passed in 3.56 s**
(Python 3.13.14, pytest 9.1.1).

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T1 | `GET /health` | 200, `status` "ok" | 200, `{"status": "ok", "model": "cnn_lstm", "model_file": "cnn_lstm_model.keras"}`. PASSED | Deliberate change: the response now names the loaded model, so the test checks `status` instead of the whole body. Old expected value: exactly `{"status": "ok"}`. |
| T2 | `POST /predict` with a real 24-hour test window | 200, `predicted_mm` 0.0570 (±0.0001, the ground-truth value above), `risk_level` "low", thresholds PROVISIONAL | 200, `predicted_mm` 0.0570, `risk_level` "low", `thresholds` "PROVISIONAL". PASSED | Deliberate change of model. Old actual value: 0.0703 mm from the LSTM, when the test only checked `predicted_mm >= 0`. It now checks the exact verified value. |
| T7 | `POST /predict`, then `GET /predictions` | 1 stored row with the same id, `predicted_mm` and `risk_level`, and 24 input hours | 1 row: id 1, `predicted_mm` 0.0570, `risk_level` "low", 24 input hours. PASSED | None. Test unchanged; the stored value changed from 0.0703 to 0.0570 with the model. |
| T17 | `GET /health` reports the served model | `model` is "cnn_lstm", `model_file` is "cnn_lstm_model.keras" | `model` "cnn_lstm", `model_file` "cnn_lstm_model.keras". PASSED | New test. It fails if the API is switched back to another model by mistake. |

T3–T6 and T8–T16 are unchanged and passed in the same run.

## Risk thresholds cited (deliberate change)

On 2026-10-18 the "PROVISIONAL" label on the risk thresholds was replaced by
a cited source: American Meteorological Society, Glossary of Meteorology,
entry "rain" (light up to 2.5 mm/h, moderate up to 7.6 mm/h, heavy over
7.6 mm/h). The numeric thresholds (2.5 and 7.6 mm) did not change, and no
model file, scaler or metric was touched. The `/predict` response field
`thresholds` is now "AMS rain intensity classes (not calibrated to Nairobi
flood records)".

Run recorded: 2026-10-18, on top of commit `14c8c46` with this change
applied. Result: **17 passed in 5.84 s** (Python 3.13.14, pytest 9.1.1).

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T2 | `POST /predict` with a real 24-hour test window | 200, `predicted_mm` 0.0570 (±0.0001), `risk_level` "low", `thresholds` "AMS rain intensity classes (not calibrated to Nairobi flood records)" | 200, `predicted_mm` 0.0570, `risk_level` "low", `thresholds` as expected. PASSED | Deliberate change of label. Old expected value: `thresholds` "PROVISIONAL". |
| T7 | `POST /predict`, then `GET /predictions` | 1 stored row with the same id, `predicted_mm` and `risk_level`, and 24 input hours | 1 row: id 1, `predicted_mm` 0.0570, `risk_level` "low", 24 input hours. PASSED | None. Test unchanged: it doesn't check `thresholds`, which isn't stored in the database. |

T1, T3–T6 and T8–T17 are unchanged and passed in the same run.

## Seed robustness tests

Added with the multi-seed robustness check (seeds 1-4 for the LSTM, BiLSTM
and CNN-LSTM; results in `docs/seed_robustness.md`). They check that seeded
runs can never write over the original seed-42 files and that the summary
maths is right. None of them trains a model.

Run recorded: 2026-10-19, on top of commit `b76620b` with the summary
wording changes applied, after all 12 seed runs. Result: **26 passed in
3.31 s** (Python 3.13.14, pytest 9.1.1).

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T18 | `test_seed_files_never_collide_with_the_original_files` | No seeded path equals any original model, log, scaler or API model path; all are under `models/seeds/` | As expected. PASSED | None |
| T19 | `test_seed_42_is_refused` | `seed_files(..., 42)` raises, so seed 42 can't be retrained | `ValueError`. PASSED | None |
| T20 | `test_guard_refuses_an_existing_seeded_model` | `check_can_write` exits for an existing file | `SystemExit`. PASSED | None |
| T21 | `test_driver_never_overwrites` | No command from `pipeline.run_seeds` has `--overwrite`; each passes its own seed; 42 is not in the seed list | As expected. PASSED | None |
| T22 | `test_seeds_dir_is_git_ignored` | `git check-ignore` matches `models/seeds/` | Matched. PASSED | None |
| T23 | `test_score_and_save_defaults_to_experiments_and_seed_42` | Defaults unchanged: run folder in `experiments/`, seed 42 | As expected. PASSED | None |
| T24 | `test_compare_ignores_seed_run_copies` | A newer `experiments/seed_runs/lstm_seed1/` is not picked up by `compare.newest_runs()` | Top-level run folder chosen. PASSED | None |
| T25 | `test_original_runs_are_the_published_seed_42_runs` | The seed-42 folders read by the summary are the ones in `docs/model_comparison.csv` | As expected. PASSED | None |
| T26 | `test_summarise_gives_mean_and_sample_sd`: values 1-5 | Mean 3.0, SD sqrt(2.5) (ddof=1), references excluded | As expected. PASSED | None |

All nine tests passed on their first run. T1-T17 are unchanged and passed in
the same run.

Checks done outside pytest:
- SHA-256 of 44 protected files (every `models/*.keras`, log, train info,
  `scaler.pkl`, `arima_model.pkl`, `data/processed/windows.npz`, every file
  under `experiments/` and `docs/model_comparison.*`) was the same before the
  12 trainings and after them and the summary.
- All 12 seeded runs recorded `git_dirty: false` in both `train_info.json`
  and `run_info.json`, and each copied `params.json` records its own seed.
- `models/seeds/` left `git status` clean throughout the runs.
