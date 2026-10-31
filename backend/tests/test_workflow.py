from decimal import Decimal
from datetime import date

from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.demo_data import seed_demo_data
from app.db.session import engine
from app.models import User


def register_customer(client, email="customer@example.com"):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "full_name": "Avery Customer", "password": "StrongPass!9"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def seed_admin():
    with Session(engine) as db:
        admin = User(
            email="admin@example.com",
            full_name="Subscript Admin",
            password_hash=hash_password("StrongPass!9"),
            role="admin",
        )
        db.add(admin)
        db.commit()


def test_customer_registration_and_role_limits(client):
    registration = register_customer(client)
    token = registration["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    profile = client.get("/api/v1/customers/me", headers=headers)
    dashboard = client.get("/api/v1/dashboard", headers=headers)
    create_product = client.post(
        "/api/v1/products",
        headers=headers,
        json={"name": "Forbidden product", "product_type": "software"},
    )

    assert profile.status_code == 200
    assert profile.json()["email"] == "customer@example.com"
    assert dashboard.status_code == 403
    assert create_product.status_code == 403


def test_product_subscription_invoice_payment_flow(client):
    seed_admin()
    admin_login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "StrongPass!9"},
    )
    assert admin_login.status_code == 200
    headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}

    customer = register_customer(client)
    customer_headers = {"Authorization": f"Bearer {customer['access_token']}"}
    profile = client.get("/api/v1/customers/me", headers=customer_headers).json()
    product = client.post(
        "/api/v1/products",
        headers=headers,
        json={"name": "Brightloop CRM", "product_type": "software", "variants": [{"name": "Enterprise", "price_adjustment": 50}]},
    )
    assert product.status_code == 201, product.text
    plan = client.post(
        "/api/v1/plans",
        headers=headers,
        json={
            "product_id": product.json()["id"],
            "name": "Monthly",
            "billing_frequency": "monthly",
            "price": "120.00",
            "currency": "USD",
            "minimum_quantity": 1,
            "tax_rate": "10",
        },
    )
    assert plan.status_code == 201, plan.text
    subscription = client.post(
        "/api/v1/subscriptions",
        headers=customer_headers,
        json={"customer_id": profile["id"], "plan_id": plan.json()["id"], "quantity": 2},
    )
    assert subscription.status_code == 201, subscription.text
    invoice = client.get("/api/v1/invoices", headers=customer_headers).json()[0]
    assert Decimal(invoice["subtotal"]) == Decimal("240.00")
    assert Decimal(invoice["tax_amount"]) == Decimal("24.00")
    assert Decimal(invoice["total"]) == Decimal("264.00")

    payment = client.post(
        f"/api/v1/invoices/{invoice['id']}/payments",
        headers=headers,
        json={"amount": "100.00", "method": "bank_transfer"},
    )
    assert payment.status_code == 201, payment.text
    updated_invoice = client.get(f"/api/v1/invoices/{invoice['id']}", headers=customer_headers).json()
    assert updated_invoice["status"] == "partially_paid"
    assert Decimal(updated_invoice["outstanding_amount"]) == Decimal("164.00")
    report = client.get(
        f"/api/v1/reports/revenue?start_date={date.today().isoformat()}&end_date={date.today().isoformat()}",
        headers=headers,
    )
    assert report.status_code == 200, report.text
    assert report.json()[0]["revenue"] == 100


def test_invoice_model_training_is_admin_only(client):
    registration = register_customer(client)
    customer_headers = {"Authorization": f"Bearer {registration['access_token']}"}
    forbidden = client.post("/api/v1/model/train", headers=customer_headers)
    assert forbidden.status_code == 403

    seed_admin()
    admin_login = client.post(
        "/api/v1/auth/login",
        json={"email": "admin@example.com", "password": "StrongPass!9"},
    )
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['access_token']}"}
    trained = client.post("/api/v1/model/train", headers=admin_headers)

    assert trained.status_code == 200, trained.text
    assert trained.json()["training_rows"] == 4
    assert trained.json()["class_counts"] == {"paid": 1, "unpaid": 2, "overdue": 1}

    prediction = client.post(
        "/api/v1/model/predict",
        headers=admin_headers,
        json={"total": "588.82", "due_date": "2026-10-17"},
    )
    assert prediction.status_code == 200, prediction.text
    prediction_result = prediction.json()
    assert prediction_result["predicted_status"] in {"paid", "unpaid", "overdue"}
    assert set(prediction_result["probabilities"]) == {"paid", "unpaid", "overdue"}
    assert abs(sum(prediction_result["probabilities"].values()) - 1) < 0.001

    invalid_prediction = client.post(
        "/api/v1/model/predict",
        headers=admin_headers,
        json={"total": "-1", "due_date": "2026-10-17"},
    )
    assert invalid_prediction.status_code == 422


def test_demo_workspace_seed_creates_dashboard_data():
    with Session(engine) as db:
        counts = seed_demo_data(db)
        assert counts == {
            "customers": 5,
            "products": 1,
            "plans": 5,
            "subscriptions": 5,
            "invoices": 4,
            "payments": 3,
        }
