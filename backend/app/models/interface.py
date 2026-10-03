from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Interface(Base):
    __tablename__ = "interfaces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"))
    name: Mapped[str] = mapped_column(String(64))
    capacity_mbps: Mapped[float] = mapped_column(Float, default=1000.0)
    state: Mapped[str] = mapped_column(String(16), default="up")  # up|down|testing
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    utilization_pct: Mapped[float] = mapped_column(Float, default=0.0)
    link_peer_device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    link_peer_interface: Mapped[str | None] = mapped_column(String(64), nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "device_id": self.device_id,
            "name": self.name,
            "capacity_mbps": self.capacity_mbps,
            "state": self.state,
            "error_count": self.error_count,
            "utilization_pct": self.utilization_pct,
            "link_peer_device_id": self.link_peer_device_id,
            "link_peer_interface": self.link_peer_interface,
        }
