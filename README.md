# SubscriptIQ

SubscriptIQ is a subscription and recurring billing workspace for Brightloop Software. This repository now includes a responsive React + TypeScript web app and a FastAPI API with role-based access, customer and product management, plans, subscriptions, recurring invoices, payment recording, and a live finance dashboard.

This is a working MVP, not every item in the original project brief. Quotation workflows, discounts, admin tax-rule management, PDF invoices, automated scheduled billing, and production deployment configuration are not implemented yet.

## Run locally in VS Code (Windows)

The backend defaults to a local SQLite database (`backend/subscriptiq.db`) for development. PostgreSQL can be selected with `DATABASE_URL` in `backend/.env`. Do not use the development JWT secret in production.

### 1. Prepare and migrate the backend

In the VS Code terminal, from the project root:

```powershell
Set-Location .\backend
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
alembic upgrade head
```

The included first migration creates the MVP tables. The SQLite database is local and ignored by Git.

### 2. Create the first admin user

Still in `backend`:

```powershell
python -m app.cli create-admin
```

Enter an email, name, and a password longer than 8 characters that includes uppercase, lowercase, and a special character. Customer accounts can register from the sign-in page. Admin/staff permissions are enforced by the API.

### 3. Start the API

In the backend terminal:

```powershell
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API docs: `http://127.0.0.1:8000/docs`. Health endpoints: `/health` and `/api/v1/health`.

### 4. Start the website

Open a second VS Code terminal from the project root:

```powershell
Set-Location .\frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The frontend calls `http://127.0.0.1:8000/api/v1` by default. To use another API address, set `VITE_API_URL` in `frontend/.env.local` (for example `VITE_API_URL=http://127.0.0.1:16453/api/v1`).

## Core workflows

- Admin: create products and plans; add customers; create and manage subscriptions; view invoices and record payments.
- Staff: manage permitted customer, subscription, invoice, and payment operations.
- Customer: register, view only their own subscriptions/invoices/payments, and pause/resume eligible subscriptions.
- Subscription creation generates the first invoice using backend decimal arithmetic and snapshots tax/price values.
- Admins can use **Run billing** on the invoices screen to process due subscription billing cycles. Cycle uniqueness prevents duplicate invoices on retries.
- Dashboard cards, charts, subscription health, and recent invoices are loaded from API/database queries, not seeded mock values.

## Demo invoice-status model

Admins can open **Model training** in the website sidebar and select **Train model** to run a small Naive Bayes training example using the four invoice records in `backend/data/invoice_training_data.json`. After training, the page lets admins enter an invoice total and due date to see an illustrative predicted status and class probabilities. The admin-only backend endpoint saves the trained model to `backend/models/invoice_status_model.json`; the page also displays the class counts and invoice labels. The command-line equivalent, from the `backend` directory, is:

```powershell
python -m app.train_model
```

The command saves the trained model to `backend/models/invoice_status_model.json`. It classifies the provided invoice status labels (`paid`, `unpaid`, or `overdue`) from invoice total and due-date timing. This is a training demonstration only: four records are far too few to validate useful predictions, and the model should not be used for billing decisions. Add substantially more representative historical invoices before evaluating or using predictions.

## Sample dashboard data

To populate an empty local workspace with the five sample customers, subscriptions, four invoices, and three payments, run from `backend`:

```powershell
python -m app.cli seed-demo
```

The seed command refuses to run if workspace business records already exist, and it does not modify user accounts. The sample data is in `backend/data/demo_workspace.json`.

## PostgreSQL

Install and start PostgreSQL, create a database/role, then create `backend/.env` from `.env.example` and configure:

```dotenv
DATABASE_URL=postgresql+psycopg://subscriptiq:YOUR_URL_ENCODED_PASSWORD@localhost:5432/subscriptiq
JWT_SECRET_KEY=use-a-private-random-secret
```

Generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Apply migrations from `backend` using `alembic upgrade head`. The default SQLite URL is only intended for local development.

## Checks

Backend tests (run from `backend`):

```powershell
python -m pytest
```

Frontend type-check and production build (run from `frontend`):

```powershell
npm run build
npm run lint
```

The tests use an isolated in-memory SQLite database. They cover health endpoints, registration and role limits, and a product → plan → subscription → invoice → partial payment workflow.
