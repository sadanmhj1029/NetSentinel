"""
GET /reports/summary and the handful of evaluation metrics the spec
asks for (sections 33/35). Root-cause accuracy and false-positive rate
are computed against the fault-injection history, since that is the only
source of "ground truth" a demo/hackathon system has -- a real
deployment would swap this for labeled incident outcomes.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.incident import Incident
from app.monitoring.collector import collector
from app.monitoring.simulator import simulator
from app.security import get_current_user

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 2) if values else None


@router.get("/summary")
def summary(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    incidents = db.query(Incident).all()
    resolved = [i for i in incidents if i.status == "resolved"]

    mtta_values = [
        (i.acknowledged_at - i.detected_at).total_seconds() for i in incidents if i.acknowledged_at
    ]
    mttr_values = [i.recovery_time_seconds for i in resolved if i.recovery_time_seconds is not None]

    # MTTD approximation: for each fault-injection "start" in the simulator
    # history, find the earliest incident whose root cause device matches
    # the injected target and whose detection happened after injection.
    history = simulator.get_history()
    mttd_values: list[float] = []
    root_cause_hits = 0
    root_cause_attempts = 0
    for entry in history:
        if entry["action"] != "start" or entry["scenario"] in ("normal", "recovery", "collector_failure"):
            continue
        injected_at = dt.datetime.fromisoformat(entry["timestamp"])
        target = entry.get("target")
        candidates = [
            i
            for i in incidents
            if i.detected_at and i.detected_at >= injected_at and (i.detected_at - injected_at).total_seconds() < 120
        ]
        if not candidates:
            continue
        candidates.sort(key=lambda i: i.detected_at)
        first = candidates[0]
        mttd_values.append((first.detected_at - injected_at).total_seconds())
        if target:
            root_cause_attempts += 1
            if first.probable_root_cause_device_id == target:
                root_cause_hits += 1

    severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for i in incidents:
        severity_counts[i.severity] = severity_counts.get(i.severity, 0) + 1

    low_confidence_incidents = [i for i in incidents if i.root_cause_confidence_label == "low"]

    return {
        "network_health": {
            "total_devices": None,  # filled in by the dashboard call combining /devices
        },
        "incidents": {
            "total": len(incidents),
            "resolved": len(resolved),
            "active": len(incidents) - len(resolved),
            "by_severity": severity_counts,
        },
        "mttd_seconds": _avg(mttd_values),
        "mtta_seconds": _avg(mtta_values),
        "mttr_seconds": _avg(mttr_values),
        "root_cause_accuracy_pct": (
            round(100 * root_cause_hits / root_cause_attempts, 1) if root_cause_attempts else None
        ),
        "false_positive_rate_pct": (
            round(100 * len(low_confidence_incidents) / len(incidents), 1) if incidents else 0.0
        ),
        "collector_reliability": collector.health.to_dict(),
        "notes": (
            "root_cause_accuracy_pct and mttd_seconds are computed against this session's "
            "fault-injection history (ground truth from the Fault-Injection Lab), since that is "
            "the only labeled data a demo environment has. false_positive_rate_pct approximates "
            "false positives as incidents whose final root-cause confidence stayed 'low'."
        ),
    }
