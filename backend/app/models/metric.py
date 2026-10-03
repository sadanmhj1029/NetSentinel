from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MetricSample(Base):
    """One polled observation for one device at one point in time.

    This is intentionally a single wide row rather than a narrow
    metric-name/value table -- at hackathon/demo volume it is simpler to
    reason about and query, and it maps directly onto the spec's metric
    list. In production this table is the natural candidate for a
    TimescaleDB hypertable (see docs/ARCHITECTURE.md).
    """

    __tablename__ = "metric_samples"
    __table_args__ = (Index("ix_metric_samples_device_ts", "device_id", "timestamp"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"))
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))

    reachable: Mapped[bool] = mapped_column(Boolean, default=True)
    latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    bandwidth_in_mbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    bandwidth_out_mbps: Mapped[float | None] = mapped_column(Float, nullable=True)
    interface_errors: Mapped[int] = mapped_column(Integer, default=0)

    # Data-quality metadata -- required by spec section 7/8: a collector
    # outage must be visible and distinguishable from a device outage.
    is_stale: Mapped[bool] = mapped_column(Boolean, default=False)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    collector_healthy: Mapped[bool] = mapped_column(Boolean, default=True)
    validation_notes: Mapped[str | None] = mapped_column(String(256), nullable=True)

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "timestamp": self.timestamp.isoformat(),
            "reachable": self.reachable,
            "latency_ms": self.latency_ms,
            "packet_loss_pct": self.packet_loss_pct,
            "cpu_pct": self.cpu_pct,
            "memory_pct": self.memory_pct,
            "bandwidth_in_mbps": self.bandwidth_in_mbps,
            "bandwidth_out_mbps": self.bandwidth_out_mbps,
            "interface_errors": self.interface_errors,
            "is_stale": self.is_stale,
            "is_valid": self.is_valid,
            "collector_healthy": self.collector_healthy,
        }
