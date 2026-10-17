"""Evaluate the trained LSTM on the val and test sets, in mm of rainfall.

Prints the metrics and saves the evidence for this run to
experiments/run_<timestamp>/ so results in the report can be traced.
The scoring itself lives in pipeline/evaluation.py.
"""

from tensorflow import keras

from pipeline import config
from pipeline.evaluation import (git_info, load_scaler, load_windows,
                                 score_and_save, to_mm, TARGET_IDX)

__all__ = ["to_mm"]  # backend/app.py imports to_mm from here


def main():
    # Check git state first, before this run creates any new files
    git = git_info()

    data = load_windows()
    scaler = load_scaler()
    model = keras.models.load_model(config.LSTM_MODEL_PATH)
    preds = {split: to_mm(model.predict(data[f"X_{split}"], verbose=0).ravel(),
                          scaler, TARGET_IDX)
             for split in ["val", "test"]}

    params = {"type": "LSTM", "units": config.LSTM_UNITS,
              "dropout": config.DROPOUT, "batch_size": config.BATCH_SIZE,
              "max_epochs": config.MAX_EPOCHS,
              "early_stop_patience": config.EARLY_STOP_PATIENCE,
              "optimizer": "adam", "loss": "mse"}
    score_and_save("lstm", preds, params, config.TRAINING_LOG_PATH, git)


if __name__ == "__main__":
    main()
