"""The training script must never overwrite an existing trained model by default.

These tests call the guard directly; they never train anything.
"""

import pytest

from pipeline import config
from pipeline.architectures import MODELS
from pipeline.train import check_can_write


def test_refuses_to_overwrite_the_lstm():
    assert config.LSTM_MODEL_PATH.exists()
    assert MODELS["lstm"]["path"] == config.LSTM_MODEL_PATH
    with pytest.raises(SystemExit):
        check_can_write(config.LSTM_MODEL_PATH, overwrite=False)


def test_allows_a_new_model_path(tmp_path):
    check_can_write(tmp_path / "new_model.keras", overwrite=False)


def test_each_model_has_its_own_files():
    paths = [p for spec in MODELS.values() for p in (spec["path"], spec["log"])]
    assert len(paths) == len(set(paths))
