from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_reports_service_name() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"name": "SubscriptIQ API"}


def test_liveness_does_not_require_database() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_checks_database_connection() -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "connected"}
