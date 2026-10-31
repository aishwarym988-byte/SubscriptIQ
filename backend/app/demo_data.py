import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Customer, Invoice, InvoiceLine, Payment, Plan, Product, Subscription

DEMO_DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_workspace.json"


def seed_demo_data(db: Session) -> dict[str, int]:
    existing_counts = {
        "customers": db.scalar(select(func.count(Customer.id))) or 0,
        "products": db.scalar(select(func.count(Product.id))) or 0,
        "subscriptions": db.scalar(select(func.count(Subscription.id))) or 0,
        "invoices": db.scalar(select(func.count(Invoice.id))) or 0,
    }
    if any(existing_counts.values()):
        raise ValueError("Demo data was not added because workspace business records already exist.")

    with DEMO_DATA_PATH.open(encoding="utf-8") as data_file:
        dataset: dict[str, Any] = json.load(data_file)

    product = Product(**dataset["product"])
    db.add(product)
    db.flush()
    plans = [
        Plan(
            product_id=product.id,
            name=plan["name"],
            billing_frequency="monthly",
            price=Decimal(plan["price"]),
            currency="INR",
            minimum_quantity=1,
            tax_rate=Decimal("18"),
        )
        for plan in dataset["plans"]
    ]
    customers = [Customer(**customer) for customer in dataset["customers"]]
    db.add_all([*plans, *customers])
    db.flush()

    subscriptions: list[Subscription] = []
    for index, item in enumerate(dataset["subscriptions"], start=1):
        plan = plans[item["plan_id"] - 1]
        subscriptions.append(
            Subscription(
                number=f"SUB-DEMO-{index:03d}",
                customer_id=customers[item["customer_id"] - 1].id,
                plan_id=plan.id,
                quantity=1,
                unit_price=plan.price,
                tax_rate=plan.tax_rate,
                currency=plan.currency,
                status=item["status"],
                start_date=date.fromisoformat(item["start_date"]),
                next_billing_date=date.fromisoformat(item["next_billing_date"]),
                auto_renew=item["auto_renew"],
            )
        )
    db.add_all(subscriptions)
    db.flush()

    invoices: list[Invoice] = []
    for item in dataset["invoices"]:
        subscription = subscriptions[item["subscription_id"] - 1]
        plan = plans[subscription.plan_id - plans[0].id]
        subtotal = Decimal(item["subtotal"])
        invoice = Invoice(
            number=item["number"],
            customer_id=subscription.customer_id,
            subscription_id=subscription.id,
            billing_period_start=date.fromisoformat(item["billing_period_start"]),
            invoice_date=date.fromisoformat(item["invoice_date"]),
            due_date=date.fromisoformat(item["due_date"]),
            currency="INR",
            subtotal=subtotal,
            tax_rate=Decimal("18"),
            tax_amount=Decimal(item["tax"]),
            total=Decimal(item["total"]),
            paid_amount=Decimal(item["paid_amount"]),
            status=item["status"],
        )
        invoice.lines.append(
            InvoiceLine(
                description=f"{product.name} - {plan.name}",
                quantity=1,
                unit_price=subtotal,
                line_total=subtotal,
            )
        )
        invoices.append(invoice)
    db.add_all(invoices)
    db.flush()

    payments = [
        Payment(
            invoice_id=invoices[item["invoice_id"] - 1].id,
            reference=item["reference"],
            amount=Decimal(item["amount"]),
            method=item["method"],
            paid_at=datetime.fromisoformat(item["paid_at"]),
        )
        for item in dataset["payments"]
    ]
    db.add_all(payments)
    db.commit()
    return {
        "customers": len(customers),
        "products": 1,
        "plans": len(plans),
        "subscriptions": len(subscriptions),
        "invoices": len(invoices),
        "payments": len(payments),
    }
