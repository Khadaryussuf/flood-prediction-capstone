# Model comparison

LSTM, BiLSTM, CNN-LSTM and an ARIMA baseline, with persistence as the
reference. All are scored by the same code (`pipeline/evaluation.py`) on the
same chronological split and 24-hour windows (`data/processed/windows.npz`),
in mm of next-hour rainfall.

## Model selection rule (fixed before any results were produced)

- The model served by the API is the one with the **lowest validation RMSE**.
- Ties (validation RMSE equal to 4 decimal places, in mm) go to the model
  with the **higher validation heavy_recall** (share of hours with actual
  rainfall ≥ 2.5 mm that the model predicted ≥ 2.5 mm).
- Persistence is a reference only and can't be selected.
- Test metrics are reported once, as the final result. They are **never
  used to choose** a model, tune a model, or change this rule.

## Results

<!-- results: everything below is written by `python -m pipeline.compare` -->

Not produced yet.
