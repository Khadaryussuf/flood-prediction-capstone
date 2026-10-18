"""The robustness seeds must never touch the original models or run folders.

These tests check paths, guards and the summary maths; they never train.
"""

import inspect
import json
import subprocess

import pandas as pd
import pytest

from pipeline import config
from pipeline.architectures import MODELS, SEEDS_DIR, seed_files
from pipeline.compare import newest_runs
from pipeline.evaluation import score_and_save
from pipeline.run_seeds import SEEDS, commands
from pipeline.seed_robustness import METRICS, original_runs, summarise
from pipeline.train import check_can_write


def test_seed_files_never_collide_with_the_original_files():
    originals = {p for spec in MODELS.values() for p in (spec["path"], spec["log"])}
    originals |= {config.SCALER_PATH, config.API_MODEL_PATH}
    seeded = [p for name in MODELS for seed in SEEDS
              for key, p in seed_files(name, seed).items() if key != "dir"]
    assert len(seeded) == len(set(seeded))
    for p in seeded:
        assert p not in originals
        assert SEEDS_DIR in p.parents


def test_seed_42_is_refused():
    with pytest.raises(ValueError):
        seed_files("cnn_lstm", config.SEED)


def test_guard_refuses_an_existing_seeded_model(tmp_path):
    existing = tmp_path / "model.keras"
    existing.write_text("")
    with pytest.raises(SystemExit):
        check_can_write(existing, overwrite=False)


def test_driver_never_overwrites():
    for name in MODELS:
        for seed in SEEDS:
            for cmd in commands(name, seed):
                assert "--overwrite" not in cmd
                assert cmd[cmd.index("--seed") + 1] == str(seed)
    assert config.SEED not in SEEDS


def test_seeds_dir_is_git_ignored():
    result = subprocess.run(["git", "check-ignore", "-q", str(SEEDS_DIR / "x")],
                            cwd=config.ROOT)
    assert result.returncode == 0


def test_score_and_save_defaults_to_experiments_and_seed_42():
    params = inspect.signature(score_and_save).parameters
    assert params["runs_dir"].default is None  # None means config.EXPERIMENTS_DIR
    assert params["seed"].default == config.SEED


def test_compare_ignores_seed_run_copies(tmp_path, monkeypatch):
    for i, name in enumerate(["lstm", "bilstm", "cnn_lstm", "arima"]):
        run = tmp_path / f"run_2026010{i}_000000"
        run.mkdir()
        (run / "run_info.json").write_text(json.dumps({"model": name}))
    copy = tmp_path / "seed_runs" / "lstm_seed1"
    copy.mkdir(parents=True)
    (copy / "run_info.json").write_text(json.dumps({"model": "lstm"}))
    monkeypatch.setattr(config, "EXPERIMENTS_DIR", tmp_path)
    assert newest_runs()["lstm"].name == "run_20260100_000000"


def test_original_runs_are_the_published_seed_42_runs():
    published = set(pd.read_csv(config.ROOT / "docs" / "model_comparison.csv")["run"])
    assert {p.name for p in original_runs().values()} <= published


def test_summarise_gives_mean_and_sample_sd():
    rows = [{"model": "A", "seed": s, **{m: v for m in METRICS}}
            for s, v in zip([42, 1, 2, 3, 4], [1.0, 2.0, 3.0, 4.0, 5.0])]
    rows.append({"model": "ARIMA", "seed": None, **{m: 9.0 for m in METRICS}})
    s = summarise(pd.DataFrame(rows))
    assert list(s.index) == ["A"]
    assert s.loc["A", "val_rmse_mm_mean"] == pytest.approx(3.0)
    assert s.loc["A", "val_rmse_mm_sd"] == pytest.approx(2.5 ** 0.5)  # ddof=1
    assert s.loc["A", "n_seeds"] == 5
