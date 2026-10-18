# Seed robustness of the neural models

**This is a robustness check only.** The model selection rule in `docs/model_comparison.md` was fixed before any results were produced and was applied to the seed-42 runs; it selected the CNN-LSTM, which the API serves. Nothing here changes that selection or the served model, and test metrics are not used to choose anything.

Why: the single-seed gaps between CNN-LSTM, BiLSTM and ARIMA are a few thousandths of a mm, so this checks whether they hold across random initialisations.

Setup:
- Seeds 42 (the original runs from `docs/model_comparison.md`, not retrained) and 1, 2, 3, 4 (trained with `python -m pipeline.run_seeds`).
- Identical training settings for every seed: Adam, MSE, batch 64, up to 100 epochs, early stopping (patience 10 on val_loss, best weights restored), shuffle=False, same data, split and windows.
- Every run scored by `pipeline/evaluation.py`. Every run recorded `git_dirty: false`.
- ARIMA is deterministic (no seed) and persistence has no parameters; both are single reference values.
- SD is the sample standard deviation over 5 seeds (ddof=1). With 5 seeds it is a rough estimate; no significance tests are made.

## Per seed

| Model | Seed | Val RMSE | Test RMSE | Test MAE | Test R² | Val ≥ 2.5 mm hit (of 14) | Test ≥ 2.5 mm hit (of 35) | Best epoch / run | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| LSTM | 42 | 0.2089 | 0.3223 | 0.1095 | 0.2997 | 0 | 3 | – | `experiments/run_20261017_210204/` |
| LSTM | 1 | 0.2076 | 0.3075 | 0.1250 | 0.3624 | 1 | 7 | 10 / 20 | `experiments/seed_runs/lstm_seed1/` |
| LSTM | 2 | 0.2061 | 0.3185 | 0.1026 | 0.3161 | 0 | 6 | 3 / 13 | `experiments/seed_runs/lstm_seed2/` |
| LSTM | 3 | 0.1979 | 0.3035 | 0.1143 | 0.3790 | 1 | 8 | 25 / 35 | `experiments/seed_runs/lstm_seed3/` |
| LSTM | 4 | 0.2060 | 0.3182 | 0.1035 | 0.3172 | 0 | 5 | 3 / 13 | `experiments/seed_runs/lstm_seed4/` |
| BiLSTM | 42 | 0.1969 | 0.3028 | 0.0947 | 0.3817 | 0 | 6 | 6 / 16 | `experiments/run_20261017_210341/` |
| BiLSTM | 1 | 0.1925 | 0.2960 | 0.0827 | 0.4092 | 1 | 7 | 13 / 23 | `experiments/seed_runs/bilstm_seed1/` |
| BiLSTM | 2 | 0.1965 | 0.3047 | 0.0884 | 0.3740 | 0 | 6 | 5 / 15 | `experiments/seed_runs/bilstm_seed2/` |
| BiLSTM | 3 | 0.1943 | 0.3007 | 0.0834 | 0.3903 | 1 | 7 | 6 / 16 | `experiments/seed_runs/bilstm_seed3/` |
| BiLSTM | 4 | 0.1921 | 0.2972 | 0.0764 | 0.4043 | 1 | 6 | 9 / 19 | `experiments/seed_runs/bilstm_seed4/` |
| CNN-LSTM | 42 | 0.1899 | 0.2999 | 0.0809 | 0.3936 | 1 | 7 | 16 / 26 | `experiments/run_20261017_210439/` |
| CNN-LSTM | 1 | 0.1888 | 0.3008 | 0.0731 | 0.3898 | 1 | 7 | 14 / 24 | `experiments/seed_runs/cnn_lstm_seed1/` |
| CNN-LSTM | 2 | 0.1916 | 0.2999 | 0.0890 | 0.3936 | 1 | 6 | 19 / 29 | `experiments/seed_runs/cnn_lstm_seed2/` |
| CNN-LSTM | 3 | 0.1898 | 0.2988 | 0.0723 | 0.3979 | 1 | 7 | 12 / 22 | `experiments/seed_runs/cnn_lstm_seed3/` |
| CNN-LSTM | 4 | 0.1894 | 0.3010 | 0.0770 | 0.3889 | 1 | 6 | 12 / 22 | `experiments/seed_runs/cnn_lstm_seed4/` |
| ARIMA | – | 0.1946 | 0.3041 | 0.0739 | 0.3764 | 1 | 9 | – | `experiments/run_20261017_204804/` |
| Persistence | – | 0.2195 | 0.3404 | 0.0707 | 0.2188 | 2 | 12 | – | `(every run)` |

RMSE and MAE in mm of next-hour rainfall. The seed-42 LSTM was has no train_info.json, so its best epoch is not listed (its per-epoch log is `models/training_log.csv`).

## Mean ± SD across 5 seeds

| Model | Val RMSE | Test RMSE | Test MAE | Test R² | Val ≥ 2.5 mm hit (of 14) | Test ≥ 2.5 mm hit (of 35) |
|---|---|---|---|---|---|---|
| LSTM | 0.2053 ± 0.0043 | 0.3140 ± 0.0080 | 0.1110 ± 0.0092 | 0.3349 ± 0.0339 | 0.4 ± 0.5 | 5.8 ± 1.9 |
| BiLSTM | 0.1944 ± 0.0022 | 0.3003 ± 0.0037 | 0.0851 ± 0.0068 | 0.3919 ± 0.0148 | 0.6 ± 0.5 | 6.4 ± 0.5 |
| CNN-LSTM | 0.1899 ± 0.0010 | 0.3001 ± 0.0009 | 0.0785 ± 0.0068 | 0.3928 ± 0.0036 | 1.0 ± 0.0 | 6.6 ± 0.5 |
| ARIMA (reference) | 0.1946 | 0.3041 | 0.0739 | 0.3764 | 1 | 9 |
| Persistence (reference) | 0.2195 | 0.3404 | 0.0707 | 0.2188 | 2 | 12 |

## What the seeds show

- Ranking by mean validation RMSE (lowest first; ARIMA and persistence are single values): CNN-LSTM 0.1899, BiLSTM 0.1944, ARIMA 0.1946, LSTM 0.2053, Persistence 0.2195.
- Gap between the two lowest (CNN-LSTM, BiLSTM): 0.0045 mm, at least the larger seed SD of the two (0.0022 mm).
- CNN-LSTM has the lowest mean validation RMSE.
- Ranking by mean test RMSE (lowest first; ARIMA and persistence are single values): CNN-LSTM 0.3001, BiLSTM 0.3003, ARIMA 0.3041, LSTM 0.3140, Persistence 0.3404.
- Gap between the two lowest (CNN-LSTM, BiLSTM): 0.0002 mm, smaller than the larger seed SD of the two (0.0037 mm), so they cannot be told apart on this metric.
- CNN-LSTM has the lowest mean test RMSE.
- Seeds with lower validation RMSE than ARIMA (0.1946): LSTM 0/5, BiLSTM 3/5, CNN-LSTM 5/5.
- Seeds with lower test RMSE than ARIMA (0.3041): LSTM 1/5, BiLSTM 4/5, CNN-LSTM 5/5.
- Range of test RMSE across seeds: LSTM 0.3035–0.3223, BiLSTM 0.2960–0.3047, CNN-LSTM 0.2988–0.3010.
