"""Keras model definitions, all trained and scored the same way.

Each model maps 24 hours x 5 features to next-hour rainfall (scaled).
"""

from tensorflow import keras

from pipeline import config


def _compile(layers, n_features):
    model = keras.Sequential([keras.Input(shape=(config.WINDOW, n_features)),
                              *layers])
    model.compile(optimizer="adam", loss="mse")
    return model


def build_lstm(n_features):
    return _compile([
        keras.layers.LSTM(config.LSTM_UNITS),
        keras.layers.Dropout(config.DROPOUT),
        keras.layers.Dense(1),
    ], n_features)


def build_bilstm(n_features):
    return _compile([
        keras.layers.Bidirectional(keras.layers.LSTM(config.BILSTM_UNITS)),
        keras.layers.Dropout(config.DROPOUT),
        keras.layers.Dense(1),
    ], n_features)


def build_cnn_lstm(n_features):
    # The convolution picks up short local patterns (a few hours), pooling
    # halves the sequence, and the LSTM models the remaining 12 steps.
    return _compile([
        keras.layers.Conv1D(config.CNN_FILTERS, config.CNN_KERNEL,
                            padding="same", activation="relu"),
        keras.layers.MaxPooling1D(config.CNN_POOL),
        keras.layers.LSTM(config.CNN_LSTM_UNITS),
        keras.layers.Dropout(config.DROPOUT),
        keras.layers.Dense(1),
    ], n_features)


_TRAINING = {"dropout": config.DROPOUT, "batch_size": config.BATCH_SIZE,
             "max_epochs": config.MAX_EPOCHS,
             "early_stop_patience": config.EARLY_STOP_PATIENCE,
             "optimizer": "adam", "loss": "mse"}

# name -> builder, saved model, training log, params recorded in params.json
MODELS = {
    "lstm": {
        "build": build_lstm,
        "path": config.LSTM_MODEL_PATH,
        "log": config.TRAINING_LOG_PATH,
        "params": {"type": "LSTM", "units": config.LSTM_UNITS, **_TRAINING},
    },
    "bilstm": {
        "build": build_bilstm,
        "path": config.MODELS_DIR / "bilstm_model.keras",
        "log": config.MODELS_DIR / "bilstm_training_log.csv",
        "params": {"type": "BiLSTM", "units_per_direction": config.BILSTM_UNITS,
                   **_TRAINING},
    },
    "cnn_lstm": {
        "build": build_cnn_lstm,
        "path": config.MODELS_DIR / "cnn_lstm_model.keras",
        "log": config.MODELS_DIR / "cnn_lstm_training_log.csv",
        "params": {"type": "CNN-LSTM", "conv_filters": config.CNN_FILTERS,
                   "conv_kernel": config.CNN_KERNEL, "pool_size": config.CNN_POOL,
                   "lstm_units": config.CNN_LSTM_UNITS, **_TRAINING},
    },
}


def train_info_path(name):
    """JSON with epochs, best val loss and wall time written by train.py."""
    return config.MODELS_DIR / f"{name}_train_info.json"
