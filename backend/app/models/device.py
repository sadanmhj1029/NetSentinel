from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils import utcnow


class Device(Base):
    """A network device -- real or simulated.

    device_id is the human-readable key used everywhere else in the system
    (topology links, metric samples, incidents) because that is how network
    engineers actually refer to devices ("Switch-02"), and it keeps the demo
    data and the UI readable.
    """

    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    hostname: Mapped[str] = mapped_column(String(128))
    ip_address: Mapped[str] = mapped_column(String(64))
    device_type: Mapped[str] = mapped_column(String(32))  # router | switch | server | pc | service
    vendor: Mapped[str] = mapped_column(String(64), default="Generic")
    site: Mapped[str] = mapped_column(String(64), default="HQ")
    owner: Mapped[str] = mapped_column(String(64), default="network-team")
    department: Mapped[str] = mapped_column(String(64), default="IT")

    status: Mapped[str] = mapped_column(String(16), default="unknown")  # online|degraded|offline|unknown
    monitoring_method: Mapped[str] = mapped_column(String(16), default="simulated")  # simulated|icmp|snmp|rest

    # Per-device threshold overrides. Null means "use the global default".
    latency_threshold_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    packet_loss_threshold_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    cpu_threshold_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_threshold_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "hostname": self.hostname,
            "ip_address": self.ip_address,
            "device_type": self.device_type,
            "vendor": self.vendor,
            "site": self.site,
            "owner": self.owner,
            "department": self.department,
            "status": self.status,
            "monitoring_method": self.monitoring_method,
            "latency_threshold_ms": self.latency_threshold_ms,
            "packet_loss_threshold_pct": self.packet_loss_threshold_pct,
            "cpu_threshold_pct": self.cpu_threshold_pct,
            "memory_threshold_pct": self.memory_threshold_pct,
            "is_active": self.is_active,
            "last_seen_at": self.last_seen_at.isoformat() if self.last_seen_at else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
