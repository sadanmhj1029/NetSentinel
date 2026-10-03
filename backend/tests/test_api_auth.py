"""API-level smoke tests for auth and RBAC (spec section 25)."""
from fastapi.testclient import TestClient

from app.main import app


# Every test here requests the `db` fixture (even though it never touches
# `db` directly) purely for its side effect: it drops and recreates all
# tables *before* TestClient's lifespan runs `seed.run_all()`. Without it,
# tables persist across tests/runs (seeding is deliberately idempotent --
# see app/seed.py), so e.g. "Test-Device-01" created by the create-device
# test below would still be there on the next run and turn its expected
# 200 into a 409.


def test_health_check_needs_no_auth(db):
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


def test_login_with_seeded_demo_users_and_role_enforcement(db):
    with TestClient(app) as client:
        resp = client.post("/api/auth/login", data={"username": "admin", "password": "admin123"})
        assert resp.status_code == 200
        token = resp.json()["access_token"]
        assert resp.json()["role"] == "admin"

        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == "admin"


def test_login_rejects_wrong_password(db):
    with TestClient(app) as client:
        resp = client.post("/api/auth/login", data={"username": "admin", "password": "wrong"})
        assert resp.status_code == 401


def test_viewer_cannot_create_devices_but_admin_can(db):
    with TestClient(app) as client:
        viewer_token = client.post(
            "/api/auth/login", data={"username": "viewer", "password": "viewer123"}
        ).json()["access_token"]
        admin_token = client.post(
            "/api/auth/login", data={"username": "admin", "password": "admin123"}
        ).json()["access_token"]

        body = {
            "device_id": "Test-Device-01",
            "hostname": "test-01",
            "ip_address": "10.9.9.9",
            "device_type": "pc",
        }

        denied = client.post("/api/devices", json=body, headers={"Authorization": f"Bearer {viewer_token}"})
        assert denied.status_code == 403

        allowed = client.post("/api/devices", json=body, headers={"Authorization": f"Bearer {admin_token}"})
        assert allowed.status_code == 200
        assert allowed.json()["device_id"] == "Test-Device-01"


def test_protected_endpoint_requires_a_token(db):
    with TestClient(app) as client:
        resp = client.get("/api/devices")
        assert resp.status_code == 401
