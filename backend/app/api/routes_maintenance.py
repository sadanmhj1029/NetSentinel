from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.correlation.topology_graph import descendants, load_graph
from app.database import get_db
from app.models.device import Device
from app.models.maintenance import MaintenanceWindow
from app.security import get_current_user, require_role
from app.services import audit
from app.services.maintenance import active_windows
from app.utils import utcnow

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])


class MaintenanceStart(BaseModel):
    device_id: str
    duration_minutes: int = Field(default=60, ge=5, le=24 * 60)
    reason: str = Field(default="Planned maintenance", max_length=255)


@router.get("")
def list_maintenance(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Active windows, each with the devices behind it that it also covers."""
    now = utcnow()
    graph = load_graph(db)
    out = []
    for w in active_windows(db, now):
        d = w.to_dict(now)
        d["covers"] = sorted(descendants(graph, w.device_id))
        out.append(d)
    return out


@router.get("/history")
def maintenance_history(limit: int = 50, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    now = utcnow()
    rows = db.query(MaintenanceWindow).order_by(MaintenanceWindow.created_at.desc()).limit(min(limit, 200)).all()
    return [w.to_dict(now) for w in rows]


@router.post("")
def start_maintenance(body: MaintenanceStart, db: Session = Depends(get_db), user=Depends(require_role("operator"))):
    device = db.get(Device, body.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    now = utcnow()
    # One active window per device: extend/replace instead of stacking.
    for w in active_windows(db, now):
        if w.device_id == body.device_id:
            w.ended_early_at = now
    window = MaintenanceWindow(
        device_id=body.device_id,
        reason=body.reason.strip() or "Planned maintenance",
        starts_at=now,
        ends_at=now + dt.timedelta(minutes=body.duration_minutes),
        created_by=user.username,
    )
    db.add(window)
    db.commit()
    audit.record(db, user.username, "maintenance_started", resource=body.device_id, new_state=window.to_dict(now))
    return window.to_dict(now)


@router.post("/{window_id}/end")
def end_maintenance(window_id: int, db: Session = Depends(get_db), user=Depends(require_role("operator"))):
    window = db.get(MaintenanceWindow, window_id)
    if not window:
        raise HTTPException(status_code=404, detail="Maintenance window not found")
    now = utcnow()
    if window.is_active(now):
        window.ended_early_at = now
        db.commit()
        audit.record(db, user.username, "maintenance_ended", resource=window.device_id, new_state=window.to_dict(now))
    return window.to_dict(now)
