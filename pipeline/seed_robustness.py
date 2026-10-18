"""Summarise the multi-seed robustness check of the neural models.

python -m pipeline.seed_robustness

Seed 42 is the original run of each model (the run folders used in
docs/model_comparison.md). Seeds 1-4 come from pipeline.run_seeds. All runs
were scored by pipeline/evaluation.py. This is a robustness check only: it
does not change the model selection or the model served by the API.

Copies the evidence of each extra seed to experiments/seed_runs/ (tracked;
pipeline/compare.py only reads experiments/run_*) and writes
docs/seed_robustness.csv and docs/seed_robustness.md.
"""

import json
import shutil

import pandas as pd

from pipeline import config
from pipeline.architectures import MODELS, seed_files
from pipeline.compare import DOC_CSV as COMPARISON_CSV, LABELS, newest_runs
from pipeline.run_seeds import SEEDS, newest_run

NEURAL = list(MODELS)  # lstm, bilstm, cnn_lstm
EVIDENCE_DIR = config.EXPERIMENTS_DIR / "seed_runs"
EVIDENCE_FILES = ["metrics.json", "params.json", "run_info.json", "versions.txt",
                  "training_log.csv", "predictions.csv"]
DOC_MD = config.ROOT / "docs" / "seed_robustness.md"
DOC_CSV = config.ROOT / "docs" / "seed_robustness.csv"
METRICS = ["val_rmse_mm", "test_rmse_mm", "test_mae_mm", "test_r2",
           "val_heavy_hit", "test_heavy_hit"]


def read_json(path):
    return json.loads(path.read_text())


def original_runs():
    """Seed-42 run folders, checked against the published comparison table."""
    runs = newest_runs()
    published = dict(pd.read_csv(COMPARISON_CSV)[["model", "run"]].values)
    for name, run_dir in runs.items():
        if published[LABELS[name]] != run_dir.name:
            raise SystemExit(f"{name}: newest run {run_dir.name} is not the one in "
                             f"{COMPARISON_CSV.name} ({published[LABELS[name]]})")
        if read_json(run_dir / "run_info.json")["git_dirty"]:
            raise SystemExit(f"{run_dir} was run on a dirty git tree")
    return runs


def seeded_runs():
    """Newest run folder of every extra seed; all must exist with a clean tree."""
    runs = {}
    for name in NEURAL:
        for seed in SEEDS:
            run_dir = newest_run(seed_files(name, seed)["dir"])
            if run_dir is None:
                raise SystemExit(f"No run for {name} seed {seed}; run pipeline.run_seeds")
            if read_json(run_dir / "run_info.json")["git_dirty"]:
                raise SystemExit(f"{run_dir} was run on a dirty git tree")
            runs[name, seed] = run_dir
    return runs


def copy_evidence(runs):
    """Copy each extra seed's run files to experiments/seed_runs/<model>_seed<N>/."""
    copied = {}
    for (name, seed), run_dir in runs.items():
        dest = EVIDENCE_DIR / f"{name}_seed{seed}"
        dest.mkdir(parents=True, exist_ok=True)
        for f in EVIDENCE_FILES:
            shutil.copy(run_dir / f, dest / f)
        copied[name, seed] = dest
    return copied


def row(name, seed, run_dir, where):
    """One table row from a run folder; where is the path shown in the docs."""
    m = read_json(run_dir / "metrics.json")
    info = read_json(run_dir / "run_info.json")
    test, val = m[name], m["val_metrics"][name]
    training = info.get("training", {})
    return {
        "model": LABELS[name], "seed": seed,
        "val_rmse_mm": val["rmse_mm"], "test_rmse_mm": test["rmse_mm"],
        "test_mae_mm": test["mae_mm"], "test_r2": test["r2"],
        "val_heavy_hit": val["n_heavy_hit"], "val_heavy_actual": val["n_heavy_actual"],
        "test_heavy_hit": test["n_heavy_hit"], "test_heavy_actual": test["n_heavy_actual"],
        "best_epoch": training.get("best_epoch"), "epochs_run": training.get("epochs_run"),
        "git_commit": info["git_commit"][:7], "git_dirty": info["git_dirty"],
        "run": where,
    }


def persistence(run_dir):
    m = read_json(run_dir / "metrics.json")
    return m["persistence"], m["val_metrics"]["persistence"]


def reference_row(label, test, val, where):
    return {"model": label, "seed": None,
            "val_rmse_mm": val["rmse_mm"], "test_rmse_mm": test["rmse_mm"],
            "test_mae_mm": test["mae_mm"], "test_r2": test["r2"],
            "val_heavy_hit": val["n_heavy_hit"], "val_heavy_actual": val["n_heavy_actual"],
            "test_heavy_hit": test["n_heavy_hit"], "test_heavy_actual": test["n_heavy_actual"],
            "run": where}


def build_table(originals, seeded, copied):
    rows = []
    for name in NEURAL:
        rows.append(row(name, config.SEED, originals[name],
                        f"experiments/{originals[name].name}/"))
        for seed in SEEDS:
            rows.append(row(name, seed, seeded[name, seed],
                            f"experiments/seed_runs/{copied[name, seed].name}/"))
    # Persistence is scored by the same code in every run, so it must agree
    all_runs = [*originals.values(), *seeded.values()]
    ref = persistence(all_runs[0])
    for run_dir in all_runs:
        assert persistence(run_dir) == ref, f"persistence differs in {run_dir}"
    a = read_json(originals["arima"] / "metrics.json")
    rows.append(reference_row("ARIMA", a["arima"], a["val_metrics"]["arima"],
                              f"experiments/{originals['arima'].name}/"))
    rows.append(reference_row("Persistence", *ref, "(every run)"))
    return pd.DataFrame(rows)


def summarise(table):
    """Mean and sample SD (ddof=1) of each metric per neural model, in model order."""
    seeds = table[table["seed"].notna()]
    order = list(dict.fromkeys(seeds["model"]))
    g = seeds.groupby("model", sort=False)[METRICS]
    out = g.mean().add_suffix("_mean").join(g.std(ddof=1).add_suffix("_sd"))
    out["n_seeds"] = g.size()
    return out.loc[order]


def csv_table(table, summary):
    """Per-seed rows, then a "mean" and an "sd" row per model, then references.

    The seed column is text so it can hold "mean", "sd" and "" (references).
    """
    # object dtype keeps whole hit counts as ints next to fractional means
    counts = {c: object for c in ["val_heavy_hit", "val_heavy_actual",
                                  "test_heavy_hit", "test_heavy_actual"]}
    seeds = (table[table["seed"].notna()].astype({"seed": int})
             .astype({"seed": str, **counts}))
    stats = [pd.DataFrame({"model": summary.index, "seed": stat,
                           **{c: summary[f"{c}_{stat}"].values for c in METRICS}})
             .round(4).astype({c: object for c in counts if c in METRICS})
             for stat in ["mean", "sd"]]
    refs = table[table["seed"].isna()].assign(seed="").astype(counts)
    out = pd.concat([seeds, *stats, refs], ignore_index=True)
    return out.astype({"best_epoch": "Int64", "epochs_run": "Int64"}).round(4)


def ranking(summary, refs, col):
    """Models ordered by mean (neural) or single value (references), lowest first."""
    values = {**summary[f"{col}_mean"].to_dict(), **refs[col].to_dict()}
    return sorted(values.items(), key=lambda kv: kv[1])


def results_markdown(table, summary):
    f4 = lambda v: f"{v:.4f}"
    refs = table[table["seed"].isna()].set_index("model")
    n_val = int(table["val_heavy_actual"].iloc[0])
    n_test = int(table["test_heavy_actual"].iloc[0])
    lines = [
        "# Seed robustness of the neural models", "",
        "**This is a robustness check only.** The model selection rule in "
        "`docs/model_comparison.md` was fixed before any results were produced "
        "and was applied to the seed-42 runs; it selected the CNN-LSTM, which "
        "the API serves. Nothing here changes that selection or the served "
        "model, and test metrics are not used to choose anything.", "",
        "Why: the single-seed gaps between CNN-LSTM, BiLSTM and ARIMA are a few "
        "thousandths of a mm, so this checks whether they hold across random "
        "initialisations.", "",
        "Setup:",
        f"- Seeds {config.SEED} (the original runs from `docs/model_comparison.md`, "
        f"not retrained) and {', '.join(map(str, SEEDS))} (trained with "
        "`python -m pipeline.run_seeds`).",
        "- Identical training settings for every seed: Adam, MSE, batch 64, up to "
        "100 epochs, early stopping (patience 10 on val_loss, best weights "
        "restored), shuffle=False, same data, split and windows.",
        "- Every run scored by `pipeline/evaluation.py`. Every run recorded "
        "`git_dirty: false`.",
        "- ARIMA is deterministic (no seed) and persistence has no parameters; "
        "both are single reference values.",
        "- SD is the sample standard deviation over 5 seeds (ddof=1). With 5 "
        "seeds it is a rough estimate; no significance tests are made.",
        "",
        "## Per seed", "",
        f"| Model | Seed | Val RMSE | Test RMSE | Test MAE | Test R² | "
        f"Val ≥ 2.5 mm hit (of {n_val}) | Test ≥ 2.5 mm hit (of {n_test}) | "
        "Best epoch / run | Evidence |",
        "|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in table.itertuples():
        seed = "–" if pd.isna(r.seed) else int(r.seed)
        epochs = ("–" if pd.isna(getattr(r, "best_epoch", None))
                  else f"{int(r.best_epoch)} / {int(r.epochs_run)}")
        lines.append(f"| {r.model} | {seed} | {f4(r.val_rmse_mm)} | "
                     f"{f4(r.test_rmse_mm)} | {f4(r.test_mae_mm)} | {f4(r.test_r2)} | "
                     f"{r.val_heavy_hit} | {r.test_heavy_hit} | {epochs} | `{r.run}` |")
    lines += [
        "", "RMSE and MAE in mm of next-hour rainfall. The seed-42 LSTM was "
        "trained before epochs were recorded.", "",
        "## Mean ± SD across 5 seeds", "",
        f"| Model | Val RMSE | Test RMSE | Test MAE | Test R² | "
        f"Val ≥ 2.5 mm hit (of {n_val}) | Test ≥ 2.5 mm hit (of {n_test}) |",
        "|---|---|---|---|---|---|---|",
    ]
    for model, s in summary.iterrows():
        cell = lambda c, d=4: f"{s[c + '_mean']:.{d}f} ± {s[c + '_sd']:.{d}f}"
        lines.append(f"| {model} | {cell('val_rmse_mm')} | {cell('test_rmse_mm')} | "
                     f"{cell('test_mae_mm')} | {cell('test_r2')} | "
                     f"{cell('val_heavy_hit', 1)} | {cell('test_heavy_hit', 1)} |")
    for model, r in refs.iterrows():
        lines.append(f"| {model} (reference) | {f4(r.val_rmse_mm)} | "
                     f"{f4(r.test_rmse_mm)} | {f4(r.test_mae_mm)} | {f4(r.test_r2)} | "
                     f"{int(r.val_heavy_hit)} | {int(r.test_heavy_hit)} |")

    lines += ["", "## What the seeds show", ""]
    for col, label in [("val_rmse_mm", "validation RMSE"), ("test_rmse_mm", "test RMSE")]:
        order = ranking(summary, refs, col)
        lines.append(f"- Ranking by mean {label} (lowest first; ARIMA and "
                     "persistence are single values): "
                     + ", ".join(f"{m} {v:.4f}" for m, v in order) + ".")
        best = order[0][0]
        if best == "CNN-LSTM":
            lines.append(f"- CNN-LSTM has the lowest mean {label}.")
        else:
            lines.append(f"- CNN-LSTM does **not** have the lowest mean {label}; "
                         f"{best} does. The selection is unchanged (see above).")
    seeds = table[table["seed"].notna()]
    for col, label in [("val_rmse_mm", "validation"), ("test_rmse_mm", "test")]:
        arima = refs.loc["ARIMA", col]
        lines.append(f"- Seeds with lower {label} RMSE than ARIMA ({arima:.4f}): " + ", ".join(
            f"{m} {int((g[col] < arima).sum())}/{len(g)}"
            for m, g in seeds.groupby("model", sort=False)) + ".")
    lines.append("- Range of test RMSE across seeds: " + ", ".join(
        f"{m} {g['test_rmse_mm'].min():.4f}–{g['test_rmse_mm'].max():.4f}"
        for m, g in seeds.groupby("model", sort=False)) + ".")
    lines.append("")
    return "\n".join(lines)


def main():
    originals = original_runs()
    seeded = seeded_runs()
    copied = copy_evidence(seeded)
    table = build_table(originals, seeded, copied)
    summary = summarise(table)

    csv_table(table, summary).to_csv(DOC_CSV, index=False)
    DOC_MD.write_text(results_markdown(table, summary), encoding="utf-8")
    print(table.to_string(index=False))
    print()
    print(summary.round(4).to_string())
    print(f"Copied evidence to {EVIDENCE_DIR}")
    print(f"Wrote {DOC_CSV} and {DOC_MD}")


if __name__ == "__main__":
    main()
