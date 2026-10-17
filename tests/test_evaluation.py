"""Tests for the shared metric code in pipeline/evaluation.py."""

import numpy as np
import pytest

from pipeline.evaluation import compute_metrics


def test_dry_wet_and_heavy_counts():
    y_true = np.array([0.0, 0.0, 0.5, 2.5, 4.0, 9.0])
    y_pred = np.array([0.1, 0.0, 0.5, 3.0, 1.0, 6.0])
    m = compute_metrics(y_true, y_pred)

    assert m["n_dry_hours"] == 2
    assert m["n_wet_hours"] == 4
    assert m["mae_dry_mm"] == pytest.approx(0.05)
    assert m["mae_wet_mm"] == pytest.approx((0 + 0.5 + 3 + 3) / 4)
    # 2.5, 4.0 and 9.0 are heavy; 3.0 and 6.0 are predicted >= 2.5
    assert m["n_heavy_actual"] == 3
    assert m["n_heavy_hit"] == 2
    assert m["heavy_recall"] == pytest.approx(2 / 3)
    assert m["max_pred_mm"] == 6.0
    assert m["max_actual_mm"] == 9.0
    assert m["max_pred_on_heavy_mm"] == 6.0


def test_float_noise_does_not_change_classes():
    # Values just below a boundary because of float32 scaling round-trips
    y_true = np.array([1e-7, 2.4999999, 0.0])
    m = compute_metrics(y_true, np.zeros(3))
    assert m["n_wet_hours"] == 1
    assert m["n_heavy_actual"] == 1


def test_no_heavy_hours():
    m = compute_metrics(np.array([0.0, 1.0]), np.array([0.0, 1.0]))
    assert m["n_heavy_actual"] == 0
    assert m["heavy_recall"] is None
    assert m["max_pred_on_heavy_mm"] is None
