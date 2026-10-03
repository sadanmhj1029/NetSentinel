"""
Trains the Isolation Forest anomaly model on mostly-normal historical
telemetry (spec section 11). This is a supporting signal, not an oracle:
the correlation/incident engine combines its score with rule and baseline
evidence rather than acting on it alone (see app/correlation/root_cause.py).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler
from sqlalchemy.orm import Session

from app.config import get_settings
from app.ml.features import FEATURE_COLUMNS, build_feature_matrix
from app.ml.model_store import ModelMetadata, model_store
from app.models.metric import MetricSample

settings = get_settings()


class NotEnoughDataError(Exception):
    pass


def _fetch_training_rows(db: Session, limit: int = 20000) -> list[dict]:
    samples = (
        db.query(MetricSample)
        .filter(MetricSample.is_valid.is_(True))
        .order_by(MetricSample.timestamp.desc())
        .limit(limit)
        .all()
    )
    return [s.to_dict() for s in samples]


def get_training_stats(db: Session) -> dict:
    rows = _fetch_training_rows(db)
    df = build_feature_matrix(rows)
    n_devices = df["device_id"].nunique() if not df.empty else 0
    return {
        "available_samples": len(rows),
        "usable_samples": int(len(df)) if not df.empty else 0,
        "n_devices": int(n_devices),
        "features": FEATURE_COLUMNS,
        "min_required_samples": settings.ml_min_training_samples,
        "ready_to_train": (not df.empty) and len(df) >= settings.ml_min_training_samples,
    }


def train_model(db: Session) -> ModelMetadata:
    model_store.mark_training()
    rows = _fetch_training_rows(db)
    df = build_feature_matrix(rows)

    if df.empty or len(df) < settings.ml_min_training_samples:
        err = (
            f"Not enough usable samples to train: have {len(df)}, "
            f"need at least {settings.ml_min_training_samples}."
        )
        model_store.mark_failed(err)
        raise NotEnoughDataError(err)

    X = df[FEATURE_COLUMNS].to_numpy()
    scaler = RobustScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=150,
        contamination=settings.ml_anomaly_contamination,
        random_state=42,
    )
    model.fit(X_scaled)

    # decision_function: lower (more negative) = more anomalous.
    # Flip sign so "higher = more anomalous" and rescale to roughly 0-100
    # for a UI-friendly anomaly score.
    raw_scores = -model.decision_function(X_scaled)
    threshold = float(np.percentile(raw_scores, 100 * (1 - settings.ml_anomaly_contamination)))

    predictions = model.predict(X_scaled)  # -1 anomaly, 1 normal
    flagged = int((predictions == -1).sum())

    metadata = ModelMetadata(
        n_samples=len(df),
        n_devices=int(df["device_id"].nunique()),
        features=FEATURE_COLUMNS,
        contamination=settings.ml_anomaly_contamination,
        anomaly_score_threshold=threshold,
        evaluation={
            "training_samples": len(df),
            "flagged_as_anomalous_during_training": flagged,
            "flagged_pct": round(100 * flagged / len(df), 2),
            "note": (
                "Trained on mostly-normal simulated telemetry. Precision/recall/F1 "
                "become available once labeled anomaly data is collected from real "
                "fault-injection runs -- see GET /api/reports/summary."
            ),
        },
    )
    model_store.save(model, scaler, metadata)
    return metadata
