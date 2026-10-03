from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.ml.model_store import model_store
from app.ml.train import NotEnoughDataError, get_training_stats, train_model
from app.security import get_current_user, require_role
from app.services import audit

router = APIRouter(prefix="/api/ml", tags=["ml"])


@router.get("/status")
def status(db: Session = Depends(get_db), _user=Depends(get_current_user)):
    meta = model_store.metadata
    stats = get_training_stats(db)
    return {
        "status": meta.status,
        "enabled": meta.enabled,
        "version": meta.version,
        "trained_at": meta.trained_at,
        "n_samples": meta.n_samples,
        "n_devices": meta.n_devices,
        "features": meta.features,
        "contamination": meta.contamination,
        "anomaly_score_threshold": meta.anomaly_score_threshold,
        "evaluation": meta.evaluation,
        "last_error": meta.last_error,
        "training_data": stats,
    }


@router.post("/train")
def train(db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    try:
        meta = train_model(db)
    except NotEnoughDataError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    audit.record(db, user.username, "ml_training", new_state={"version": meta.version, "n_samples": meta.n_samples})
    return {"status": "trained", "version": meta.version, "n_samples": meta.n_samples}


@router.post("/enable")
def enable(db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    model_store.set_enabled(True)
    audit.record(db, user.username, "ml_enabled")
    return {"enabled": True}


@router.post("/disable")
def disable(db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    model_store.set_enabled(False)
    audit.record(db, user.username, "ml_disabled")
    return {"enabled": False}
