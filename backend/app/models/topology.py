from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TopologyLink(Base):
    """A directed dependency edge in the network graph.

    dependency_direction is always stored as "parent_to_child": the source
    device is the one whose failure can plausibly cause the destination
    device to look unhealthy (e.g. Switch-02 -> PC-03). The correlation
    engine walks this graph to find common ancestors of a set of failures.
    """

    __tablename__ = "topology_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"))
    source_interface: Mapped[str | None] = mapped_column(String(64), nullable=True)
    destination_device_id: Mapped[str] = mapped_column(String(64), ForeignKey("devices.device_id"))
    destination_interface: Mapped[str | None] = mapped_column(String(64), nullable=True)
    link_type: Mapped[str] = mapped_column(String(32), default="ethernet")  # ethernet|service|vpn|wifi
    dependency_direction: Mapped[str] = mapped_column(String(32), default="parent_to_child")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "source_device_id": self.source_device_id,
            "source_interface": self.source_interface,
            "destination_device_id": self.destination_device_id,
            "destination_interface": self.destination_interface,
            "link_type": self.link_type,
            "dependency_direction": self.dependency_direction,
        }
