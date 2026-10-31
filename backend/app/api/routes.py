import json
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user, require_admin, require_staff
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import (
    AuditLog,
    Customer,
    Invoice,
    Payment,
    Plan,
    Product,
    ProductVariant,
    Subscription,
    User,
)
from app.schemas import (
    CustomerCreate,
    CustomerRead,
    CustomerUpdate,
    InvoiceRead,
    InvoiceStatusPredictionRequest,
    LoginRequest,
    PaymentCreate,
    PaymentRead,
    PlanCreate,
    PlanRead,
    PlanUpdate,
    ProductCreate,
    ProductRead,
    ProductUpdate,
    RegisterRequest,
    StaffCreate,
    SubscriptionCreate,
    SubscriptionRead,
    TokenResponse,
    UserRead,
)
from app.services.billing import add_interval, create_invoice_for_cycle, generate_due_invoices
from app.train_model import DEFAULT_MODEL, predict, train_from_file

router = APIRouter()


def page_params(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> tuple[int, int]:
    return limit, offset


def audit(db: Session, actor: User, action: str, entity_type: str, entity_id: int, details: str | None = None) -> None:
    db.add(AuditLog(actor_id=actor.id, action=action, entity_type=entity_type, entity_id=entity_id, details=details))


def get_customer_for_user(db: Session, user: User) -> Customer:
    customer = db.scalar(select(Customer).where(Customer.user_id == user.id))
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer profile not found")
    return customer


def get_scoped_invoice(db: Session, invoice_id: int, user: User) -> Invoice:
    invoice = db.scalar(
        select(Invoice).options(selectinload(Invoice.lines)).where(Invoice.id == invoice_id)
    )
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if user.role == "customer" and invoice.customer_id != get_customer_for_user(db, user).id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


@router.post("/auth/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = str(payload.email).lower()
    user = User(email=email, full_name=payload.full_name, password_hash=hash_password(payload.password), role="customer")
    user.customer = Customer(name=payload.full_name, email=email)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered") from exc
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(str(user.id)), user=user)


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_access_token(str(user.id)), user=user)


@router.get("/auth/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/users/staff", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    staff = User(
        email=str(payload.email).lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role="staff",
    )
    db.add(staff)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email already registered") from exc
    db.refresh(staff)
    audit(db, admin, "staff.created", "user", staff.id)
    db.commit()
    return staff


@router.get("/customers", response_model=list[CustomerRead])
def list_customers(
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    limit, offset = pagination
    return db.scalars(select(Customer).order_by(Customer.id.desc()).limit(limit).offset(offset)).all()


@router.get("/customers/me", response_model=CustomerRead)
def my_customer_profile(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_customer_for_user(db, user)


@router.post("/customers", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user: User = Depends(require_staff)):
    customer = Customer(**payload.model_dump())
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.put("/customers/{customer_id}", response_model=CustomerRead)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    customer = db.get(Customer, customer_id)
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(customer, field, value)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("/products", response_model=list[ProductRead])
def list_products(
    active: bool | None = None,
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    limit, offset = pagination
    query = select(Product).options(selectinload(Product.variants)).order_by(Product.id.desc())
    if active is not None:
        query = query.where(Product.active.is_(active))
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(payload: ProductCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    product = Product(
        name=payload.name,
        product_type=payload.product_type,
        description=payload.description,
        variants=[ProductVariant(**variant.model_dump()) for variant in payload.variants],
    )
    db.add(product)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A product with this name already exists") from exc
    db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=ProductRead)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    product = db.scalar(select(Product).options(selectinload(Product.variants)).where(Product.id == product_id))
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_product(product_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    product.active = False
    db.commit()


@router.get("/plans", response_model=list[PlanRead])
def list_plans(
    active: bool | None = None,
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    limit, offset = pagination
    query = select(Plan).order_by(Plan.id.desc())
    if active is not None:
        query = query.where(Plan.active.is_(active))
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.post("/plans", response_model=PlanRead, status_code=status.HTTP_201_CREATED)
def create_plan(payload: PlanCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    product = db.get(Product, payload.product_id)
    if product is None or not product.active:
        raise HTTPException(status_code=400, detail="Plan requires an active product")
    plan = Plan(**payload.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.put("/plans/{plan_id}", response_model=PlanRead)
def update_plan(plan_id: int, payload: PlanUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plan = db.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plan not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    if plan.available_from and plan.available_until and plan.available_from > plan.available_until:
        raise HTTPException(status_code=422, detail="Plan availability dates are invalid")
    db.commit()
    db.refresh(plan)
    return plan


@router.get("/subscriptions", response_model=list[SubscriptionRead])
def list_subscriptions(
    subscription_status: str | None = Query(default=None, alias="status"),
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    limit, offset = pagination
    query = select(Subscription).order_by(Subscription.id.desc())
    if user.role == "customer":
        query = query.where(Subscription.customer_id == get_customer_for_user(db, user).id)
    if subscription_status:
        query = query.where(Subscription.status == subscription_status)
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.post("/subscriptions", response_model=SubscriptionRead, status_code=status.HTTP_201_CREATED)
def create_subscription(
    payload: SubscriptionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    customer = db.get(Customer, payload.customer_id)
    if user.role == "customer" and (customer is None or customer.user_id != user.id):
        raise HTTPException(status_code=404, detail="Customer not found")
    plan = db.scalar(select(Plan).options(selectinload(Plan.product)).where(Plan.id == payload.plan_id))
    today = date.today()
    if customer is None:
        raise HTTPException(status_code=404, detail="Customer not found")
    if plan is None or not plan.active or not plan.product.active:
        raise HTTPException(status_code=400, detail="Plan is unavailable")
    if payload.quantity < plan.minimum_quantity:
        raise HTTPException(status_code=422, detail=f"Minimum quantity for this plan is {plan.minimum_quantity}")
    start_date = payload.start_date or today
    if plan.available_from and start_date < plan.available_from:
        raise HTTPException(status_code=400, detail="Plan is not yet available")
    if plan.available_until and start_date > plan.available_until:
        raise HTTPException(status_code=400, detail="Plan is no longer available")
    subscription = Subscription(
        number=f"SUB-{uuid4().hex[:12].upper()}",
        customer_id=customer.id,
        plan_id=plan.id,
        quantity=payload.quantity,
        unit_price=plan.price,
        tax_rate=plan.tax_rate,
        currency=plan.currency,
        status="active",
        start_date=start_date,
        next_billing_date=add_interval(start_date, plan.billing_frequency),
        auto_renew=payload.auto_renew,
    )
    db.add(subscription)
    db.flush()
    create_invoice_for_cycle(db, subscription, start_date, user)
    audit(db, user, "subscription.created", "subscription", subscription.id)
    db.commit()
    db.refresh(subscription)
    return subscription


@router.post("/subscriptions/{subscription_id}/{action}", response_model=SubscriptionRead)
def subscription_action(
    subscription_id: int,
    action: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    subscription = db.get(Subscription, subscription_id)
    if subscription is None or (user.role == "customer" and subscription.customer_id != get_customer_for_user(db, user).id):
        raise HTTPException(status_code=404, detail="Subscription not found")
    transitions = {"pause": ("active", "paused"), "resume": ("paused", "active"), "close": ("active", "closed")}
    if action not in transitions:
        raise HTTPException(status_code=404, detail="Unsupported subscription action")
    before, after = transitions[action]
    if subscription.status != before:
        raise HTTPException(status_code=409, detail=f"Cannot {action} a {subscription.status} subscription")
    subscription.status = after
    if action == "close":
        subscription.auto_renew = False
    audit(db, user, f"subscription.{action}", "subscription", subscription.id)
    db.commit()
    db.refresh(subscription)
    return subscription


@router.get("/invoices", response_model=list[InvoiceRead])
def list_invoices(
    invoice_status: str | None = Query(default=None, alias="status"),
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    limit, offset = pagination
    query = select(Invoice).options(selectinload(Invoice.lines)).order_by(Invoice.invoice_date.desc(), Invoice.id.desc())
    if user.role == "customer":
        query = query.where(Invoice.customer_id == get_customer_for_user(db, user).id)
    if invoice_status:
        query = query.where(Invoice.status == invoice_status)
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/invoices/{invoice_id}", response_model=InvoiceRead)
def read_invoice(invoice_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return get_scoped_invoice(db, invoice_id, user)


@router.post("/invoices/{invoice_id}/payments", response_model=PaymentRead, status_code=status.HTTP_201_CREATED)
def record_payment(
    invoice_id: int,
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    invoice = db.scalar(select(Invoice).where(Invoice.id == invoice_id).with_for_update())
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cannot pay a cancelled invoice")
    outstanding = invoice.total - invoice.paid_amount
    if payload.amount > outstanding:
        raise HTTPException(status_code=422, detail="Payment exceeds the invoice outstanding balance")
    payment = Payment(
        reference=f"PAY-{uuid4().hex[:12].upper()}",
        invoice_id=invoice.id,
        amount=payload.amount,
        method=payload.method,
        transaction_reference=payload.transaction_reference,
        notes=payload.notes,
        paid_at=datetime.now(timezone.utc),
    )
    invoice.paid_amount += payload.amount
    invoice.status = "paid" if invoice.paid_amount == invoice.total else "partially_paid"
    db.add(payment)
    db.flush()
    audit(db, user, "payment.recorded", "payment", payment.id, f"Invoice {invoice.number}")
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/payments", response_model=list[PaymentRead])
def list_payments(
    pagination: tuple[int, int] = Depends(page_params),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    limit, offset = pagination
    query = select(Payment).join(Invoice).order_by(Payment.paid_at.desc())
    if user.role == "customer":
        query = query.where(Invoice.customer_id == get_customer_for_user(db, user).id)
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.post("/billing/run", status_code=status.HTTP_200_OK)
def run_billing(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    result = generate_due_invoices(db, admin)
    db.commit()
    return result


@router.post("/model/train", status_code=status.HTTP_200_OK)
def train_invoice_status_model(admin: User = Depends(require_admin)):
    model, dataset = train_from_file()
    return {
        "algorithm": model["algorithm"],
        "target": model["target"],
        "as_of_date": model["as_of_date"],
        "training_rows": model["training_rows"],
        "class_counts": model["class_counts"],
        "invoices": [
            {
                "id": invoice["id"],
                "due_date": invoice["due_date"],
                "total": invoice["total"],
                "status": invoice["status"],
            }
            for invoice in dataset["invoices"]
        ],
        "note": "Demo only: four rows are not enough to validate real-world predictions.",
    }


@router.post("/model/predict")
def predict_invoice_status(payload: InvoiceStatusPredictionRequest, admin: User = Depends(require_admin)):
    try:
        with DEFAULT_MODEL.open(encoding="utf-8") as model_file:
            model = json.load(model_file)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=409, detail="Train the invoice model before requesting a prediction") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="The saved invoice model is invalid") from exc

    return {
        **predict(model, {"total": str(payload.total), "due_date": payload.due_date.isoformat()}),
        "note": "Demo prediction only; this model was trained on four invoices and is not reliable for billing decisions.",
    }


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: User = Depends(require_staff)):
    today = date.today()
    customers = db.scalar(select(func.count(Customer.id))) or 0
    active_subscriptions = db.scalar(
        select(func.count(Subscription.id)).where(Subscription.status == "active")
    ) or 0
    received = db.scalar(select(func.coalesce(func.sum(Payment.amount), 0))) or Decimal("0")
    outstanding = db.scalar(
        select(func.coalesce(func.sum(Invoice.total - Invoice.paid_amount), 0)).where(
            Invoice.status.in_(("confirmed", "partially_paid", "overdue"))
        )
    ) or Decimal("0")
    overdue = db.scalar(
        select(func.count(Invoice.id)).where(
            Invoice.due_date < today,
            Invoice.status.in_(("confirmed", "partially_paid", "overdue")),
        )
    ) or 0
    upcoming = db.scalar(
        select(func.count(Subscription.id)).where(
            Subscription.status == "active",
            Subscription.next_billing_date >= today,
            Subscription.next_billing_date <= date.fromordinal(today.toordinal() + 30),
        )
    ) or 0
    recent_payments = db.scalars(
        select(Payment).order_by(Payment.paid_at.desc()).limit(5)
    ).all()
    return {
        "customers": customers,
        "active_subscriptions": active_subscriptions,
        "revenue_received": received,
        "outstanding_revenue": outstanding,
        "overdue_invoices": overdue,
        "upcoming_renewals": upcoming,
        "recent_payments": [PaymentRead.model_validate(payment) for payment in recent_payments],
    }


@router.get("/reports/revenue")
def revenue_report(
    start_date: date = Query(),
    end_date: date = Query(),
    db: Session = Depends(get_db),
    user: User = Depends(require_staff),
):
    if start_date > end_date:
        raise HTTPException(status_code=422, detail="start_date must be on or before end_date")
    month_column = (
        func.to_char(Payment.paid_at, "YYYY-MM")
        if db.bind is not None and db.bind.dialect.name == "postgresql"
        else func.strftime("%Y-%m", Payment.paid_at)
    )
    rows = db.execute(
        select(
            month_column.label("month"),
            func.sum(Payment.amount).label("revenue"),
        )
        .where(
            Payment.paid_at >= datetime.combine(start_date, time.min, tzinfo=timezone.utc),
            Payment.paid_at < datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=timezone.utc),
        )
        .group_by("month")
        .order_by("month")
    ).all()
    return [{"month": row.month, "revenue": row.revenue} for row in rows]
