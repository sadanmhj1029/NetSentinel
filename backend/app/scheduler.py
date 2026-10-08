"""
The background orchestration loop. Every `poll_interval_seconds`:

    collector.tick()  ->  incident_engine.process_tick()  ->  broadcast

running the synchronous (SQLAlchemy) pipeline in a worker thread so it
never blocks the event loop that's also serving WebSocket/API traffic.
"""
from __future__ import annotations

import asyncio
import logging
import time

from app.config import get_settings
from app.database import SessionLocal
from app.incidents.engine import engine as incident_engine
from app.monitoring.collector import collector
from app.services.heartbeat import heartbeat
from app.services.retention import prune_metrics
from app.websocket_manager import manager

logger = logging.getLogger("netsentinel.scheduler")
settings = get_settings()

_task: asyncio.Task | None = None
_last_prune = 0.0
MAX_BACKOFF_SECONDS = 30.0


def _maybe_prune(db) -> None:
    """Retention runs inside the tick thread every few minutes."""
    global _last_prune
    now = time.monotonic()
    if now - _last_prune < settings.retention_check_minutes * 60:
        return
    _last_prune = now
    try:
        heartbeat.pruned(prune_metrics(db))
    except Exception:
        db.rollback()
        logger.exception("Metric retention failed (will retry later)")


def _run_tick_sync() -> dict:
    db = SessionLocal()
    t0 = time.perf_counter()
    try:
        collector.tick(db)
        summary = incident_engine.process_tick(db)
        heartbeat.ok((time.perf_counter() - t0) * 1000)
        _maybe_prune(db)
        return {
            "type": "tick",
            "timestamp": summary.timestamp,
            "collector_healthy": summary.collector_healthy,
            "device_status": summary.device_status,
            "opened_events": summary.opened_events,
            "recovered_events": summary.recovered_events,
            "incidents_created": [i["incident_id"] for i in summary.incidents_created],
            "incidents_updated": [i["incident_id"] for i in summary.incidents_updated],
            "incidents_resolved": [i["incident_id"] for i in summary.incidents_resolved],
            "incidents_created_detail": [
                {
                    "incident_id": i["incident_id"],
                    "title": i.get("title"),
                    "severity": i.get("severity"),
                    "root_cause": i.get("probable_root_cause_device_id"),
                }
                for i in summary.incidents_created
            ],
            "in_maintenance": summary.suppressed_devices,
            "collector_health": collector.health.to_dict(),
        }
    except Exception as exc:
        db.rollback()
        heartbeat.error(f"{type(exc).__name__}: {exc}")
        # Log the full traceback once, then one line per repeat, so a database
        # outage doesn't flood the logs every two seconds.
        if heartbeat.consecutive_errors == 1:
            logger.exception("Error during scheduler tick")
        else:
            logger.warning("Scheduler tick still failing (%d in a row): %s", heartbeat.consecutive_errors, exc)
        return {"type": "tick_error", "consecutive_errors": heartbeat.consecutive_errors}
    finally:
        db.close()


async def _loop() -> None:
    while True:
        try:
            payload = await asyncio.to_thread(_run_tick_sync)
            await manager.broadcast(payload)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduler loop iteration failed")
        # Back off while ticks keep failing (e.g. database restarting), then
        # snap back to the normal interval on the first good tick.
        delay = settings.poll_interval_seconds
        if heartbeat.consecutive_errors:
            delay = min(MAX_BACKOFF_SECONDS, delay * 2 ** min(heartbeat.consecutive_errors, 4))
        await asyncio.sleep(delay)


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())
        logger.info("Monitoring scheduler started (interval=%ss)", settings.poll_interval_seconds)


def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        _task = None
