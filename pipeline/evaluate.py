"""Evaluate a trained Keras model on the val and test sets, in mm of rainfall.

python -m pipeline.evaluate --model {lstm,bilstm,cnn_lstm}   (default: lstm)
python -m pipeline.evaluate --model cnn_lstm --seed 1        (robustness seeds)

Prints the metrics and saves the evidence for this run to
experiments/run_<timestamp>/ so results in the report can be traced.
With --seed, the run folder goes to models/seeds/<model>_seed<N>/ instead,
so pipeline/compare.py keeps using the original seed-42 runs.
The scoring itself lives in pipeline/evaluation.py.
"""

import argparse
import json
import sys

from tensorflow import keras

from pipeline import config
from pipeline.architectures import MODELS, seed_files, train_info_path
from pipeline.evaluation import (git_info, load_scaler, load_windows,
                                 score_and_save, to_mm, TARGET_IDX)

__all__ = ["to_mm"]  # backend/app.py imports to_mm from here


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, default="lstm")
    parser.add_argument("--seed", type=int,
                        help="evaluate the model trained with train.py --seed")
    args = parser.parse_args()
    name = args.model
    spec = dict(MODELS[name], info=train_info_path(name))
    seed, runs_dir = config.SEED, None  # None: experiments/
    if args.seed is not None:
        try:
            spec.update(seed_files(name, args.seed))
        except ValueError as e:
            sys.exit(str(e))
        seed, runs_dir = args.seed, spec["dir"]

    # Check git state first, before this run creates any new files
    git = git_info()

    data = load_windows()
    scaler = load_scaler()
    model = keras.models.load_model(spec["path"])
    preds = {split: to_mm(model.predict(data[f"X_{split}"], verbose=0).ravel(),
                          scaler, TARGET_IDX)
             for split in ["val", "test"]}

    # Training summary from train.py (not available for the original LSTM)
    extra = {"model_params": model.count_params()}
    if spec["info"].exists():
        extra["training"] = json.loads(spec["info"].read_text())
    score_and_save(name, preds, spec["params"], spec["log"], git, extra,
                   runs_dir=runs_dir, seed=seed)


if __name__ == "__main__":
    main()
