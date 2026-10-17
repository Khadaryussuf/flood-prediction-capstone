"""ARIMA baseline on hourly rainfall, scored by the same code as the networks.

python -m pipeline.arima

The order is chosen by AIC on the training split only. The fitted
parameters are then applied, unchanged, to the val and test splits
(res.apply runs the Kalman filter over the new data without refitting),
giving one-step-ahead forecasts: the forecast for hour t uses data up to t-1.
Univariate: rainfall only, the networks see all features.
"""

import itertools
import time
import warnings

import numpy as np
import pandas as pd
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller

from pipeline import config
from pipeline.evaluation import (actual_mm, git_info, interpolated_splits,
                                 load_scaler, load_windows, score_and_save)


def rainfall_series(split_df):
    return split_df[config.TARGET].asfreq("h")


def fit_grid(train):
    """Fit every order in the grid on the training split; return the fits and a log."""
    fits, rows = {}, []
    for p, q in itertools.product(config.ARIMA_P_VALUES, config.ARIMA_Q_VALUES):
        order = (p, 0, q)
        start = time.perf_counter()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ConvergenceWarning)
            res = ARIMA(train, order=order, trend="c").fit()
        converged = bool(res.mle_retvals.get("converged", True)) and not any(
            issubclass(w.category, ConvergenceWarning) for w in caught)
        seconds = time.perf_counter() - start
        fits[order] = res
        rows.append({"order": str(order), "p": p, "q": q, "aic": res.aic, "bic": res.bic,
                     "converged": converged, "fit_seconds": round(seconds, 1)})
        print(f"ARIMA{order}  AIC={res.aic:.1f}  converged={converged}  {seconds:.1f} s")
    return fits, pd.DataFrame(rows)


def one_step_predictions(res, series):
    """Apply fitted parameters to a new series (no refit) and return the
    one-step-ahead forecast for every hour of it."""
    return res.apply(series).get_prediction().predicted_mean.to_numpy()


def main():
    # Check git state first, before this run creates any new files
    git = git_info()

    train_df, val_df, test_df = interpolated_splits()
    train = rainfall_series(train_df)

    adf_stat, adf_p, *_ = adfuller(train, maxlag=48, autolag="AIC")
    print(f"ADF on train: statistic={adf_stat:.2f}, p={adf_p:.2g} "
          f"({'stationary, d=0' if adf_p < 0.05 else 'NOT stationary'})")

    start = time.perf_counter()
    fits, log = fit_grid(train)
    grid_seconds = time.perf_counter() - start
    candidates = log[log["converged"]]
    chosen = candidates.loc[candidates["aic"].idxmin()]
    best_order = (int(chosen["p"]), 0, int(chosen["q"]))
    best = fits[best_order]
    print(f"Chosen order {best_order} (lowest AIC among converged fits)")
    log.to_csv(config.ARIMA_LOG_PATH, index=False, float_format="%.4f")
    best.save(config.ARIMA_MODEL_PATH, remove_data=True)

    # Window i predicts hour i + WINDOW of its split, so drop the first WINDOW
    # forecasts to line up with y_val / y_test
    data, scaler = load_windows(), load_scaler()
    preds = {}
    for split, df in [("val", val_df), ("test", test_df)]:
        series = rainfall_series(df)
        assert np.allclose(series.to_numpy()[config.WINDOW:],
                           actual_mm(data, split, scaler), atol=1e-4), split
        preds[split] = one_step_predictions(best, series)[config.WINDOW:]

    params = {
        "type": "ARIMA", "order": list(best_order), "trend": "c",
        "selection": "lowest AIC on the training split among converged fits",
        "grid": {"p": config.ARIMA_P_VALUES, "d": [0], "q": config.ARIMA_Q_VALUES},
        "aic_by_order": dict(zip(log["order"], log["aic"].round(2))),
        "adf_train": {"statistic": float(adf_stat), "p_value": float(adf_p),
                      "maxlag": 48},
        "fitted_params": {k: float(v) for k, v in best.params.items()},
        "forecasting": "fitted params applied to val/test with res.apply "
                       "(no refit); one-step-ahead",
        "input": "rainfall only (univariate), mm",
    }
    score_and_save("arima", preds, params, config.ARIMA_LOG_PATH, git,
                   {"grid_fit_seconds": round(grid_seconds, 1)})


if __name__ == "__main__":
    main()
