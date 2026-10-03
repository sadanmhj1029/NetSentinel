"""Request bodies. Responses are returned as plain dicts via each model's
`to_dict()` -- fine for a prototype of this size, and it keeps the FastAPI
Swagger docs (spec section 28) focused on what actually varies: inputs.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class DeviceCreate(BaseModel):
    device_id: str
    hostname: str
    ip_address: str
    device_type: str = "pc"
    vendor: str = "Generic"
    site: str = "HQ"
    department: str = "IT"
    monitoring_method: str = "simulated"


class DeviceUpdate(BaseModel):
    hostname: str | None = None
    ip_address: str | None = None
    device_type: str | None = None
    vendor: str | None = None
    site: str | None = None
    department: str | None = None
    monitoring_method: str | None = None
    is_active: bool | None = None
    latency_threshold_ms: float | None = None
    packet_loss_threshold_pct: float | None = None
    cpu_threshold_pct: float | None = None
    memory_threshold_pct: float | None = None


class ScenarioStart(BaseModel):
    target: str | None = Field(default=None, description="Device id to target; defaults to a sensible choice per scenario")


class AcknowledgeRequest(BaseModel):
    note: str | None = None


class OperatorNote(BaseModel):
    note: str


class ResolveRequest(BaseModel):
    resolution: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "viewer"


class TopologyLinkCreate(BaseModel):
    source_device_id: str
    destination_device_id: str
    link_type: str = "ethernet"
