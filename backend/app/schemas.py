import re
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, computed_field, field_validator, model_validator


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserRead(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: str


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=160)
    password: str

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if (
            len(value) <= 8
            or not re.search(r"[A-Z]", value)
            or not re.search(r"[a-z]", value)
            or not re.search(r"[^A-Za-z0-9]", value)
        ):
            raise ValueError("Password must be longer than 8 characters and contain uppercase, lowercase, and special characters")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class StaffCreate(RegisterRequest):
    role: Literal["staff"]


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    company: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = None


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    email: EmailStr | None = None
    company: str | None = Field(default=None, max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    address: str | None = None


class CustomerRead(ORMModel):
    id: int
    user_id: int | None
    name: str
    email: str
    company: str | None
    phone: str | None
    address: str | None
    created_at: datetime


class VariantCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    price_adjustment: Decimal = Field(default=Decimal("0"), ge=0, max_digits=12, decimal_places=2)


class VariantRead(ORMModel):
    id: int
    name: str
    price_adjustment: Decimal
    active: bool


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    product_type: str = Field(default="software", max_length=80)
    description: str | None = None
    variants: list[VariantCreate] = Field(default_factory=list)


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    product_type: str | None = Field(default=None, max_length=80)
    description: str | None = None
    active: bool | None = None


class ProductRead(ORMModel):
    id: int
    name: str
    product_type: str
    description: str | None
    active: bool
    variants: list[VariantRead]


class PlanCreate(BaseModel):
    product_id: int
    name: str = Field(min_length=1, max_length=160)
    billing_frequency: Literal["daily", "weekly", "monthly", "yearly"]
    price: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    minimum_quantity: int = Field(default=1, ge=1)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=100, max_digits=5, decimal_places=2)
    available_from: date | None = None
    available_until: date | None = None

    @model_validator(mode="after")
    def validate_availability(self):
        if self.available_from and self.available_until and self.available_from > self.available_until:
            raise ValueError("available_from must be on or before available_until")
        return self


class PlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    billing_frequency: Literal["daily", "weekly", "monthly", "yearly"] | None = None
    price: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    minimum_quantity: int | None = Field(default=None, ge=1)
    tax_rate: Decimal | None = Field(default=None, ge=0, le=100, max_digits=5, decimal_places=2)
    available_from: date | None = None
    available_until: date | None = None
    active: bool | None = None


class PlanRead(ORMModel):
    id: int
    product_id: int
    name: str
    billing_frequency: str
    price: Decimal
    currency: str
    minimum_quantity: int
    tax_rate: Decimal
    available_from: date | None
    available_until: date | None
    active: bool


class SubscriptionCreate(BaseModel):
    customer_id: int
    plan_id: int
    quantity: int = Field(default=1, ge=1)
    start_date: date | None = None
    auto_renew: bool = True


class SubscriptionRead(ORMModel):
    id: int
    number: str
    customer_id: int
    plan_id: int
    quantity: int
    unit_price: Decimal
    tax_rate: Decimal
    currency: str
    status: str
    start_date: date
    next_billing_date: date
    auto_renew: bool


class InvoiceLineRead(ORMModel):
    id: int
    description: str
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class InvoiceRead(ORMModel):
    id: int
    number: str
    customer_id: int
    subscription_id: int
    billing_period_start: date
    invoice_date: date
    due_date: date
    currency: str
    subtotal: Decimal
    tax_rate: Decimal
    tax_amount: Decimal
    total: Decimal
    paid_amount: Decimal
    status: str
    lines: list[InvoiceLineRead]

    @computed_field
    @property
    def outstanding_amount(self) -> Decimal:
        return self.total - self.paid_amount


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    method: Literal["cash", "bank_transfer", "card", "upi", "other"]
    transaction_reference: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class InvoiceStatusPredictionRequest(BaseModel):
    total: Decimal = Field(ge=0, max_digits=12, decimal_places=2)
    due_date: date


class PaymentRead(ORMModel):
    id: int
    reference: str
    invoice_id: int
    amount: Decimal
    method: str
    transaction_reference: str | None
    notes: str | None
    paid_at: datetime
