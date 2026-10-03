from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Event(Base):
    """A single detected anomaly/fault for one device.

    Events are the atomic unit the correlation engine consumes. Many
    events (e.g. PC-03 unreachable, PC-04 unreachable, Server-01
    unreachable) get grouped under one Incident with a correlation_id.
    """

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"))
    event_type: Mapped[str] = mapped_column(String(64))
    # unreachable | packet_loss | high_latency | high_cpu | high_memory |
    # interface_down | bandwidth_saturation | baseline_anomaly | ml_anomaly
    severity: Mapped[str] = mapped_column(String(16))  # critical|high|medium|low
    timestamp: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    detection_source: Mapped[str] = mapped_column(String(16), default="rule")  # rule|baseline|ml
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    incident_id: Mapped[str | None] = mapped_column(String(64), ForeignKey("incidents.incident_id"), nullable=True)

    status: Mapped[str] = mapped_column(String(16), default="open")  # open|resolved
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "event_type": self.event_type,
            "severity": self.severity,
            "timestamp": self.timestamp.isoformat(),
            "confidence": self.confidence,
            "evidence": self.evidence,
            "detection_source": self.detection_source,
            "correlation_id": self.correlation_id,
            "incident_id": self.incident_id,
            "status": self.status,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }
