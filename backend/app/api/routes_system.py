"""
Health and status endpoints.

    GET /health, /api/health   liveness: the process is up (no auth, cheap)
    GET /api/health/ready      readiness: database answers and the monitoring
                               loop is ticking; 503 otherwise (no auth, used
                               by Docker's healthcheck)
    GET /api/system/status     everything above plus counts and pipeline
                               stats, for the Settings page (any signed-in user)
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, get_db
from app.ml.model_store import model_store
from app.models.device import Device
from app.models.incident import Incident
from app.models.metric import MetricSample
from app.monitoring.collector import collector
from app.security import get_current_user
from app.services.heartbeat import heartbeat
from app.services.login_guard import login_guard
from app.services.maintenance import active_windows
from app.websocket_manager import manager

router = APIRouter(tags=["system"])
settings = get_settings()
VERSION = "1.1.0"


def _check_database() -> dict:
    t0 = time.perf_counter()
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"ok": True, "latency_ms": round((time.perf_counter() - t0) * 1000, 1)}
    except Exception as exc:  # noqa: BLE001  (report, don't crash the health check)
        return {"ok": False, "error": str(exc).splitlines()[0][:200]}
    finally:
        db.close()


def _check_scheduler() -> dict:
    since = heartbeat.seconds_since_tick()
    # Allow a few missed ticks, and some grace right after startup.
    limit = max(15.0, settings.poll_interval_seconds * 5)
    if since is None:
        uptime = heartbeat.to_dict()["uptime_seconds"]
        ok = uptime < 60
        return {"ok": ok, "detail": "waiting for first tick" if ok else "no tick since startup"}
    ok = since <= limit and heartbeat.consecutive_errors < 5
    detail = f"last tick {since:.0f}s ago"
    if heartbeat.consecutive_errors:
        detail += f", {heartbeat.consecutive_errors} failing in a row"
    return {"ok": ok, "detail": detail}


@router.get("/health")
@router.get("/api/health")
def health():
    return {"status": "ok", "service": "netsentinel-backend", "version": VERSION}


@router.get("/api/health/ready")
def ready():
    checks = {"database": _check_database(), "scheduler": _check_scheduler()}
    ok = all(c["ok"] for c in checks.values())
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ready" if ok else "not_ready", "checks": checks})


@router.get("/api/system/status")
def system_status(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    checks = {"database": _check_database(), "scheduler": _check_scheduler()}
    ml = model_store.metadata
    return {
        "version": VERSION,
        "ready": all(c["ok"] for c in checks.values()),
        "checks": checks,
        "pipeline": heartbeat.to_dict(),
        "collector": collector.health.to_dict(),
        "counts": {
            "devices": db.query(func.count(Device.device_id)).scalar() or 0,
            "metric_samples": db.query(func.count(MetricSample.id)).scalar() or 0,
            "open_incidents": db.query(func.count(Incident.incident_id)).filter(Incident.status != "resolved").scalar() or 0,
            "maintenance_active": len(active_windows(db)),
            "live_clients": manager.client_count,
            "login_lockouts": login_guard.active_lockouts(),
        },
        "ml": {"status": ml.status, "enabled": ml.enabled, "trained_at": getattr(ml, "trained_at", None)},
        "settings": {
            "poll_interval_seconds": settings.poll_interval_seconds,
            "metric_retention_hours": settings.metric_retention_hours,
            "login_max_attempts": settings.login_max_attempts,
            "login_lockout_seconds": settings.login_lockout_seconds,
        },
    }
