from __future__ import annotations

import datetime as dt

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils import utcnow


class MaintenanceWindow(Base):
    """Planned work on a device: while a window is active, faults on that
    device (and on devices behind it in the topology) are still recorded as
    events, but they don't open incidents, alerts or fix-priority entries.

    A separate table rather than a column on `devices` so existing databases
    pick it up through create_all without a migration.
    """

    __tablename__ = "maintenance_windows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"), index=True)
    reason: Mapped[str] = mapped_column(String(255), default="Planned maintenance")
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    ended_early_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def effective_end(self) -> dt.datetime:
        return self.ended_early_at or self.ends_at

    def is_active(self, now: dt.datetime | None = None) -> bool:
        now = now or utcnow()
        return self.starts_at <= now < self.effective_end()

    def to_dict(self, now: dt.datetime | None = None) -> dict:
        now = now or utcnow()
        end = self.effective_end()
        return {
            "id": self.id,
            "device_id": self.device_id,
            "reason": self.reason,
            "starts_at": self.starts_at.isoformat(),
            "ends_at": end.isoformat(),
            "created_by": self.created_by,
            "ended_early": self.ended_early_at is not None,
            "active": self.is_active(now),
            "seconds_left": max(0, int((end - now).total_seconds())) if self.is_active(now) else 0,
        }
