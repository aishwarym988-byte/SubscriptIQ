import argparse
import json
import math
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

FEATURE_DOMAINS = {
    "amount_band": ("small", "medium", "large"),
    "due_timing": ("future", "overdue_1_30_days", "overdue_31_plus_days"),
}
VALID_STATUSES = {"paid", "unpaid", "overdue"}
DEFAULT_DATA = Path(__file__).resolve().parents[1] / "data" / "invoice_training_data.json"
DEFAULT_MODEL = Path(__file__).resolve().parents[1] / "models" / "invoice_status_model.json"


def _features(invoice: dict[str, Any], as_of_date: date) -> dict[str, str]:
    total = Decimal(str(invoice["total"]))
    due_date = date.fromisoformat(invoice["due_date"])
    days_overdue = (as_of_date - due_date).days

    if total < Decimal("1000"):
        amount_band = "small"
    elif total < Decimal("2000"):
        amount_band = "medium"
    else:
        amount_band = "large"

    if days_overdue <= 0:
        due_timing = "future"
    elif days_overdue <= 30:
        due_timing = "overdue_1_30_days"
    else:
        due_timing = "overdue_31_plus_days"
    return {"amount_band": amount_band, "due_timing": due_timing}


def train_model(dataset: dict[str, Any]) -> dict[str, Any]:
    as_of_date = date.fromisoformat(dataset["as_of_date"])
    invoices = dataset["invoices"]
    if not invoices:
        raise ValueError("Training data must contain at least one invoice.")

    class_counts: dict[str, int] = {}
    feature_counts: dict[str, dict[str, dict[str, int]]] = {
        feature: {} for feature in FEATURE_DOMAINS
    }
    for invoice in invoices:
        status = invoice["status"]
        if status not in VALID_STATUSES:
            raise ValueError(f"Unsupported invoice status: {status}")
        class_counts[status] = class_counts.get(status, 0) + 1
        for feature, value in _features(invoice, as_of_date).items():
            counts_by_class = feature_counts[feature].setdefault(value, {})
            counts_by_class[status] = counts_by_class.get(status, 0) + 1

    return {
        "algorithm": "categorical_naive_bayes",
        "target": "invoice_status",
        "as_of_date": as_of_date.isoformat(),
        "training_rows": len(invoices),
        "class_counts": class_counts,
        "feature_domains": {key: list(values) for key, values in FEATURE_DOMAINS.items()},
        "feature_counts": feature_counts,
    }


def predict(model: dict[str, Any], invoice: dict[str, Any]) -> dict[str, Any]:
    features = _features(invoice, date.fromisoformat(model["as_of_date"]))
    class_counts = model["class_counts"]
    classes = sorted(class_counts)
    row_count = model["training_rows"]
    log_scores: dict[str, float] = {}

    for label in classes:
        score = math.log((class_counts[label] + 1) / (row_count + len(classes)))
        for feature, value in features.items():
            domain_size = len(model["feature_domains"][feature])
            matching_count = model["feature_counts"][feature].get(value, {}).get(label, 0)
            score += math.log((matching_count + 1) / (class_counts[label] + domain_size))
        log_scores[label] = score

    max_score = max(log_scores.values())
    exponentials = {label: math.exp(score - max_score) for label, score in log_scores.items()}
    total = sum(exponentials.values())
    probabilities = {label: round(value / total, 4) for label, value in exponentials.items()}
    return {
        "predicted_status": max(probabilities, key=probabilities.get),
        "probabilities": probabilities,
        "features": features,
    }


def train_from_file(data_path: Path = DEFAULT_DATA, model_path: Path = DEFAULT_MODEL) -> tuple[dict[str, Any], dict[str, Any]]:
    with data_path.open(encoding="utf-8") as data_file:
        dataset = json.load(data_file)
    model = train_model(dataset)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    with model_path.open("w", encoding="utf-8") as model_file:
        json.dump(model, model_file, indent=2)
        model_file.write("\n")
    return model, dataset


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a demo invoice-status classifier.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="Path to invoice training JSON.")
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL, help="Path to save the trained model.")
    args = parser.parse_args()

    model, _ = train_from_file(args.data, args.output)

    print(
        json.dumps(
            {
                "model": str(args.output),
                "algorithm": model["algorithm"],
                "training_rows": model["training_rows"],
                "class_counts": model["class_counts"],
                "note": "Demo only: four rows are not enough to validate real-world predictions.",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
