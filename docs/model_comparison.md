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

### Validation (used for selection)

| Model | RMSE (mm) | MAE (mm) | ≥ 2.5 mm hit | Recall |
|---|---|---|---|---|
| LSTM | 0.2089 | 0.0930 | 0/14 | 0.000 |
| BiLSTM | 0.1969 | 0.0801 | 0/14 | 0.000 |
| CNN-LSTM | 0.1899 | 0.0574 | 1/14 | 0.071 |
| ARIMA | 0.1946 | 0.0545 | 1/14 | 0.071 |
| Persistence | 0.2195 | 0.0442 | 2/14 | 0.143 |

**Selected for the API (by the rule above): CNN-LSTM**

### Test (final result, reported once)

| Model | RMSE (mm) | MAE (mm) | R² | MAE dry | MAE wet | ≥ 2.5 mm hit | Recall | Max pred on those hours | Max pred | Max actual |
|---|---|---|---|---|---|---|---|---|---|---|
| LSTM | 0.3223 | 0.1095 | 0.2997 | 0.0750 | 0.2216 | 3/35 | 0.086 | 3.24 | 3.24 | 9.30 |
| BiLSTM | 0.3028 | 0.0947 | 0.3817 | 0.0589 | 0.2110 | 6/35 | 0.171 | 4.75 | 4.75 | 9.30 |
| CNN-LSTM | 0.2999 | 0.0809 | 0.3936 | 0.0393 | 0.2162 | 7/35 | 0.200 | 4.03 | 4.31 | 9.30 |
| ARIMA | 0.3041 | 0.0739 | 0.3764 | 0.0285 | 0.2217 | 9/35 | 0.257 | 5.95 | 5.95 | 9.30 |
| Persistence | 0.3404 | 0.0707 | 0.2188 | 0.0122 | 0.2612 | 12/35 | 0.343 | 9.30 | 9.30 | 9.30 |

Notes:
- Neural models: Adam, MSE, batch 64, early stopping (patience 10 on val_loss), shuffle=False, seed 42, ~18k parameters each. The LSTM is the original trained model, re-scored and not retrained.
- ARIMA(3, 0, 1) with a constant, rainfall only (univariate), order chosen by lowest AIC on the training split. Fitted parameters are applied to val/test without refitting (one-step-ahead).
- Heavy-hour counts are small (one hit changes test recall by about 3 points), so compare counts, not just percentages.
- Run folders: LSTM `experiments/run_20261017_210204/`, BiLSTM `experiments/run_20261017_210341/`, CNN-LSTM `experiments/run_20261017_210439/`, ARIMA `experiments/run_20261017_204804/`
