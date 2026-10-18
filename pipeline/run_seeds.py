"""Train and evaluate every neural model on the extra robustness seeds.

python -m pipeline.run_seeds

For each model and each seed in SEEDS: train.py --seed, then evaluate.py
--seed, one after the other. Outputs go to models/seeds/ (git-ignored), so
the seed-42 models, logs and run folders are never touched. --overwrite is
never passed, so the training guard stops the driver if a seed already
exists. Stops at the first failure or if a run records a dirty git tree.
"""

import json
import subprocess
import sys

from pipeline import config
from pipeline.architectures import MODELS, seed_files
from pipeline.evaluation import git_info

SEEDS = [1, 2, 3, 4]


def commands(name, seed):
    """The train and evaluate commands for one model and seed."""
    args = ["--model", name, "--seed", str(seed)]
    return [[sys.executable, "-m", "pipeline.train", *args],
            [sys.executable, "-m", "pipeline.evaluate", *args]]


def newest_run(folder):
    runs = sorted(folder.glob("run_*"))
    return runs[-1] if runs else None


def run_one(name, seed):
    """Train and evaluate one model and seed; return its summary line."""
    for cmd in commands(name, seed):
        if subprocess.run(cmd, cwd=config.ROOT).returncode != 0:
            sys.exit(f"Stopped: {' '.join(cmd[1:])} failed")
    files = seed_files(name, seed)
    run_dir = newest_run(files["dir"])
    if not files["info"].exists() or run_dir is None:
        sys.exit(f"Stopped: train info or run folder missing in {files['dir']}")
    info = json.loads(files["info"].read_text())
    run_info = json.loads((run_dir / "run_info.json").read_text())
    dirty = info["git_dirty"] or run_info["git_dirty"]
    line = (f"{name:9s} seed={seed}  epochs={info['best_epoch']}/{info['epochs_run']}  "
            f"best_val_loss={info['best_val_loss']:.6f}  "
            f"time={info['train_seconds']:.0f} s  git_dirty={dirty}")
    if dirty:
        sys.exit(f"{line}\nStopped: git tree was dirty during this run")
    return line


def main():
    if git_info()["git_dirty"]:
        sys.exit("Stopped: commit or stash changes first (runs must record git_dirty false)")
    lines = []
    for name in MODELS:
        for seed in SEEDS:
            lines.append(run_one(name, seed))
            print("\n".join(["", "=== Seed runs so far ===", *lines]), flush=True)
    print("All seed runs done.")


if __name__ == "__main__":
    main()
