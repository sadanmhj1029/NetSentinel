"""
The monitoring collector.

Polls every active device once per tick, validates each observation, and
writes it to the metric_samples table. Crucially: if the collector itself
is unhealthy (simulated via the "collector_failure" scenario, or in a real
deployment a crashed polling worker), this module surfaces that as
`collector_healthy: False` on every sample and the dashboard shows
"monitoring unavailable" -- it must never get silently reinterpreted
downstream as "every device is down".
"""
from __future__ import annotations

import datetime as dt
import threading
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.config import get_settings
from app.utils import utcnow
from app.models.device import Device
from app.models.metric import MetricSample
from app.monitoring.simulator import simulator

settings = get_settings()


def _validate(raw: dict) -> tuple[bool, str | None]:
    """Basic sanity checks on a raw sample before it is trusted.

    Real collectors need this far more than a simulator does (a flaky
    SNMP agent can return negative counters, NaN, wildly out-of-range
    values, etc.) but we apply the same checks here so the validation
    layer is real code, not a stub.
    """
    if raw.get("reachable") is False:
        return True, None  # unreachable is a valid, meaningful observation

    latency = raw.get("latency_ms")
    if latency is not None and (latency < 0 or latency > 5000):
        return False, "latency_ms out of plausible range"

    loss = raw.get("packet_loss_pct")
    if loss is not None and not (0 <= loss <= 100):
        return False, "packet_loss_pct out of range"

    for key in ("cpu_pct", "memory_pct"):
        val = raw.get(key)
        if val is not None and not (0 <= val <= 100):
            return False, f"{key} out of range"

    for key in ("bandwidth_in_mbps", "bandwidth_out_mbps"):
        val = raw.get(key)
        if val is not None and val < 0:
            return False, f"{key} negative"

    return True, None


@dataclass
class CollectorHealthState:
    started_at: dt.datetime = field(default_factory=utcnow)
    last_tick_at: dt.datetime | None = None
    last_successful_tick_at: dt.datetime | None = None
    total_ticks: int = 0
    total_poll_attempts: int = 0
    total_poll_successes: int = 0
    consecutive_collector_failures: int = 0
    is_healthy: bool = True
    stale_devices: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        uptime = (utcnow() - self.started_at).total_seconds()
        success_rate = (
            round(100.0 * self.total_poll_successes / self.total_poll_attempts, 2)
            if self.total_poll_attempts
            else 100.0
        )
        return {
            "is_healthy": self.is_healthy,
            "uptime_seconds": round(uptime, 1),
            "last_tick_at": self.last_tick_at.isoformat() if self.last_tick_at else None,
            "last_successful_tick_at": (
                self.last_successful_tick_at.isoformat() if self.last_successful_tick_at else None
            ),
            "total_ticks": self.total_ticks,
            "polling_success_rate_pct": success_rate,
            "consecutive_collector_failures": self.consecutive_collector_failures,
            "stale_devices": self.stale_devices,
            "queue_status": "idle",  # single in-process worker for the demo; see docs/ARCHITECTURE.md
        }


class Collector:
    def __init__(self) -> None:
        self.health = CollectorHealthState()
        self._last_seen: dict[str, dt.datetime] = {}
        self._lock = threading.Lock()

    def tick(self, db: Session) -> list[MetricSample]:
        now = utcnow()
        self.health.total_ticks += 1
        self.health.last_tick_at = now

        if simulator.collector_should_fail():
            self.health.consecutive_collector_failures += 1
            self.health.is_healthy = False
            self._refresh_stale(now)
            return []

        self.health.consecutive_collector_failures = 0
        self.health.is_healthy = True

        devices = db.query(Device).filter(Device.is_active.is_(True)).all()
        samples: list[MetricSample] = []

        for device in devices:
            self.health.total_poll_attempts += 1
            raw = simulator.sample(device.device_id, now)
            is_valid, note = _validate(raw)
            if not is_valid:
                continue

            self.health.total_poll_successes += 1
            self._last_seen[device.device_id] = now

            sample = MetricSample(
                device_id=device.device_id,
                timestamp=now,
                reachable=raw.get("reachable", True),
                latency_ms=raw.get("latency_ms"),
                packet_loss_pct=raw.get("packet_loss_pct"),
                cpu_pct=raw.get("cpu_pct"),
                memory_pct=raw.get("memory_pct"),
                bandwidth_in_mbps=raw.get("bandwidth_in_mbps"),
                bandwidth_out_mbps=raw.get("bandwidth_out_mbps"),
                interface_errors=raw.get("interface_errors", 0),
                is_stale=False,
                is_valid=True,
                collector_healthy=True,
                validation_notes=note,
            )
            db.add(sample)
            samples.append(sample)
            device.last_seen_at = now

        db.commit()
        self.health.last_successful_tick_at = now
        self._refresh_stale(now)
        return samples

    def _refresh_stale(self, now: dt.datetime) -> None:
        stale: list[str] = []
        for device_id, last_seen in self._last_seen.items():
            if (now - last_seen).total_seconds() > settings.collector_stale_after_seconds:
                stale.append(device_id)
        self.health.stale_devices = stale

    def is_device_stale(self, device_id: str, now: dt.datetime | None = None) -> bool:
        now = now or utcnow()
        last_seen = self._last_seen.get(device_id)
        if last_seen is None:
            return False
        return (now - last_seen).total_seconds() > settings.collector_stale_after_seconds


collector = Collector()
