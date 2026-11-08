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
| `src/components/dashboard/panels.test.tsx` | 10 | Window chart hours and tabs; timeline order, classes, caption, replay hour, empty and error states; comparison rows, computed findings and the table's scroll cue; limitations sheet opens by keyboard with real numbers, and only its list scrolls |

### Results of this run

| Check | Result |
|-------|--------|
| `python -m pytest -q` | **41 passed in 5.44 s** |
| `npm test` | **19 passed** in 4 files; **20 passed** after the follow-up change below, with pytest still 41 passed |
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

Limitations sheet and table cue, re-checked after the follow-up change on top of
commit `9425983`:
- With the sheet scrolled to the bottom by the End key, at 360 px dark and
  1280 px light, the close button and title stay in view and the button closes
  the sheet. No browser console errors.
- The comparison table is 899 px wide, so it scrolls sideways within its card
  below a 979 px viewport (measured at 360, 640, 768: overflow; at 1000, 1023,
  1024, 1100, 1280, 1440: fits). The text cue and fade show below 1024 px.

Known and accepted: from about 979 to 1023 px the cue shows although the table
fits.

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

## Security and access control

Added with FloodWatch's accounts, in `tests/test_security.py` (Module 1). Each test
uses the real app and model, a temporary database and passwords generated at run
time. The existing tests T2-T7 and T27-T37 now go through a real login and CSRF
token; their assertions weren't changed.

CSRF approach: a per-session token (synchronizer pattern), returned by
`GET /api/auth/session` and required in the `X-CSRF-Token` header on every POST,
PUT, PATCH and DELETE, including login and sign-up. The cookie is also SameSite=Lax.

Sessions: a signed cookie carries a random id for a row in `auth_sessions`. Logout,
expiry and disabling an account therefore take effect on the server, even for a
copied cookie.

Run recorded: 2026-11-02, Module 1. Results for all S tests: PASSED.

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| S1 | Sign-up creates a pending account | 201; status pending, role responder | As expected. PASSED | None |
| S2 | Pending account can't log in | 403 "awaiting approval"; still no session (401) | As expected. PASSED | None |
| S3 | Rejected account, right and wrong password | Right password: "awaiting approval". Wrong: generic error | As expected. PASSED | None |
| S4 | Approve, then login works | 200, role responder, last login recorded; email case ignored | As expected. PASSED | None |
| S5 | Wrong password and unknown email | Both 401 with the same generic message | As expected. PASSED | None |
| S6 | Lockout after 5 failures | 5th failure 429; right password still refused at 9 minutes; works after 10 | As expected. PASSED | First run crashed when logging in after earlier failures (a user object expired when the lockout row was deleted). Fixed in `backend/auth.py`; the test wasn't changed |
| S7 | Failures outside the 10-minute window | Don't add up to a lockout | As expected. PASSED | None |
| S8 | No session, every API route (read from the app's route list) | 401 | As expected. PASSED | None |
| S9 | No session, every page | 302 to /login | As expected. PASSED | None |
| S10 | /health and session endpoint | Open | As expected. PASSED | None |
| S11 | Responder, every admin route (read from the app's route list) | 403 | As expected. PASSED | None |
| S12 | Responder opens the Settings page | Redirected to /dashboard; admin isn't | As expected. PASSED | None |
| S13 | Admin disables, then enables | Open session ends at once (401); login says disabled; works again after enabling | As expected. PASSED | None |
| S14 | "Remove" keeps the row | Row stays as disabled; DELETE not allowed (405) | As expected. PASSED | None |
| S15 | role=admin, status or is_admin at sign-up | Ignored: pending responder, can't log in | As expected. PASSED | None |
| S16 | Duplicate email, different case | 409 | As expected. PASSED | None |
| S17 | Weak passwords | 9 characters, password equal to email, and mismatch all 400 | As expected. PASSED | None |
| S18 | Logout | 401 afterwards, including a copied cookie replayed by another client | As expected. PASSED | None |
| S19 | Expired session | 401 after 8 hours | As expected. PASSED | None |
| S20 | Session length | Server record and cookie both 8 hours | As expected. PASSED | None |
| S21 | No self-demotion or self-disable | 409; role unchanged | As expected. PASSED | None |
| S22 | Last-admin protection | 409 "last active administrator" | As expected. PASSED. The count is stubbed: with the self-check and role checks, normal use can't reach this state, so it is a second line of defence | None |
| S23 | CSRF attempt | Missing or wrong token 403 on /predict, logout and admin routes | As expected. PASSED | None |
| S24 | CSRF on login and sign-up | 403 without a token; token changes at login | As expected. PASSED | None |
| S25 | No password hash in responses | Hash, "password" and "scrypt" absent from user, session, audit and login responses | As expected. PASSED | None |
| S26 | Cookie flags on localhost | HttpOnly, SameSite=Lax, dated, not Secure | As expected. PASSED | None |
| S27 | Cookie flags elsewhere | Secure | As expected. PASSED | None |
| S28 | No SECRET_KEY | Refuses to start outside tests | As expected. PASSED | None |
| S29 | Audit log | Who, what, target and when for each admin action | As expected. PASSED | None |
| S30 | /predict and /predictions | 401 without a session | As expected. PASSED | None |
| S31 | Repo scan | No credential-like name with a literal value in any tracked source file | As expected. PASSED | None |
| S32 | .env | Git-ignored and untracked | As expected. PASSED | None |

Frontend (Vitest, `src/pages/access.test.tsx`): 9 tests for the redirect to login,
server messages, CSRF header, sign-up with no role field, mismatched passwords,
Settings hidden from responders, approve flow, and self-removal not offered.
## Live data and scheduler

Added in Module 2, in `tests/test_live.py`. The forecast API is stubbed; the model,
database and app are real. Run recorded: 2026-11-02. Results for all L tests: PASSED.

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| L1 | Same path as /predict | The real test window gives 0.0570 mm through live, equal to /predict | As expected. PASSED | None |
| L2 | Window and target | 24 hours ending at the current hour; target is the next hour; 12 forecast hours | As expected. PASSED | None |
| L3 | Fresh reading | Live, with the note that inputs differ from ERA5 | As expected. PASSED | None |
| L4 | Retry | Two failures then success: 3 calls, stored | As expected. PASSED | None |
| L5 | Fallback | All attempts fail: Fallback, last good value and time kept, error recorded | As expected. PASSED | None |
| L6 | Recovery | Back to Live after a good fetch | As expected. PASSED | None |
| L7 | Stale | Over 90 minutes old with no failure | As expected. PASSED | None |
| L8 | No data yet | Unavailable, no invented value | As expected. PASSED | None |
| L9 | Gaps | Filled by linear interpolation, as in preprocessing | As expected. PASSED | None |
| L10 | Malformed response | Recorded as a failed attempt, not raised | As expected. PASSED | None |
| L11 | Repeat refresh | One history row per hour | As expected. PASSED | None |
| L12 | Backfill | Fills history once, marked backfill | As expected. PASSED | None |
| L13 | Schedule | Next run 2 minutes past the next hour, across midnight too | As expected. PASSED | None |
| L14 | Errors | A failure or bug retries in 10 minutes, without stopping the loop | As expected. PASSED | None |
| L15 | Thread | Starts, runs and stops | As expected. PASSED | None |
| L16 | Manual refresh | Administrators only; 502 if the fetch fails | As expected. PASSED | None |

Real run on 2026-11-02 against the live API, on a scratch database: 1 good snapshot
predicting 0.0238 mm (low), and 742 backfilled hours from 3 October, all low, with a
highest prediction of 1.28 mm. Dashboard screenshots at 360 and 1280 px in both
themes were opened and checked, with no overflow or console errors.

S31 correction: the repo scan looked only at tracked files, so files new in Module 1
weren't scanned until committed. It now also covers untracked files that aren't
ignored. It then reported two false positives, both fixed at the source: the blank
`SECRET_KEY=` line in `.env.example` (the pattern ran across lines) and a literal bad
CSRF value in a test (now random).
## Map

Added in Module 3, in `tests/test_map.py` (M1-M12, forecast API stubbed) and
`frontend/src/components/map/RiskMap.test.tsx` (9 tests, Leaflet stubbed). Run
recorded: 2026-11-02. All PASSED. These cover the session requirement, past 24 and
next 12 hours from one multi-location call, the forecast label and no model risk in
the payload, peak selection (future hours only, none below 0.1 mm), caching, the
last good copy on failure, malformed responses, slider, layer toggles, and
attribution.

Checked by eye on the real map, at 360 and 1280 px in both themes, plus a past hour
with rain (grid total 16.2 mm, with 7 distinct values across 25 squares). Issues found
this way, which the automated checks had passed:

| Issue | How it was found | Corrective action |
|-------|------------------|-------------------|
| Map collapsed to zero height at 360 px | Reading the screenshot | `flex-1` overrode the fixed height in a column layout; now only applies on wide screens. The screenshot script now fails if the map is under 200 px tall |
| Zone labels overlapped and hid the model-risk marker | Reading the screenshot | Each label goes its own way, and the marker sits beside the cell's centre, on top |

Also found before testing: the app's `same-origin` referrer policy could have blocked
OpenStreetMap tiles, which need a referrer. Now `strict-origin-when-cross-origin` (M11).
Tiles load in all four views.
## Alerts

Added in Module 4, in `tests/test_alerts.py` (A1-A23) and
`frontend/src/pages/AlertsPage.test.tsx` (8 tests). The mail server is a stand-in, so
**no real email has been sent**: that needs SMTP settings in `.env`. Run recorded:
2026-11-02. All PASSED.

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| A1 | Which levels alert | Medium and High yes, Low no | As expected. PASSED | None |
| A2 | Recipients | One row per active account; pending and disabled get none | As expected. PASSED | None |
| A3 | No SMTP settings | Row says "not sent: email not configured"; alert still raised | As expected. PASSED | None |
| A4 | Email sent | Status "sent"; Medium in the subject; mm and disclaimer in the body | As expected. PASSED | None |
| A5 | One recipient refused | That row "failed: ..."; the next still sent | As expected. PASSED | None |
| A6 | Server unreachable | "failed: ConnectionRefusedError", with no server text in the status | As expected. PASSED | None |
| A7 | Cool-down | A repeat within 3 hours raises nothing | As expected. PASSED | None |
| A8 | Rise in level | Medium to High breaks through; falling back doesn't | As expected. PASSED | None |
| A9 | After the cool-down | Alerts again | As expected. PASSED | None |
| A10 | Through a real refresh | A High prediction raises an alert | As expected. PASSED | None |
| A11 | Low refresh | No alert | As expected. PASSED | None |
| A12 | Bug in alerting | The reading is kept and stays Live | As expected. PASSED | None |
| A13 | Backfill | Never alerts, even for high values | As expected. PASSED | None |
| A14 | Alerts list | Timestamp, level, recipient, status; no password data | As expected. PASSED | None |
| A15 | Acknowledge own | Recorded; bell count falls | As expected. PASSED | None |
| A16 | Someone else's alert | Responder gets 403, no button offered | As expected. PASSED | None |
| A17 | Administrator | Can acknowledge anyone's | As expected. PASSED | None |
| A18 | Acknowledge | Needs CSRF; unknown alert 404 | As expected. PASSED | None |
| A19-A20 | Search | Level (Medium or moderate), status and recipient; `%` isn't a wildcard | As expected. PASSED | None |
| A21 | Dashboard banner | Shows after an alert; gone after 6 hours | As expected. PASSED | None |
| A22 | Preview count | Uses the same cool-down rule | As expected. PASSED | None |
| A23 | Roles | Responders and administrators both get rows | As expected. PASSED | None |

The Alerts screenshots used two alerts injected into the scratch database, with a mix
of statuses set by hand, because the real forecast stayed Low. They check the layout,
not delivery.
## Historical Trends, thresholds and Demo mode

Added in Module 5, in `tests/test_history.py` (H1-H16) and
`frontend/src/pages/module5.test.tsx` (11 tests). Run recorded: 2026-11-02. All PASSED.

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| H1 | Ranges | 24h, 7d and 30d return the right rows | As expected. PASSED | None |
| H2 | Rows | Oldest first; API value stays "moderate" | As expected. PASSED | None |
| H3 | Bad range | 400 | As expected. PASSED | None |
| H4 | CSV export | Header, rows and a filename naming the range | As expected. PASSED | None |
| H5 | No session | 401 on both | As expected. PASSED | None |
| H6 | Defaults | From `pipeline/config.py` | As expected. PASSED | None |
| H7 | Preview | Counts alerts with the cool-down rule; saves nothing | 3 alerts on hand-made rows. PASSED | None |
| H8 | Preview, default limits, no rain | 0 alerts | As expected. PASSED | None |
| H9 | Bad settings (10 cases) | 400; nothing saved | As expected. PASSED | None |
| H10 | Override | `/predict` class follows it, value doesn't change, API words stay low/moderate/high, label says not AMS | As expected. PASSED | None |
| H11 | Override reaches the Dashboard and replay | New limits shown, marked as overridden | As expected. PASSED | None |
| H12 | Reset | Back to the defaults; `config` untouched | As expected. PASSED | None |
| H13 | Audit | Save and reset are logged | As expected. PASSED | None |
| H14 | Cool-down setting | Used by the alert engine | As expected. PASSED | None |
| H15 | Responder | 403 on all threshold routes | As expected. PASSED | None |
| H16 | Preview window | Only the last 30 days | As expected. PASSED | None |

Real preview on 2026-11-02, over 721 hours of live and backfilled predictions: 0 alerts
at the default limits, because the highest prediction was 1.28 mm; and 9 alerts with
Medium from 0.5 mm (14 Medium hours). So **with real recent weather the system raised
no alert at the default limits**. Alert behaviour is tested with stand-in predictions.

Issues found by reading the screenshots, which the automated checks had passed:

| Issue | Corrective action |
|-------|-------------------|
| The chart's key said "Medium: 2.5 to 2.9 mm", where the chart happened to stop, not the real limit | The key now shows the real limits, with a test |
| Axis labels clipped ("2.25" and "0.75") | Margin corrected |
| At 360 px the table's Class column was cut off | Shorter badge; Source hidden on phones |

### Account scripts (added to Security and access control)

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| S33 | First-admin script | Prompts; creates an active administrator; password isn't printed or stored in the clear | As expected. PASSED | None |
| S34 | Weak password in the script | Refused | As expected. PASSED | None |
| S35 | Demo-seed script | 1 administrator and 2 responders, all from prompts | As expected. PASSED | None |

### End-to-end pass in a real browser

Run on 2026-11-02 with Chromium against the real server, on a scratch database. All 14
checks passed: no session redirects to login and the API gives 401; sign-up says
awaiting approval; a pending login is refused; a wrong password gets the generic
error; an administrator approves in Settings; the approval appears in Activity; login
then works; a responder's sidebar has no Settings; opening /settings lands on the
Dashboard; `/api/admin/users` gives 403; the cookie is HttpOnly and SameSite=Lax, and
scripts can't read it; after logout the API gives 401.

### Not tested

- A real email: SMTP is a stand-in everywhere, because no mail account was available.
- A real Medium or High live alert: recent weather stayed Low, so alerts were tested
  with stand-in predictions and shown with injected rows.
- The app running for days: the hourly thread was tested for its schedule and error
  handling, and each real run did one refresh.
- Secure cookies over real HTTPS: tested through the test client with an https address.
## Live alert, end to end

Run on 2026-11-03 on a scratch database with one administrator and one responder,
both with throwaway passwords, and no SMTP settings. The administrator set Medium to
start at 0.01 mm in Settings and triggered the manual refresh
(`POST /api/admin/live/refresh`). The real live prediction was 0.221 mm, so Medium.

Result: one alert, with a row for each of the two accounts. Both rows said "not sent:
email not configured". The Dashboard showed the alert banner and a Medium risk banner
noting the limits were set by an administrator. Each bell showed 1 unread. The responder
acknowledged their own row in the Alerts page, and their bell went to none. They had no
Acknowledge button on the administrator's row, and the administrator's count stayed at
1. Resetting restored 2.5 and 7.6 mm. `data/predictions.db` was unchanged.

| Issue | How it was found | Corrective action |
|-------|------------------|-------------------|
| Settings couldn't save a limit finer than 0.1 mm. The fields had `step="0.1"`, so the browser blocked 0.01 or 2.55 and Save did nothing | This run's first attempt stopped at Save. A browser check confirmed the message "The two nearest valid values are 0 and 0.1" | Both mm fields now use `step="any"`, with a Vitest test for it. Vitest's jsdom doesn't enforce `step`, which is why the earlier tests passed |
## Round 2: changes from the click-through

Changes asked for after a click-through of the running app on 2026-11-03. Each item
was its own commit. Before each commit the affected pytest files, all of Vitest and the
build passed; the full suites ran at the end (results below).

### Item 1: no-access and not-found pages

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| S12 (changed) | Responder opens `/settings` | The app's page loads (it shows "You don't have access"); `/api/admin/users` and `/api/admin/thresholds` still give 403 | As expected. PASSED | Replaces the old redirect to the Dashboard |
| S36 | Signed-in browser opens an unknown address | The app's page with a 404 status, which shows "Page not found" | As expected. PASSED | None |
| S37 | Unknown address with no session | Redirect to `/login` | As expected. PASSED | None |
| S38 | Unknown `/api/` address | JSON 404 with a session, 401 without; a non-browser request to an unknown page still gets 401 | As expected. PASSED | None |
| Vitest | Responder on `/settings` | "You don't have access", no Settings link, a link to the Dashboard, and no `/api/admin` request made | As expected. PASSED | None |
| Vitest | Unknown address, logged in / logged out | "Page not found" inside the app shell / the login page | As expected. PASSED | None |

### Item 2: polish

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| H17 | Disclaimer after an override | `/api/disclaimer` and `/api/meta` say "administrator-set limits" and not "AMS"; reset brings the AMS wording back | As expected. PASSED | None |
| H18 | `/api/disclaimer` with no session | 401 | As expected. PASSED | None |
| A24 | Alert email under an override | Names the hour as "between 21:00 and 22:00 on …" and carries the administrator-set disclaimer | As expected. PASSED | None |
| T37 (extended) | Built page | Contains both disclaimers exactly as the backend has them | As expected. PASSED | None |
| Vitest | Disclaimer strip | AMS wording by default; administrator wording when overridden; changes as soon as limits are saved or reset; no request before login; default wording when the server is down | As expected. PASSED | None |
| Vitest | Risk banner wording | "Rainfall predicted for 15:00 to 16:00, 2 Nov 2026 (Nairobi time)", never "Next hour, to"; an hour ending at midnight is dated by its start | As expected. PASSED | None |
| Vitest | Readings | The pressure card says "Station pressure" | As expected. PASSED | None |
| Vitest / screenshot | Map | The risk pill sits below and right of the grid cell's centre, with a dot marking the centre; at 360 and 1280 px in both themes it no longer touches CBD's dot or label | As expected. PASSED | Before: the pill's left end covered CBD's dot (screenshot at 360 px) |

The pressure chart's tab stays "Pressure" so the five tabs still fit at 360 px; its
heading says "Station pressure".

### Item 3: filling missed hours

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| L17 | Two hours missing before the current one (as on 3 Nov, 19:00 and 20:00) | The next run fills both as "backfill", each from the 24 hours before it, and raises no alert | As expected. PASSED | None |
| L18 | No gap | No extra forecast call | As expected. PASSED | None |
| L19 | The gap-fill call fails | The live reading is still stored | As expected. PASSED | None |
| L20 | Gap older than 31 days | Left alone | As expected. PASSED | None |
| L21 | Forecast data too short for some missed hours | Those hours are skipped, not guessed; the rest are filled | As expected. PASSED | None |

### Item 4: map on the Demo page

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| T40 | `/api/meta` map positions | The grid cell's centre and the three watch zones, positions only | As expected. PASSED | None |
| A25 | Replay prediction under limits low enough to give Medium or High | `/predict` returns that level and no alert or delivery row is created | As expected. PASSED | None |
| Vitest | Demo page map | Shows the map with zone names; the marker reads "Low 0.06 mm", then "Medium 4.03 mm" after Play moves to the next hour; the replay makes no alert, map-forecast or live request | As expected. PASSED | None |
| Screenshot | `/demo` at 360 and 1280 px, both themes | Map below the replay, marker clear of CBD, no overflow, no console errors | As expected. PASSED | None |

The Demo map has no rainfall layers: no forecast exists for the replayed hours, and
today's forecast wouldn't match them. The card says so.

### Item 5: login and sign-up redesign

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| Vitest | Login and sign-up pages | Brand panel present, theme toggle present, no disclaimer strip (no risk is shown there) | As expected. PASSED | Replaces the test that expected the strip on the login page |
| Vitest | Pages that show risk | The disclaimer strip is still there (Dashboard checked; it is in the shell of every signed-in page) | As expected. PASSED | None |
| Vitest | Show/hide password | Switches the field between hidden and visible, with `aria-pressed` and a "Show/Hide password" name | As expected. PASSED | None |
| Vitest | Clear errors | A pending account gets the title "Not approved yet"; a server refusal about the email marks that field invalid with the message under it; mismatched passwords mark the confirm field | As expected. PASSED | None |
| Contrast | New brand-panel colours | AA in both themes | brand text 11.98:1 and 13.51:1, muted text 8.39:1 and 8.63:1. PASSED | None |
| Screenshot | `/login` and `/signup` at 360 and 1280 px, both themes | Split layout at 1280 px; at 360 px a short brand band above the form; no overflow, no console errors | As expected after two fixes. PASSED | At 360 px the skyline overlapped the tagline and the brand band took half the screen: the drawing was shortened and the band made auto-height |

`scripts/screenshots.mjs` now finds the Email and Password fields by exact label, since
the show/hide button's name also contains "password".

### Item 6: Google sign-in

New file `tests/test_google.py`. No request reaches Google: the code exchange and the
validated ID-token claims are replaced with stand-ins, while Authlib's state check
runs for real. Package: Authlib 1.9.5, chosen because it fixes all five published
advisories (one high, GHSA-f7j6-p4qx-gq99, affects every version up to 1.9.4).

| ID | Test | Expected | Actual | Corrective action |
|----|------|----------|--------|-------------------|
| G1 | Only one of the two settings set | `providers.google` is false; both Google routes give 404 | As expected. PASSED | None |
| G2 | Start a sign-in | Redirect to accounts.google.com with the client id, `openid email profile`, a state, a nonce and an S256 PKCE challenge; never the secret | As expected. PASSED | None |
| G3 | **State check**: callback with no sign-in started, and with another state | Refused (`google_failed`) before any code exchange; no session | As expected. PASSED | None |
| G4 | Callback with the real state | Exactly one code exchange; the same state can't be used again; no ID token, so refused | As expected. PASSED | None |
| G5 | Google returns `error=access_denied` | Refused; no session | As expected. PASSED | None |
| G6 | **Unverified email**: `email_verified` false, the string "true", or missing | Refused (`google_unverified`), even for an existing administrator's email; no account made | As expected. PASSED | None |
| G7 | **Role never from Google**: new user whose claims include role, roles, groups, hd and status of admin/active | A pending Responder; no session; one `google_signup` audit row | As expected. PASSED | None |
| G8 | Existing administrator / responder, email in a different case, claims naming the other role | Signs in; keeps its own role | As expected. PASSED | None |
| G9 | Existing pending / disabled account | `google_pending` / `google_disabled`; no session | As expected. PASSED | None |
| G10 | Google-created account after approval | Signs in as a Responder; CSRF still required on POST | As expected. PASSED | None |
| G11 | Password login to a Google-created account | Refused for guessed passwords (its password is random and never shown) | As expected. PASSED | None |
| S8 (changed) | Default deny | The two Google routes join the public list; every other `/api/` route still gives 401 | As expected. PASSED | None |
| Vitest | Button | Shown on `/login` and `/signup` as a link to `/api/auth/google/login` when the server reports Google; hidden otherwise; each result code is explained; an unknown code shows nothing | As expected. PASSED | None |
| Screenshot | `/login` and `/signup` with a dummy client id, 360 and 1280 px, both themes | Button above an "or with email" divider; no overflow, no console errors | As expected. PASSED | None |

Not tested: a real sign-in with Google, which needs an OAuth client from Google Cloud.
The pytest app fixture now sets the Google settings to empty, so a machine's `.env`
can't switch Google on for the other tests.

### Results of the round

Run on 2026-11-06 after item 6: pytest **207 passed** (179 before the round), Vitest
**94 passed** (70 before), contrast check all pairs pass, build clean. oxlint on the
changed files: 0 errors; 5 new `only-export-components` warnings (fast-refresh only)
where constants are now exported. SHA-256 of the 228 protected files was the same
before and after the round. Visual checks used a scratch database on port 5055; the
server on port 5000, `demo.db` and `.env` were not touched.

### Brand panel polish (login and sign-up)

| Test | Expected | Actual | Corrective action |
|------|----------|--------|-------------------|
| Layout, measured in Chromium on `/login` and `/signup` at 360 and 1280 px | The text block ends above the skyline drawing, which takes the bottom third (share 0.31) | Text ends at 166 px / 474 px; skyline starts at 182 px / 624 px. PASSED | None |
| Motion | Rain streaks and the wave drift run; with `prefers-reduced-motion: reduce` both have no animation | As expected. PASSED | None |
| Screenshots, both themes | Text never over buildings or rain; rain only in the sky above the roofs; no overflow or console errors | As expected after one fix. PASSED | The first try drew the buildings semi-transparent, so streaks showed through the walls; they are now solid, darker shades of the panel colour |

### Login and sign-up redesign

Dark gradient sky with canvas rain (bends away from a mouse cursor, ripples where it
lands, lighter and swaying on touch screens, paused while the tab is hidden), a
word-by-word headline, glass feature cards that tilt toward the cursor, a frosted form
card with a moving border light, and a hover shimmer on the main button. No new
packages: plain CSS plus `frontend/src/pages/RainCanvas.tsx`. Checked in Chromium
against a scratch server on port 5055, with dummy Google settings on that server only.

| Test | Expected | Actual | Corrective action |
|------|----------|--------|-------------------|
| `npm run contrast`, now also over the sky's ends, the horizon glow, the glass cards and the frosted card (as mixes of the tokens) | Every text pair at least 4.5:1 in both themes | Lowest: primary on the frosted card 4.86:1 (light). PASSED | None |
| Layout at 360×800, 1280×800 and 1280×1080, both themes, `/login` and `/signup` | Words end above the skyline; no horizontal overflow; theme toggle at least 20 px from the edges; sign-up fits 1280×1080 without scrolling | Words end at 166 / 526 px, skyline starts at 178 / 557 px (1280×800); toggle 20 px (phone), 32 px (desktop); sign-up 1080 px high at 1280×1080. PASSED | None |
| Layout shift, measured with the `layout-shift` performance entries | Nothing moves while the page loads, including when the Google button arrives | 0 everywhere after one fix. PASSED | Sign-up at 360 px first scored 0.0075: a blurred background light was pinned to the bottom of the form side and moved as the card filled in. It is now placed from the top; the card's contents fade in once the session (and so the Google button) is known |
| Motion | Rain draws and changes between frames; headline and border animations run; with `prefers-reduced-motion: reduce` the canvas stays empty, no animation runs, and the hover lift and tilt are off, with all content shown | As expected. PASSED | None |
| Tab hidden | The rain loop stops while hidden and resumes when shown | Canvas unchanged over 300 ms while hidden; changes again when shown. PASSED | None |
| Hover, 1280 px dark | A headline word lifts 4 px and turns the accent colour; a feature card tilts and lights its edge near the cursor | As expected. PASSED | None |
| Screenshots at 360 and 1280 px, both themes, opened and checked by eye | Skyline clearly visible with lit windows and a horizon glow; frosted card on a gradient; Google button above "or with email"; Name and Organisation side by side on wide screens | As expected after one fix. PASSED | At 360 px the tallest back towers were cut flat at the top of the skyline box; the top of that box now fades out on small screens |
| Vitest; `pytest tests/test_dashboard.py` | All pass | 94 passed; 16 passed. PASSED | None |

### Login and sign-up: 3D city scene

The brand panel's picture is now a three.js scene (`frontend/src/pages/brand/CityScene.ts`):
generic low-poly towers on a wet, reflective street, with fog, warm windows, a cyan
horizon glow, instanced rain in front of and behind the towers, and splashes. The
camera drifts and a mouse adds parallax (touch: drift only). Nothing flashes. The
headline's letters rise in on load; the middle line then flips between "heavy rain is",
"rising rivers are" and "flash floods are" (each phrase carries its verb so the sentence
stays grammatical). Screen readers get the full headline once from the heading's label.
The drawn skyline with canvas rain stays as the fallback: no WebGL, reduced motion, or
under 640 px.

Dependency: `three` 0.186.1, pinned, MIT, no dependencies of its own. It was the
newest release at least 14 days old (published 24 Sep 2026; 0.187.0 was 9 days old). Its
two published advisories cover versions below 0.137.0 and do not apply. The dry run added only
`three` (the other lines were other platforms' optional binaries already in the
lockfile). Types are a small local declaration (`src/types/three.d.ts`) instead of
`@types/three`, which would add seven packages.

| Test | Expected | Actual | Corrective action |
|------|----------|--------|-------------------|
| `npm audit --omit=dev` | 0 vulnerabilities | 0. PASSED | None |
| `npm run third-party`; T38, T39 (`pytest tests/test_dashboard.py`) | `three` listed with its licence; tests pass | Listed (MIT); 16 passed. PASSED | None |
| Bundle size (`npm run build`) | three.js kept out of the first load | Main bundle 1,075.01 → 1,079.53 kB (+4.52 kB; gzip +1.57 kB). three.js is its own chunk, 565.92 kB (143.20 kB gzip), fetched only when the scene runs. PASSED | None |
| Vitest, `src/pages/brand/brand.test.tsx`, three mocked | Fallback when reduced motion is set, under 640 px, or without WebGL (scene never loaded); scene starts on the panel's canvas, switches in after its first frame, disposes on unmount; falls back if the WebGL context is lost; the form, focus and Google button unchanged; heading label is the full headline with the visible letters hidden; key words cycle, and stay still under reduced motion; the scene pauses while hidden and disposes every geometry, material, texture and instanced mesh, plus the renderer | 10 passed (104 in all). PASSED | None |
| Headless Chromium with software WebGL (SwiftShader), `/login` and `/signup`, at 360, 800 and 1280 px, both themes, with and without reduced motion | 3D at 800 and 1280 px with motion, the drawn version otherwise; the three.js chunk fetched only then; no rendering while the tab is hidden, resumes when shown; no layout shift; no overflow; no console errors | As expected: 0 frames while hidden; CLS 0. PASSED | My first pause check compared element screenshots, which also capture the CSS-animated text over the canvas; it now counts animation frames |
| Screenshots at 360 and 1280 px, both themes, opened and checked by eye | Towers in the bottom third, never behind the words; reflections and splashes on the street; Google button above "or with email" | As expected after two fixes. PASSED | The towers first rose behind the feature cards, and the street didn't show; the camera was moved back and lowered. At 1280×800 the city then still reached the cards, so the picture now shifts down to start at the skyline box's top |
| `npm run contrast`, with the accent key words checked as text on the sky | At least 4.5:1 | Lowest 6.69:1. PASSED | None |

### Tests and the machine's email settings

| Test | Expected | Actual | Corrective action |
|------|----------|--------|-------------------|
| Full `pytest` run with SMTP settings present in `.env` | Tests never use the real mail account; 4 alert tests expect "not sent: email not configured" | 4 failed (status `sent`), 203 passed: `create_app` reloaded `.env` after the alert tests' fixture had deleted the SMTP variables, so a few test alerts went through the real account to made-up `example.org` addresses. FAILED | `tests/conftest.py` now sets all five SMTP variables to empty values, as it already did for Google sign-in (an empty value wins over `.env`). Rerun: 207 passed, 0 failed. PASSED |

### Login and sign-up: 3D city, rebuilt

Reported: on the user's server the panel's bottom still looked like the old flat
skyline. Diagnosis on the scratch server (port 5055) in headless Chromium: with WebGL
(SwiftShader, and the machine's AMD GPU) the three.js chunk loads, `data-scene` is
`3d` and the canvas renders; only with the GPU disabled does it fall back, as designed.
Both servers serve the same `backend/static/app/index.html`. The cause was the scene
itself: uniform boxes, few windows, flat light, so it read as the drawn skyline.

Rebuilt (`frontend/src/pages/brand/CityScene.ts`, three 0.186.1, no new packages; it
also uses three's own `Reflector` and `BufferGeometryUtils`): the scene now fills the
whole panel behind the words. An avenue runs between four rows of towers (setbacks,
antennas, one merged mesh with a window texture), with two generic landmarks (a round
tower with a saucer crown, and a slender spire with a lit lantern), fog, a horizon glow,
red aircraft lights pulsing at 0.5 Hz, rain, and a wet street with a real reflection
that ripples where drops land. The camera drifts in and out, sways, and follows a
mouse. A scrim behind the words (only in 3D) keeps text contrast. If the device can't
draw 20 frames a second over the first 3 seconds, the panel switches to the drawn
skyline.

| Test | Expected | Actual | Corrective action |
|------|----------|--------|-------------------|
| Frame rate, 1280×900 | Smooth on a real GPU | 60 fps on the AMD GPU; 3–5 fps on SwiftShader. PASSED | SwiftShader was too slow, and its screenshot showed a stale frame: added the 20 fps fallback, and `scripts/screenshots.mjs` now uses the GPU (`FW_SOFTWARE_GL=1` forces SwiftShader) |
| `npm run contrast`, now with text over a lit window (`--brand-window`) under the scrim and under the 3D glass cards | Small text 4.5:1; the large key words 3:1 | Lowest 4.78:1 (brand-muted, dark theme). PASSED | None |
| Vitest, `brand.test.tsx` (three, `Reflector` and `BufferGeometryUtils` mocked) | Earlier cases still pass; scrim shown only in 3D; every geometry, material, texture, the reflector and the merged city disposed; gives up at 10 fps and keeps going at 60 fps | 12 passed (106 in all). PASSED | None |
| Browser checks (GPU), `/login` and `/signup`, 360, 800 and 1280 px, both themes, with and without reduced motion | 3D at 800 and 1280 px with motion, drawn otherwise; chunk fetched only then; paused while hidden; CLS 0; no overflow or console errors | As expected. PASSED | None |
| Screenshots at 360 and 1280 px, both themes, by eye | A city in depth behind the words, wet street below | Towers, windows, aircraft lights and the reflecting street show, after two fixes. Still weak: the towers under the scrim are dim, the landmarks are hard to pick out, the horizon glow is faint. PASSED with notes | The first ripples were far too strong (the reflection turned to noise), so they were cut by about two thirds; the camera was then aimed higher so the towers sit mostly below the scrim |
