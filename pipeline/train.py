"""Train a model on the preprocessed windows.

python -m pipeline.train --model {lstm,bilstm,cnn_lstm}   (default: lstm)

Refuses to overwrite an existing trained model unless --overwrite is given.
"""

import argparse
import json
import random
import sys
import time

import numpy as np
import tensorflow as tf
from tensorflow import keras

from pipeline import config
from pipeline.architectures import MODELS, train_info_path


def set_seeds(seed):
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)


def check_can_write(model_path, overwrite):
    """Exit before any training if a trained model would be overwritten."""
    if model_path.exists() and not overwrite:
        sys.exit(f"{model_path} already exists; pass --overwrite to retrain")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODELS, default="lstm")
    parser.add_argument("--overwrite", action="store_true",
                        help="replace an existing trained model")
    args = parser.parse_args()
    spec = MODELS[args.model]
    check_can_write(spec["path"], args.overwrite)

    set_seeds(config.SEED)
    data = np.load(config.WINDOWS_NPZ)
    X_train, y_train = data["X_train"], data["y_train"]
    X_val, y_val = data["X_val"], data["y_val"]

    model = spec["build"](X_train.shape[2])
    model.summary()

    # Stop when val_loss hasn't improved for a while, and keep the best weights
    early_stop = keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=config.EARLY_STOP_PATIENCE,
        restore_best_weights=True,
    )
    # Write epoch, loss and val_loss to a CSV file after every epoch
    spec["path"].parent.mkdir(parents=True, exist_ok=True)
    csv_logger = keras.callbacks.CSVLogger(spec["log"])

    start = time.perf_counter()
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=config.MAX_EPOCHS,
        batch_size=config.BATCH_SIZE,
        shuffle=False,
        callbacks=[early_stop, csv_logger],
    )
    train_seconds = time.perf_counter() - start

    model.save(spec["path"])

    val_losses = history.history["val_loss"]
    best_epoch = int(np.argmin(val_losses)) + 1
    info = {"model": args.model, "params": model.count_params(),
            "epochs_run": len(val_losses), "best_epoch": best_epoch,
            "best_val_loss": float(min(val_losses)),
            "train_seconds": round(train_seconds, 1)}
    train_info_path(args.model).write_text(json.dumps(info, indent=2) + "\n")
    print(f"Best epoch: {best_epoch} of {len(val_losses)}, "
          f"val_loss={min(val_losses):.6f}, {train_seconds:.0f} s")
    print(f"Saved model to {spec['path']}")


if __name__ == "__main__":
    main()
