import calendar
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models import AuditLog, Invoice, InvoiceLine, Subscription, User

CENT = Decimal("0.01")


def add_interval(value: date, frequency: str) -> date:
    if frequency == "daily":
        return value + timedelta(days=1)
    if frequency == "weekly":
        return value + timedelta(weeks=1)
    if frequency == "yearly":
        year, month = value.year + 1, value.month
    else:
        year, month = (value.year + (value.month == 12), value.month % 12 + 1)
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def create_invoice_for_cycle(
    db: Session,
    subscription: Subscription,
    period_start: date,
    actor: User | None,
) -> Invoice:
    existing = db.scalar(
        select(Invoice).where(
            Invoice.subscription_id == subscription.id,
            Invoice.billing_period_start == period_start,
        )
    )
    if existing is not None:
        return existing

    db.refresh(subscription, attribute_names=["plan", "customer"])
    subtotal = (subscription.unit_price * subscription.quantity).quantize(CENT, rounding=ROUND_HALF_UP)
    tax = (subtotal * subscription.tax_rate / Decimal("100")).quantize(CENT, rounding=ROUND_HALF_UP)
    invoice = Invoice(
        number=f"INV-{uuid4().hex[:12].upper()}",
        customer_id=subscription.customer_id,
        subscription_id=subscription.id,
        billing_period_start=period_start,
        invoice_date=date.today(),
        due_date=date.today() + timedelta(days=15),
        currency=subscription.currency,
        subtotal=subtotal,
        tax_rate=subscription.tax_rate,
        tax_amount=tax,
        total=subtotal + tax,
        paid_amount=Decimal("0"),
        status="confirmed",
    )
    invoice.lines.append(
        InvoiceLine(
            description=f"{subscription.plan.product.name} - {subscription.plan.name}",
            quantity=subscription.quantity,
            unit_price=subscription.unit_price,
            line_total=subtotal,
        )
    )
    db.add(invoice)
    db.flush()
    db.add(
        AuditLog(
            actor_id=actor.id if actor else None,
            action="invoice.generated",
            entity_type="invoice",
            entity_id=invoice.id,
            details=f"Subscription {subscription.number}; billing period {period_start.isoformat()}",
        )
    )
    return invoice


def generate_due_invoices(db: Session, actor: User) -> dict[str, int]:
    today = date.today()
    subscriptions = db.scalars(
        select(Subscription)
        .options(joinedload(Subscription.plan))
        .where(
            Subscription.status == "active",
            Subscription.auto_renew.is_(True),
            Subscription.next_billing_date <= today,
        )
        .order_by(Subscription.next_billing_date, Subscription.id)
        .with_for_update()
    ).all()
    created = 0
    for subscription in subscriptions:
        while subscription.next_billing_date <= today:
            period_start = subscription.next_billing_date
            existing = db.scalar(
                select(Invoice.id).where(
                    Invoice.subscription_id == subscription.id,
                    Invoice.billing_period_start == period_start,
                )
            )
            if existing is None:
                create_invoice_for_cycle(db, subscription, period_start, actor)
                created += 1
            subscription.next_billing_date = add_interval(period_start, subscription.plan.billing_frequency)
    db.flush()
    return {"created": created, "processed_subscriptions": len(subscriptions)}
