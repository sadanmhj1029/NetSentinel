from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.incident import Incident
from app.schemas import AcknowledgeRequest, OperatorNote, ResolveRequest
from app.security import get_current_user, require_role
from app.services import audit
from app.utils import utcnow

router = APIRouter(prefix="/api/incidents", tags=["incidents"])


@router.get("")
def list_incidents(
    status: str | None = None,
    severity: str | None = None,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    query = db.query(Incident)
    if status:
        query = query.filter(Incident.status == status)
    if severity:
        query = query.filter(Incident.severity == severity)
    incidents = query.order_by(Incident.created_at.desc()).all()
    return [i.to_dict() for i in incidents]


@router.get("/{incident_id}")
def get_incident(incident_id: str, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    events = db.query(Event).filter(Event.incident_id == incident_id).order_by(Event.timestamp.asc()).all()
    data = incident.to_dict()
    data["events"] = [e.to_dict() for e in events]
    return data


@router.post("/{incident_id}/acknowledge")
def acknowledge_incident(
    incident_id: str,
    body: AcknowledgeRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("operator")),
):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.acknowledged = True
    incident.acknowledged_by = user.username
    incident.acknowledged_at = utcnow()
    if incident.status in ("detected", "investigating"):
        incident.status = "acknowledged"
    if body.note:
        incident.operator_notes = (incident.operator_notes or []) + [
            {"author": user.username, "note": body.note, "timestamp": utcnow().isoformat()}
        ]
    incident.timeline = (incident.timeline or []) + [
        {"stage": "acknowledged", "timestamp": utcnow().isoformat(), "by": user.username}
    ]
    db.commit()
    audit.record(db, user.username, "incident_acknowledged", resource=incident_id)
    return incident.to_dict()


@router.post("/{incident_id}/notes")
def add_note(
    incident_id: str, body: OperatorNote, db: Session = Depends(get_db), user=Depends(require_role("operator"))
):
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.operator_notes = (incident.operator_notes or []) + [
        {"author": user.username, "note": body.note, "timestamp": utcnow().isoformat()}
    ]
    db.commit()
    audit.record(db, user.username, "incident_note_added", resource=incident_id, new_state={"note": body.note})
    return incident.to_dict()


@router.post("/{incident_id}/resolve")
def manually_resolve(
    incident_id: str, body: ResolveRequest, db: Session = Depends(get_db), user=Depends(require_role("operator"))
):
    """Manual override -- the engine resolves incidents automatically on
    verified recovery, but an operator can close one early (e.g. known
    false positive) with a recorded reason."""
    incident = db.get(Incident, incident_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")
    incident.status = "resolved"
    incident.resolution = body.resolution
    incident.resolved_at = utcnow()
    incident.recovery_time_seconds = (incident.resolved_at - incident.detected_at).total_seconds()
    incident.timeline = (incident.timeline or []) + [
        {"stage": "resolved", "timestamp": utcnow().isoformat(), "by": user.username, "manual": True}
    ]
    db.commit()
    audit.record(db, user.username, "incident_manually_resolved", resource=incident_id, new_state={"resolution": body.resolution})
    return incident.to_dict()
