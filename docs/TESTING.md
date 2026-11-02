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

## Dashboard tests

Added with the dashboard at `/dashboard`. The backend tests are in
`tests/test_dashboard.py` and use the real model and data with a temporary
database. The frontend tests run with `npm test` in `frontend/`, using real API
responses saved in `frontend/src/test/fixtures/`.

Run recorded: 2026-11-02, on top of commit `0c05148` with this documentation
change applied. Results are listed under "Results of this run" below (Python
3.13.14, pytest 9.1.1, Node 24.20.0, Vitest 5.0.5).

### Backend (pytest)

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T27 | `test_replay_first_window` | Window 0 is 2025-04-02 02:00 to 2025-04-03 01:00, equals the first 24 test hours, target 2025-04-03 02:00, actual 0.0 mm | As expected. PASSED | First run failed: the test compared key order, which `jsonify` sorts. It now compares the set of keys. The API was unchanged. |
| T28 | `test_replay_through_predict_matches_evaluation` | Sending window 0 to `/predict` gives the first `cnn_lstm_mm` in the saved predictions (±0.0001) | 0.0570 mm. PASSED | None |
| T29 | `test_replay_indices_line_up_with_evaluation` | 6,550 windows; for the 10 wettest hours, time and actual match the saved evaluation and the prediction matches within 0.001 mm | As expected. PASSED | Deliberate change: also checks each wettest hour's `target_time`, added for the wettest-hours menu. |
| T30 | `test_replay_index_out_of_range` (-1, 6550, 100000) | 400 naming the valid range | 400, "between 0 and 6549". PASSED | None |
| T31 | `test_comparison_matches_result_files` | `/api/comparison` equals both CSVs, including ARIMA and Persistence as baselines with no seeds; 5 seeds for neural models; only CNN-LSTM selected | As expected. PASSED | Deliberate change: also checks `test_max_pred_mm` and `test_max_actual_mm`, added for the limitations text. |
| T32 | `test_meta_uses_config_thresholds_and_disclaimer` | Thresholds equal `config`; exact disclaimer and replay label | As expected. PASSED | None |
| T33 | `test_dashboard_missing_build_returns_503` | 503 mentioning `npm run build` | As expected. PASSED | None |
| T34 | `test_dashboard_serves_built_page` | 200 with the page's contents | As expected. PASSED | None |
| T35 | `test_replay_step_is_stored_in_temporary_database` | The database is in the test's temp folder; reading meta, replay and comparison stores nothing; `/predict` stores one row with the same inputs | As expected. PASSED | None |
| T36 | `test_built_dashboard_loads_only_local_files` | The committed page loads only `/static/app/` files, all 200; no script, style or font from another host | As expected. PASSED | None |
| T37 | `test_built_dashboard_contains_disclaimer` | The built JavaScript contains the exact disclaimer and replay label | As expected. PASSED | None |
| T38 | `test_third_party_lists_every_direct_dependency` | Every `package.json` entry is in `THIRD_PARTY.md` with its locked version and licence; no unknown licence | As expected. PASSED | None |
| T39 | `test_third_party_lists_components_and_production_tree` | Every copied component and every non-optional production package is listed | 13 components, 153 packages. PASSED | None |

T1-T26 are unchanged and passed in the same run.

### Frontend (Vitest)

| File | Tests | What they check |
|------|-------|-----------------|
| `src/App.test.tsx` | 3 | The disclaimer shows word for word with the API down; the hero shows the model from `/health` and the prediction; stepping posts the next window to `/predict` |
| `src/components/dashboard/RiskBadge.test.tsx` | 5 | Each class shows as text; an unknown class shows as sent; gauge bands come from the API's thresholds |
| `src/components/theme-provider.test.tsx` | 2 | The dark class and remembered choice; switching still works with storage blocked |
| `src/components/dashboard/panels.test.tsx` | 9 | Window chart hours and tabs; timeline order, classes, caption, replay hour, empty and error states; comparison rows and computed findings; limitations sheet opens by keyboard with real numbers |

### Results of this run

| Check | Result |
|-------|--------|
| `python -m pytest -q` | **41 passed in 5.44 s** |
| `npm test` | **19 passed** in 4 files |
| `npm run contrast` | All pairs pass, both themes |
| `npm run build` | Succeeded; output identical to the committed `backend/static/app/` |

### Visual check

Done on the build in commit `0c05148` with Playwright 1.64.1 and Chromium, by
opening each image. Flask ran on a scratch database. The images are git-ignored
(`frontend/screenshots/1c/`) and aren't evidence in the repository.

| View | Shots | Result |
|------|-------|--------|
| Wettest hour, window 6472 (28 Dec 2025, 17:00), predicted 1.72 mm, actual 9.3 mm | 360, 768 and 1280 px, light and dark (6) | Low class. No horizontal overflow. Correct layout in both themes |
| Moderate hour, window 952 (12 May 2025, 17:00), predicted 4.03 mm, actual 3.8 mm | 1280 px, light and dark (2) | Moderate class, confirmed by the script. No horizontal overflow |
| Limitations sheet, opened by keyboard, and the Pressure tab | 360 px dark, 1280 px light (4) | Correct, no browser console errors |

Not checked:
- The High class in a real view. The served model's highest test prediction is
  4.31 mm, so no replay hour reaches it. Vitest covers its badge text, and its
  marker appears only as a legend icon.
- Scrolling the limitations sheet to its end in a browser.

Known and accepted: at 360 px the comparison table scrolls sideways within its
card.

### Issues found during development

| Issue | How it was found | Corrective action |
|-------|------------------|-------------------|
| Light-theme amber on the gauge was 2.77:1 on white, below the 3:1 minimum for graphics | `npm run contrast` | Darkened to `#B97500` (3.75:1) |
| Page was 413 px wide at a 360 px viewport | Screenshot script's overflow check | Browsers ignore `sr-only`'s 1 px width on a `<table>`. Moved the rule to a wrapping `<div>`. The script now fails on overflow |
| SD whiskers crossed the chart's value labels | Reading the screenshots | Each label is placed past the end of its whisker |
| "Wind" tab fell outside its bar at 360 px | Reading the screenshots | Overrode the component's fixed tab-bar height |
| `shadcn add` brought back the removed `cn` package, and pinned Recharts at 3.8.0 | Checking `package.json` after adding components | Removed `cn`, pointed the imports at `@/lib/utils`, and pinned Recharts 3.10.1 |

`npm audit` on this run: production dependencies (`--omit=dev`) 0 findings; all
dependencies 2 low and 4 moderate, all through the development-only `shadcn`
command (`deepmerge`, and `minimatch` through `ts-morph`). None is high or
critical, and none was auto-fixed.

SHA-256 of the 228 protected files (everything under `models/`, `experiments/`
and `data/` except `*.db`, plus `docs/model_comparison.*`,
`docs/seed_robustness.*` and `pipeline/config.py`) was the same before the
dashboard work and after this run.
