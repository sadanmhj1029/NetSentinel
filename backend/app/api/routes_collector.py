from __future__ import annotations

from fastapi import APIRouter, Depends

from app.monitoring.collector import collector
from app.security import get_current_user

router = APIRouter(prefix="/api/collector", tags=["collector"])


@router.get("/health")
def collector_health(_user=Depends(get_current_user)):
    return collector.health.to_dict()
