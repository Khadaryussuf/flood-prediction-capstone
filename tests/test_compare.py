"""The selection rule in pipeline/compare.py uses validation metrics only."""

import pandas as pd

from pipeline.compare import select_model


def table(rows):
    return pd.DataFrame(rows, columns=["model", "val_rmse_mm", "val_heavy_recall",
                                       "test_rmse_mm"])


def test_lowest_val_rmse_wins_even_if_test_is_worse():
    t = table([("A", 0.30, 0.1, 0.50), ("B", 0.31, 0.9, 0.10),
               ("Persistence", 0.20, 0.5, 0.05)])
    assert select_model(t) == "A"


def test_tie_goes_to_higher_val_heavy_recall():
    t = table([("A", 0.30001, 0.1, 0.1), ("B", 0.30004, 0.3, 0.9)])
    assert select_model(t) == "B"
