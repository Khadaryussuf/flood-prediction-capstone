"""Evaluate a trained Keras model on the val and test sets, in mm of rainfall.

python -m pipeline.evaluate --model {lstm,bilstm,cnn_lstm}   (default: lstm)

Prints the metrics and saves the evidence for this run to
experiments/run_<timestamp>/ so results in the report can be traced.
The scoring itself lives in pipeline/evaluation.py.
"""

import argparse
import json

from tensorflow import keras

from pipeline.architectures import MODELS, train_info_path
from pipeline.evaluation import (git_info, load_scaler, load_windows,
                                 score_and_save, to_mm, TARGET_IDX)

__all__ = ["to_mm"]  # backend/app.py imports to_mm from here


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, default="lstm")
    name = parser.parse_args().model
    spec = MODELS[name]

    # Check git state first, before this run creates any new files
    git = git_info()

    data = load_windows()
    scaler = load_scaler()
    model = keras.models.load_model(spec["path"])
    preds = {split: to_mm(model.predict(data[f"X_{split}"], verbose=0).ravel(),
                          scaler, TARGET_IDX)
             for split in ["val", "test"]}

    # Training summary from train.py (not available for the original LSTM)
    info_path = train_info_path(name)
    extra = {"model_params": model.count_params()}
    if info_path.exists():
        extra["training"] = json.loads(info_path.read_text())
    score_and_save(name, preds, spec["params"], spec["log"], git, extra)


if __name__ == "__main__":
    main()
