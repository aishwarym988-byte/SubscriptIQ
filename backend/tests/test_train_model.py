import json
from pathlib import Path

from app.train_model import predict, train_model


def test_invoice_status_model_trains_and_predicts():
    data_path = Path(__file__).resolve().parents[1] / "data" / "invoice_training_data.json"
    with data_path.open(encoding="utf-8") as data_file:
        dataset = json.load(data_file)

    model = train_model(dataset)

    assert model["training_rows"] == 4
    assert model["class_counts"] == {"paid": 1, "unpaid": 2, "overdue": 1}
    prediction = predict(model, {"total": "588.82", "due_date": "2026-10-17"})
    assert prediction["predicted_status"] in {"paid", "unpaid", "overdue"}
    assert set(prediction["probabilities"]) == {"paid", "unpaid", "overdue"}
    assert abs(sum(prediction["probabilities"].values()) - 1) < 0.001
