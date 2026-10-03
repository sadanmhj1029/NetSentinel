from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.monitoring.simulator import SCENARIOS, simulator
from app.schemas import ScenarioStart
from app.security import require_role
from app.services import audit

router = APIRouter(prefix="/api/scenarios", tags=["scenarios"])


@router.get("")
def list_scenarios():
    state = simulator.get_state()
    return {
        "scenarios": [{"id": k, "description": v} for k, v in SCENARIOS.items()],
        "state": state,
    }


@router.post("/{scenario_id}/start")
def start_scenario(
    scenario_id: str, body: ScenarioStart, db: Session = Depends(get_db), user=Depends(require_role("operator"))
):
    try:
        result = simulator.start_scenario(scenario_id, body.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(db, user.username, "scenario_started", resource=scenario_id, new_state=result)
    return result


@router.post("/{scenario_id}/stop")
def stop_scenario(scenario_id: str, db: Session = Depends(get_db), user=Depends(require_role("operator"))):
    try:
        result = simulator.stop_scenario(scenario_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(db, user.username, "scenario_stopped", resource=scenario_id, new_state=result)
    return result
