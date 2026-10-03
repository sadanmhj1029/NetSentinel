from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import NotificationTestRequest
from app.security import get_current_user, require_role
from app.services import audit
from app.services.notifications import get_channel_statuses, send_incident_notification

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("/notifications")
def get_notification_settings(_user=Depends(get_current_user)):
    return get_channel_statuses()


@router.post("/notifications/test")
def test_notifications(
    body: NotificationTestRequest | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_role("operator")),
):
    now_str = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    msg = (body.custom_message if body and body.custom_message else None) or "Manual verification of alert dispatch pipeline"

    test_incident = {
        "incident_id": "INC-TEST-0001",
        "title": f"Test Alert: {msg}",
        "severity": "critical",
        "probable_root_cause_device_id": "Switch-02",
        "root_cause_confidence_label": "high",
        "affected_devices": ["Switch-02", "Server-01", "PC-03"],
        "detected_at": now_str,
    }

    result = send_incident_notification(test_incident)
    audit.record(
        db,
        user.username,
        "notification_channel_test_triggered",
        resource="alert_dispatchers",
        new_state=result,
    )
    return {
        "status": "completed",
        "delivered_via": result["delivered_via"],
        "message": result["message"],
        "channels": get_channel_statuses(),
    }
