from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.detection.baseline import baseline_store
from app.models.device import Device
from app.models.interface import Interface
from app.models.metric import MetricSample
from app.ml.infer import score_device
from app.schemas import DeviceCreate, DeviceUpdate
from app.security import get_current_user, require_role
from app.services import audit

router = APIRouter(prefix="/api/devices", tags=["devices"])


@router.get("")
def list_devices(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    return [d.to_dict() for d in db.query(Device).order_by(Device.device_id).all()]


@router.post("")
def create_device(body: DeviceCreate, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    if db.get(Device, body.device_id):
        raise HTTPException(status_code=409, detail="Device already exists")
    device = Device(**body.model_dump())
    db.add(device)
    db.add(Interface(device_id=device.device_id, name="eth0", capacity_mbps=1000.0, state="up"))
    db.commit()
    audit.record(db, user.username, "device_created", resource=device.device_id, new_state=device.to_dict())
    return device.to_dict()


@router.get("/{device_id}")
def get_device(device_id: str, db: Session = Depends(get_db), _user=Depends(get_current_user)):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device.to_dict()


@router.patch("/{device_id}")
def update_device(
    device_id: str, body: DeviceUpdate, db: Session = Depends(get_db), user=Depends(require_role("admin"))
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    before = device.to_dict()
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    db.commit()
    audit.record(db, user.username, "device_updated", resource=device_id, previous_state=before, new_state=device.to_dict())
    return device.to_dict()


@router.delete("/{device_id}")
def deactivate_device(device_id: str, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    before = device.to_dict()
    device.is_active = False
    device.status = "unknown"
    db.commit()
    audit.record(db, user.username, "device_deactivated", resource=device_id, previous_state=before)
    return {"status": "deactivated", "device_id": device_id}


@router.get("/{device_id}/metrics")
def device_metrics(
    device_id: str,
    minutes: int = 30,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)
    samples = (
        db.query(MetricSample)
        .filter(MetricSample.device_id == device_id, MetricSample.timestamp >= since)
        .order_by(MetricSample.timestamp.asc())
        .all()
    )

    latest_latency_baseline = None
    if samples and samples[-1].latency_ms is not None:
        # Peek without mutating: re-evaluate is intentionally avoided here
        # since this is a read endpoint; baseline_store already updated
        # its window during the collector tick.
        key_window = baseline_store._baselines.get((device_id, "latency_ms"))  # noqa: SLF001
        if key_window and key_window.window:
            import statistics

            history = list(key_window.window)
            median = statistics.median(history)
            latest_latency_baseline = {"median": round(median, 2), "sample_count": len(history)}

    anomaly = score_device(db, device_id)

    return {
        "device": device.to_dict(),
        "samples": [s.to_dict() for s in samples],
        "latency_baseline": latest_latency_baseline,
        "ml_anomaly": {
            "available": anomaly.available,
            "anomaly_score": anomaly.anomaly_score,
            "is_anomalous": anomaly.is_anomalous,
            "contributing_features": anomaly.contributing_features,
        },
    }
