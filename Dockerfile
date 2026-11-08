# FloodWatch: the Flask app, the CNN-LSTM model and the hourly scheduler, served by
# waitress as one process with several threads (backend/wsgi.py says why only one).
#
#   docker build -t floodwatch .
#   docker run -p 8000:8000 -v floodwatch-data:/data \
#     -e SECRET_KEY=... -e DEMO_ADMIN_EMAIL=... -e DEMO_ADMIN_PASSWORD=... floodwatch
#
# Secrets come only from the environment at run time: no .env, no database and no
# credentials are copied into the image (.dockerignore keeps them out of the context).

# An exact tag, at least 14 days old when chosen (updated 24 Oct 2026)
FROM python:3.13.17-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TF_CPP_MIN_LOG_LEVEL=2 \
    KERAS_HOME=/tmp/keras \
    PORT=8000 \
    DATA_DIR=/data

WORKDIR /app

# Dependencies first, so code changes don't reinstall them. tensorflow-cpu is the
# same release as the pinned tensorflow without the GPU libraries (274 MB instead of
# 573 MB); it exists for Linux x86-64 only, so this image is amd64 only.
COPY requirements.txt .
RUN sed 's/^tensorflow==/tensorflow-cpu==/' requirements.txt > /tmp/requirements-docker.txt \
 && grep -q '^tensorflow-cpu==' /tmp/requirements-docker.txt \
 && pip install --no-cache-dir -r /tmp/requirements-docker.txt \
 && rm /tmp/requirements-docker.txt

# Only what the running app reads: the code, the served model and its scaler, the
# Evidence page's tables and the weather data the Demo page replays
COPY backend/ backend/
COPY pipeline/ pipeline/
COPY scripts/ scripts/
COPY models/cnn_lstm_model.keras models/scaler.pkl models/
COPY docs/model_comparison.csv docs/seed_robustness.csv docs/
COPY data/nairobi_meteorological_raw.csv data/

# Run as an unprivileged user. The code stays owned by root (read-only to the app);
# only the data volume is writable.
RUN groupadd --system floodwatch \
 && useradd --system --gid floodwatch --uid 10001 --no-create-home --shell /usr/sbin/nologin floodwatch \
 && mkdir -p /data \
 && chown floodwatch:floodwatch /data
USER floodwatch

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=60s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ.get('PORT', '8000'), timeout=4)"

CMD ["python", "-m", "backend.wsgi"]
