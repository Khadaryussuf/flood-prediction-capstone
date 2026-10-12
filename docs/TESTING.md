# Testing

Backend tests live in `tests/test_app.py` and run with:

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

## Issues found during development (outside the pytest suite)

| Issue | How it was found | Corrective action |
|-------|------------------|-------------------|
| `run_info.json` always had `git_dirty: true`, even with a clean working tree | First run of the new `pipeline/evaluate.py` showed `true` right after committing | The git check ran after the run folder was created, so it saw its own new files. Moved the check to the start of `main()` (commit `6f34008`), deleted the bad run folder, and re-ran. `git_dirty` is now `false`. |
