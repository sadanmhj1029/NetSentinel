from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.device import Device
from app.models.incident import Incident
from app.models.topology import TopologyLink
from app.schemas import TopologyLinkCreate
from app.security import get_current_user, require_role
from app.services import audit

router = APIRouter(prefix="/api/topology", tags=["topology"])


@router.get("")
def get_topology(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    devices = db.query(Device).all()
    links = db.query(TopologyLink).all()
    active_incidents = db.query(Incident).filter(Incident.status != "resolved").all()

    incident_by_device: dict[str, list[str]] = {}
    for incident in active_incidents:
        for device_id in incident.affected_devices or []:
            incident_by_device.setdefault(device_id, []).append(incident.incident_id)

    nodes = [
        {
            **d.to_dict(),
            "active_incidents": incident_by_device.get(d.device_id, []),
            "is_root_cause_of": [
                inc.incident_id for inc in active_incidents if inc.probable_root_cause_device_id == d.device_id
            ],
        }
        for d in devices
    ]
    edges = [link.to_dict() for link in links]
    return {"nodes": nodes, "edges": edges}


@router.post("/links")
def create_link(body: TopologyLinkCreate, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    for dev_id in (body.source_device_id, body.destination_device_id):
        if not db.get(Device, dev_id):
            raise HTTPException(status_code=404, detail=f"Device {dev_id} not found")
    link = TopologyLink(**body.model_dump(), dependency_direction="parent_to_child")
    db.add(link)
    db.commit()
    audit.record(db, user.username, "topology_link_created", new_state=link.to_dict())
    return link.to_dict()


@router.delete("/links/{link_id}")
def delete_link(link_id: int, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    link = db.get(TopologyLink, link_id)
    if not link:
        raise HTTPException(status_code=404, detail="Link not found")
    before = link.to_dict()
    db.delete(link)
    db.commit()
    audit.record(db, user.username, "topology_link_deleted", previous_state=before)
    return {"status": "deleted"}
