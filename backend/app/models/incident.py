from __future__ import annotations

import datetime as dt

from sqlalchemy import JSON, Boolean, DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils import utcnow


class Incident(Base):
    """A grouped, evidence-backed story: 'Switch-02 Network Failure',
    not four separate device-down alerts.
    """

    __tablename__ = "incidents"

    incident_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # e.g. INC-0001
    title: Mapped[str] = mapped_column(String(256))
    severity: Mapped[str] = mapped_column(String(16))  # critical|high|medium|low
    status: Mapped[str] = mapped_column(String(32), default="detected")
    # detected -> investigating -> acknowledged -> recovering -> resolved

    probable_root_cause_device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    root_cause_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    root_cause_confidence_label: Mapped[str] = mapped_column(String(16), default="low")  # low|medium|high
    root_cause_score_breakdown: Mapped[dict] = mapped_column(JSON, default=dict)
    ranked_candidates: Mapped[list] = mapped_column(JSON, default=list)

    affected_devices: Mapped[list] = mapped_column(JSON, default=list)
    affected_services: Mapped[list] = mapped_column(JSON, default=list)
    blast_radius: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    diagnosis_text: Mapped[str] = mapped_column(String(2048), default="")
    recommended_checks: Mapped[list] = mapped_column(JSON, default=list)
    child_event_ids: Mapped[list] = mapped_column(JSON, default=list)
    timeline: Mapped[list] = mapped_column(JSON, default=list)  # [{stage, timestamp}]

    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    acknowledged_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    operator_notes: Mapped[list] = mapped_column(JSON, default=list)

    resolution: Mapped[str | None] = mapped_column(String(512), nullable=True)
    recovery_evidence: Mapped[dict] = mapped_column(JSON, default=dict)
    recovery_time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    notified: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    detected_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    acknowledged_at_metric: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_dict(self) -> dict:
        return {
            "incident_id": self.incident_id,
            "title": self.title,
            "severity": self.severity,
            "status": self.status,
            "probable_root_cause_device_id": self.probable_root_cause_device_id,
            "root_cause_confidence": self.root_cause_confidence,
            "root_cause_confidence_label": self.root_cause_confidence_label,
            "root_cause_score_breakdown": self.root_cause_score_breakdown,
            "ranked_candidates": self.ranked_candidates,
            "affected_devices": self.affected_devices,
            "affected_services": self.affected_services,
            "blast_radius": self.blast_radius,
            "evidence": self.evidence,
            "diagnosis_text": self.diagnosis_text,
            "recommended_checks": self.recommended_checks,
            "child_event_ids": self.child_event_ids,
            "timeline": self.timeline,
            "acknowledged": self.acknowledged,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at": self.acknowledged_at.isoformat() if self.acknowledged_at else None,
            "operator_notes": self.operator_notes,
            "resolution": self.resolution,
            "recovery_evidence": self.recovery_evidence,
            "recovery_time_seconds": self.recovery_time_seconds,
            "notified": self.notified,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "detected_at": self.detected_at.isoformat() if self.detected_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
        }
