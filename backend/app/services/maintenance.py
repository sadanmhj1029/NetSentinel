"""Which devices are in planned maintenance right now (directly, or because
a device in front of them is)."""
from __future__ import annotations

import datetime as dt

import networkx as nx
from sqlalchemy.orm import Session

from app.correlation.topology_graph import descendants
from app.models.maintenance import MaintenanceWindow
from app.utils import utcnow


def active_windows(db: Session, now: dt.datetime | None = None) -> list[MaintenanceWindow]:
    now = now or utcnow()
    rows = (
        db.query(MaintenanceWindow)
        .filter(MaintenanceWindow.starts_at <= now, MaintenanceWindow.ends_at > now)
        .all()
    )
    return [w for w in rows if w.is_active(now)]


def suppressed_devices(db: Session, graph: nx.DiGraph | None = None, now: dt.datetime | None = None) -> dict[str, str]:
    """device_id -> the device whose maintenance covers it. Taking a switch
    down for work knocks out everything behind it, so those are covered too."""
    covered: dict[str, str] = {}
    for w in active_windows(db, now):
        covered[w.device_id] = w.device_id
        if graph is not None:
            for child in descendants(graph, w.device_id):
                covered.setdefault(child, w.device_id)
    return covered
