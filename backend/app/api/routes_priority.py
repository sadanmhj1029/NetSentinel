from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.incidents.priority import compute_priorities
from app.monitoring.collector import collector
from app.security import get_current_user

router = APIRouter(prefix="/api/priority", tags=["priority"])


@router.get("")
def get_priorities(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    """Faulty devices ranked by which one to fix first, each with a
    plain-language description of its problem and a score breakdown."""
    return compute_priorities(db, collector_healthy=collector.health.is_healthy)
