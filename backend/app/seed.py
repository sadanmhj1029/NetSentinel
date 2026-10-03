"""
Seed data so the dashboard looks meaningful immediately after startup
(spec section 37) instead of showing an empty shell until the collector
has been running for a while.

Run automatically on backend startup (app/main.py) when the devices table
is empty. Can also be run standalone: `python -m app.seed`.
"""
from __future__ import annotations

import datetime as dt
import random

from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, init_db
from app.models.device import Device
from app.models.interface import Interface
from app.models.metric import MetricSample
from app.utils import utcnow
from app.models.topology import TopologyLink
from app.models.user import User
from app.monitoring.simulator import simulator
from app.monitoring.topology_config import DEVICES, LINKS
from app.security import hash_password

settings = get_settings()


def seed_devices_and_topology(db: Session) -> None:
    if db.query(Device).count() > 0:
        return

    for device_id, cfg in DEVICES.items():
        db.add(
            Device(
                device_id=device_id,
                hostname=cfg["hostname"],
                ip_address=cfg["ip_address"],
                device_type=cfg["device_type"],
                vendor=cfg["vendor"],
                site=cfg["site"],
                department=cfg["department"],
                status="unknown",
                monitoring_method="simulated",
            )
        )
        db.add(
            Interface(
                device_id=device_id,
                name="eth0",
                capacity_mbps=cfg["capacity_mbps"],
                state="up",
            )
        )
    db.flush()

    for parent, child in LINKS:
        db.add(
            TopologyLink(
                source_device_id=parent,
                destination_device_id=child,
                link_type="ethernet",
                dependency_direction="parent_to_child",
            )
        )
    db.commit()


def seed_users(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    demo_users = [
        ("admin", settings.demo_admin_password, "admin"),
        ("operator", settings.demo_operator_password, "operator"),
        ("viewer", settings.demo_viewer_password, "viewer"),
    ]
    for username, password, role in demo_users:
        db.add(User(username=username, hashed_password=hash_password(password), role=role))
    db.commit()


def backfill_history(db: Session, minutes: int = 45, interval_seconds: int = 5) -> None:
    """Generate `minutes` of normal historical telemetry so the adaptive
    baseline and the ML model both have real data to learn from the
    moment the backend starts, instead of an empty history.
    """
    if db.query(MetricSample).count() > 0:
        return

    now = utcnow()
    start = now - dt.timedelta(minutes=minutes)
    device_ids = list(DEVICES.keys())

    t = start
    batch: list[MetricSample] = []
    while t < now:
        for device_id in device_ids:
            raw = simulator.sample(device_id, t)
            batch.append(
                MetricSample(
                    device_id=device_id,
                    timestamp=t,
                    reachable=raw["reachable"],
                    latency_ms=raw["latency_ms"],
                    packet_loss_pct=raw["packet_loss_pct"],
                    cpu_pct=raw["cpu_pct"],
                    memory_pct=raw["memory_pct"],
                    bandwidth_in_mbps=raw["bandwidth_in_mbps"],
                    bandwidth_out_mbps=raw["bandwidth_out_mbps"],
                    interface_errors=0,
                    is_stale=False,
                    is_valid=True,
                    collector_healthy=True,
                )
            )
        t += dt.timedelta(seconds=interval_seconds)

    db.bulk_save_objects(batch)
    db.commit()

    for device in db.query(Device).all():
        device.status = "online"
        device.last_seen_at = now
    db.commit()


def run_all() -> None:
    init_db()
    db = SessionLocal()
    try:
        seed_devices_and_topology(db)
        seed_users(db)
        backfill_history(db)
    finally:
        db.close()


if __name__ == "__main__":
    run_all()
    print("Seed complete.")
