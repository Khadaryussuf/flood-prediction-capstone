"""Build the comparison table from the newest run folder of each model.

python -m pipeline.compare

Writes docs/model_comparison.csv and the results section of
docs/model_comparison.md. The selection rule above the results marker in the
.md file is left untouched, and the model is chosen on validation metrics only.
"""

import json

import pandas as pd

from pipeline import config

MODEL_ORDER = ["lstm", "bilstm", "cnn_lstm", "arima"]
LABELS = {"lstm": "LSTM", "bilstm": "BiLSTM", "cnn_lstm": "CNN-LSTM",
          "arima": "ARIMA", "persistence": "Persistence"}
DOC_MD = config.ROOT / "docs" / "model_comparison.md"
DOC_CSV = config.ROOT / "docs" / "model_comparison.csv"
MARKER = "<!-- results:"


def newest_runs():
    """Newest run folder for each model, from run_info.json's "model" field."""
    runs = {}
    for run_dir in sorted(config.EXPERIMENTS_DIR.glob("run_*")):
        info = json.loads((run_dir / "run_info.json").read_text())
        if info.get("model") in MODEL_ORDER:
            runs[info["model"]] = run_dir  # sorted by timestamp, so last wins
    missing = [m for m in MODEL_ORDER if m not in runs]
    if missing:
        raise SystemExit(f"No run folder found for: {missing}")
    return runs


def row(label, run, test, val):
    return {
        "model": label, "run": run,
        "val_rmse_mm": val["rmse_mm"], "val_mae_mm": val["mae_mm"],
        "val_heavy_hit": val["n_heavy_hit"], "val_heavy_actual": val["n_heavy_actual"],
        "val_heavy_recall": val["heavy_recall"],
        "test_rmse_mm": test["rmse_mm"], "test_mae_mm": test["mae_mm"],
        "test_r2": test["r2"],
        "test_mae_dry_mm": test["mae_dry_mm"], "test_mae_wet_mm": test["mae_wet_mm"],
        "test_heavy_hit": test["n_heavy_hit"], "test_heavy_actual": test["n_heavy_actual"],
        "test_heavy_recall": test["heavy_recall"],
        "test_max_pred_mm": test["max_pred_mm"],
        "test_max_pred_on_heavy_mm": test["max_pred_on_heavy_mm"],
        "test_max_actual_mm": test["max_actual_mm"],
    }


def build_table(runs):
    rows, persistence = [], None
    for name in MODEL_ORDER:
        m = json.loads((runs[name] / "metrics.json").read_text())
        rows.append(row(LABELS[name], runs[name].name, m[name], m["val_metrics"][name]))
        # Every run scores persistence with the same code, so they must agree
        p = (m["persistence"], m["val_metrics"]["persistence"])
        assert persistence is None or p == persistence, f"persistence differs in {runs[name]}"
        persistence = p
    rows.append(row("Persistence", "(every run)", *persistence))
    return pd.DataFrame(rows)


def select_model(table):
    """Lowest val RMSE (4 d.p.), ties to higher val heavy_recall. No test columns."""
    models = table[table["model"] != "Persistence"].assign(
        rmse_4dp=lambda t: t["val_rmse_mm"].round(4))
    best = models.sort_values(["rmse_4dp", "val_heavy_recall"],
                              ascending=[True, False]).iloc[0]
    return best["model"]


def results_markdown(table, chosen, arima_order):
    fmt = lambda v, d=4: "–" if v is None or pd.isna(v) else f"{v:.{d}f}"
    lines = [
        "### Validation (used for selection)", "",
        "| Model | RMSE (mm) | MAE (mm) | ≥ 2.5 mm hit | Recall |",
        "|---|---|---|---|---|",
    ]
    for r in table.itertuples():
        lines.append(f"| {r.model} | {fmt(r.val_rmse_mm)} | {fmt(r.val_mae_mm)} | "
                     f"{r.val_heavy_hit}/{r.val_heavy_actual} | "
                     f"{fmt(r.val_heavy_recall, 3)} |")
    lines += [
        "", f"**Selected for the API (by the rule above): {chosen}**", "",
        "### Test (final result, reported once)", "",
        "| Model | RMSE (mm) | MAE (mm) | R² | MAE dry | MAE wet | "
        "≥ 2.5 mm hit | Recall | Max pred on those hours | Max pred | Max actual |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in table.itertuples():
        lines.append(
            f"| {r.model} | {fmt(r.test_rmse_mm)} | {fmt(r.test_mae_mm)} | "
            f"{fmt(r.test_r2)} | {fmt(r.test_mae_dry_mm)} | {fmt(r.test_mae_wet_mm)} | "
            f"{r.test_heavy_hit}/{r.test_heavy_actual} | {fmt(r.test_heavy_recall, 3)} | "
            f"{fmt(r.test_max_pred_on_heavy_mm, 2)} | {fmt(r.test_max_pred_mm, 2)} | "
            f"{fmt(r.test_max_actual_mm, 2)} |")
    lines += [
        "", "Notes:",
        "- Neural models: Adam, MSE, batch 64, early stopping (patience 10 on "
        "val_loss), shuffle=False, seed 42, ~18k parameters each. The LSTM is "
        "the original trained model, re-scored and not retrained.",
        f"- ARIMA{arima_order} with a constant, rainfall only (univariate), "
        "order chosen by lowest AIC on the training split. Fitted parameters "
        "are applied to val/test without refitting (one-step-ahead).",
        "- Heavy-hour counts are small (one hit changes test recall by about "
        "3 points), so compare counts, not just percentages.",
        "- Run folders: " + ", ".join(
            f"{r.model} `experiments/{r.run}/`" for r in table.itertuples()
            if r.model != "Persistence"),
        "",
    ]
    return "\n".join(lines)


def main():
    runs = newest_runs()
    table = build_table(runs)
    chosen = select_model(table)
    arima_params = json.loads((runs["arima"] / "params.json").read_text())
    arima_order = tuple(arima_params["model"]["order"])

    table.to_csv(DOC_CSV, index=False, float_format="%.4f")
    head = DOC_MD.read_text(encoding="utf-8").split("\n")
    keep = head[:next(i for i, line in enumerate(head) if line.startswith(MARKER)) + 1]
    DOC_MD.write_text("\n".join(keep) + "\n\n"
                      + results_markdown(table, chosen, arima_order),
                      encoding="utf-8")
    print(table.to_string(index=False))
    print(f"Selected by validation RMSE: {chosen}")
    print(f"Wrote {DOC_CSV} and {DOC_MD}")


if __name__ == "__main__":
    main()
