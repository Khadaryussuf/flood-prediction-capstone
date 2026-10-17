"""ARIMA forecasting mechanics, on a small synthetic series (no real fitting)."""

import numpy as np
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA

from pipeline.arima import one_step_predictions


def series(values, start):
    return pd.Series(values, index=pd.date_range(start, periods=len(values), freq="h"))


def test_apply_uses_fixed_params_and_one_step_ahead():
    rng = np.random.default_rng(0)
    train = series(rng.random(200), "2021-01-01")
    new = series(rng.random(50), "2025-01-01")

    # AR(1) around a mean of 0.5 with phi = 0.6, set by hand, not fitted
    mu, phi, sigma2 = 0.5, 0.6, 0.1
    res = ARIMA(train, order=(1, 0, 0), trend="c").filter([mu, phi, sigma2])

    pred = one_step_predictions(res, new)

    # Forecast for hour t uses only hour t-1, with the same params
    expected = mu + phi * (new.to_numpy()[:-1] - mu)
    np.testing.assert_allclose(pred[1:], expected, atol=1e-8)
    assert len(pred) == len(new)
