"""
The background orchestration loop. Every `poll_interval_seconds`:

    collector.tick()  ->  incident_engine.process_tick()  ->  broadcast

running the synchronous (SQLAlchemy) pipeline in a worker thread so it
never blocks the event loop that's also serving WebSocket/API traffic.
"""
from __future__ import annotations

import asyncio
import logging

from app.config import get_settings
from app.database import SessionLocal
from app.incidents.engine import engine as incident_engine
from app.monitoring.collector import collector
from app.websocket_manager import manager

logger = logging.getLogger("netsentinel.scheduler")
settings = get_settings()

_task: asyncio.Task | None = None


def _run_tick_sync() -> dict:
    db = SessionLocal()
    try:
        collector.tick(db)
        summary = incident_engine.process_tick(db)
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
            "collector_health": collector.health.to_dict(),
        }
    except Exception:
        logger.exception("Error during scheduler tick")
        return {"type": "tick_error"}
    finally:
        db.close()


async def _loop() -> None:
    while True:
        try:
            payload = await asyncio.to_thread(_run_tick_sync)
            await manager.broadcast(payload)
        except Exception:
            logger.exception("Scheduler loop iteration failed")
        await asyncio.sleep(settings.poll_interval_seconds)


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
