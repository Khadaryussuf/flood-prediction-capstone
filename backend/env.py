"""Load settings from the git-ignored .env file in the repo root.

Values already in the environment win over the file. Secrets (SECRET_KEY,
SMTP_PASSWORD) only ever come from here or the real environment.
"""

import os

from pipeline import config

ENV_PATH = config.ROOT / ".env"


def load_env(path=None):
    """Read KEY=VALUE lines into os.environ. A missing file is fine."""
    path = path or ENV_PATH
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
