from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.monitoring.discovery import discovery_engine
from app.schemas import DiscoveryImportRequest, DiscoveryScanRequest
from app.security import get_current_user, require_role
from app.services import audit

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


@router.get("/status")
def get_discovery_status(_user=Depends(get_current_user)):
    return {
        "is_scanning": discovery_engine.is_scanning(),
        "last_result": discovery_engine.get_last_result(),
    }


@router.post("/scan")
def trigger_subnet_scan(
    body: DiscoveryScanRequest,
    _user=Depends(require_role("operator")),
):
    if discovery_engine.is_scanning():
        raise HTTPException(status_code=409, detail="A network discovery scan is already in progress.")
    try:
        result = discovery_engine.scan_subnet(
            subnet_cidr=body.subnet,
            timeout_sec=body.timeout_sec,
            max_hosts=body.max_hosts,
        )
        return result
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.post("/import")
def import_discovered_devices(
    body: DiscoveryImportRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role("admin")),
):
    if not body.devices:
        raise HTTPException(status_code=400, detail="No devices provided for import.")

    imported_ids = discovery_engine.import_devices(
        db=db,
        devices_to_import=body.devices,
        uplink_parent_id=body.uplink_parent_id,
        site=body.site,
        department=body.department,
    )
    audit.record(
        db,
        user.username,
        "devices_auto_discovered_and_imported",
        resource=f"{len(imported_ids)} devices",
        new_state={"imported_device_ids": imported_ids},
    )
    return {
        "status": "success",
        "imported_count": len(imported_ids),
        "imported_device_ids": imported_ids,
    }
