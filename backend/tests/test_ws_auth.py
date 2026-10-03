"""/ws/live now requires the same JWT every REST endpoint requires (see
app/api/routes_ws.py). A browser's WebSocket API can't set an
Authorization header, so the token travels as a query string instead:
`/ws/live?token=<jwt>`.
"""
import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from app.main import app

# Same reason every test in test_api_auth.py takes the `db` fixture even
# without touching it directly: it resets tables before TestClient's
# lifespan re-seeds the demo users.


def _login(client: TestClient, username: str, password: str) -> str:
    resp = client.post("/api/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200
    return resp.json()["access_token"]


def test_connect_with_no_token_is_rejected(db):
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/live"):
                pass
        assert exc_info.value.code == 1008


def test_connect_with_garbage_token_is_rejected(db):
    with TestClient(app) as client:
        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect("/ws/live?token=not-a-real-jwt"):
                pass
        assert exc_info.value.code == 1008


def test_connect_with_valid_token_is_accepted(db):
    with TestClient(app) as client:
        token = _login(client, "viewer", "viewer123")
        # No exception on connect == the server accepted the handshake.
        # It also proves a viewer -- the lowest role -- is let in, matching
        # the REST API's read endpoints (e.g. GET /api/devices), which only
        # require an authenticated user, not a minimum role.
        with client.websocket_connect(f"/ws/live?token={token}"):
            pass


def test_connect_with_deactivated_users_token_is_rejected(db):
    """A token can decode fine and still belong to a user who was
    deactivated after it was issued -- that must still be rejected, same
    as get_current_user does for the REST API."""
    with TestClient(app) as client:
        token = _login(client, "viewer", "viewer123")

        from app.database import SessionLocal
        from app.models.user import User

        session = SessionLocal()
        try:
            user = session.query(User).filter(User.username == "viewer").one()
            user.is_active = False
            session.commit()
        finally:
            session.close()

        with pytest.raises(WebSocketDisconnect) as exc_info:
            with client.websocket_connect(f"/ws/live?token={token}"):
                pass
        assert exc_info.value.code == 1008
