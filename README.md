# SubscriptIQ

SubscriptIQ is a subscription management application for Brightloop Software. The current project contains a FastAPI backend with JWT authentication and roles, customer/product/plan/subscription APIs, recurring invoice generation, payment recording, and dashboard/report endpoints. It is an MVP in progress, not the complete system described in the project brief: a React frontend, configured PostgreSQL deployment, initial domain migration, quotation/tax/discount workflows, PDF invoices, and broader automated tests remain to be built.

## Backend setup (Windows PowerShell)

Install PostgreSQL for Windows from [the official PostgreSQL downloads page](https://www.postgresql.org/download/windows/), and make sure its database service is running. This workspace currently has no PostgreSQL server, `psql`, or Docker available, so PostgreSQL connectivity must be configured before the backend readiness endpoint can report success.

Open PowerShell in the project directory and run:

```powershell
Set-Location .\backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
```

Set `DATABASE_URL` and `JWT_SECRET_KEY` in `.env` to your PostgreSQL connection and a private random secret, for example:

```dotenv
DATABASE_URL=postgresql+psycopg://subscriptiq:YOUR_URL_ENCODED_PASSWORD@localhost:5432/subscriptiq
JWT_SECRET_KEY=replace_with_a_private_random_secret_at_least_32_characters
```

Replace the example username/password with your local PostgreSQL role and URL-encode special characters in the password. Generate a JWT key with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Do not commit `.env` or use development credentials in production.

Create a database and role using pgAdmin, or connect to PostgreSQL as an administrator and run:

```sql
CREATE ROLE subscriptiq WITH LOGIN PASSWORD 'choose-a-local-password';
CREATE DATABASE subscriptiq OWNER subscriptiq;
```

Run the API from the `backend` directory:

```powershell
python -m uvicorn app.main:app --reload
```

Verify:

- `http://127.0.0.1:8000/` returns the service name.
- `http://127.0.0.1:8000/health` returns `{"status":"ok"}` (process liveness).
- `http://127.0.0.1:8000/api/v1/health` runs `SELECT 1` against the configured database. It returns HTTP 503 with a generic error if PostgreSQL is unavailable or misconfigured.
- `http://127.0.0.1:8000/docs` opens Swagger UI.

## Migrations

Alembic is configured to read `DATABASE_URL` and `Base.metadata`. Once application models have been added, create and apply a migration from `backend`:

```powershell
alembic revision --autogenerate -m "add initial application tables"
alembic upgrade head
```

There is intentionally no empty initial migration: Phase 1 has no domain models to migrate. Never use `Base.metadata.create_all()` as a replacement for migrations in deployed environments.

The current API models exist, but no initial schema migration has been committed yet. Do not use the business endpoints against PostgreSQL until an initial migration has been created and applied.

## Initial account and API coverage

Create the first administrator after applying the schema:

```powershell
python -m app.cli create-admin
```

Public registration creates customer accounts; staff account creation requires an administrator. The backend exposes `/api/v1/auth`, `/users/staff`, `/customers`, `/products`, `/plans`, `/subscriptions`, `/invoices`, `/payments`, `/billing/run`, `/dashboard`, and `/reports/revenue`. Private endpoints require a Bearer access token. Billing can be run manually by an administrator; no background scheduler is configured yet.

## Tests

Install the requirements, then run from `backend`:

```powershell
python -m pytest
```

The health endpoint test uses an isolated in-memory SQLite database so it does not modify PostgreSQL or other local data. SQLite is test-only; the application runtime is configured for PostgreSQL.
