"""Train the standard LSTM on the preprocessed windows."""

import random

import numpy as np
import tensorflow as tf
from tensorflow import keras

from pipeline import config


def set_seeds(seed):
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)


def build_model(n_features):
    model = keras.Sequential([
        keras.Input(shape=(config.WINDOW, n_features)),
        keras.layers.LSTM(config.LSTM_UNITS),
        keras.layers.Dropout(config.DROPOUT),
        keras.layers.Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    return model


def main():
    set_seeds(config.SEED)
    data = np.load(config.WINDOWS_NPZ)
    X_train, y_train = data["X_train"], data["y_train"]
    X_val, y_val = data["X_val"], data["y_val"]

    model = build_model(X_train.shape[2])
    model.summary()

    # Stop when val_loss hasn't improved for a while, and keep the best weights
    early_stop = keras.callbacks.EarlyStopping(
        monitor="val_loss", patience=config.EARLY_STOP_PATIENCE,
        restore_best_weights=True,
    )
    # Write epoch, loss and val_loss to a CSV file after every epoch
    config.LSTM_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    csv_logger = keras.callbacks.CSVLogger(config.TRAINING_LOG_PATH)

    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=config.MAX_EPOCHS,
        batch_size=config.BATCH_SIZE,
        shuffle=False,
        callbacks=[early_stop, csv_logger],
    )

    model.save(config.LSTM_MODEL_PATH)

    val_losses = history.history["val_loss"]
    best_epoch = int(np.argmin(val_losses)) + 1
    print(f"Best epoch: {best_epoch} of {len(val_losses)}, "
          f"val_loss={min(val_losses):.6f}")
    print(f"Saved model to {config.LSTM_MODEL_PATH}")


if __name__ == "__main__":
    main()
