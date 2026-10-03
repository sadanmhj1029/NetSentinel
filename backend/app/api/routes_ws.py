from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from app.database import SessionLocal
from app.models.user import User
from app.security import decode_token
from app.websocket_manager import manager

router = APIRouter(tags=["live"])


def _authenticate(token: Optional[str]) -> Optional[User]:
    """Validate the JWT the same way every REST endpoint does (see
    get_current_user in app/security.py) -- but a browser's WebSocket API
    can't attach an Authorization header to the handshake, so the token
    travels as a query param instead: `/ws/live?token=<jwt>`.

    Any active user is let through here, matching the REST API's read
    endpoints (e.g. GET /api/devices), which only depend on
    get_current_user with no minimum role."""
    if not token:
        return None
    payload = decode_token(token)
    if not payload or "sub" not in payload:
        return None
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == payload["sub"]).first()
        return user if user and user.is_active else None
    finally:
        db.close()


@router.websocket("/ws/live")
async def live_updates(websocket: WebSocket, token: Optional[str] = None):
    if _authenticate(token) is None:
        # Reject before accept()-ing the handshake so the client sees a
        # clean close with code 1008 rather than a hang or silent drop.
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await manager.connect(websocket)
    try:
        while True:
            # The client doesn't need to send anything; we just need the
            # receive loop to detect disconnects. Anything it does send is
            # ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
    except Exception:
        await manager.disconnect(websocket)
