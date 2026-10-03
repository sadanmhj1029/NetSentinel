"""
Inference: score the most recent window for one device.

Explainability (spec section 11 "Explainability"): alongside the raw
anomaly score we report which features deviated most from the training
population's typical values, in plain language, so the incident evidence
panel can show *why* the model flagged something instead of just a bare
number.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.ml.features import FEATURE_COLUMNS, build_feature_matrix
from app.ml.model_store import model_store
from app.models.metric import MetricSample

RECENT_WINDOW = 10


@dataclass
class AnomalyResult:
    available: bool
    anomaly_score: float = 0.0  # 0-100, higher = more anomalous
    is_anomalous: bool = False
    threshold: float = 0.0
    contributing_features: list[dict] | None = None
    reason: str | None = None


def score_device(db: Session, device_id: str) -> AnomalyResult:
    if not model_store.is_ready():
        return AnomalyResult(available=False, reason="ML model not trained or disabled")

    rows = (
        db.query(MetricSample)
        .filter(MetricSample.device_id == device_id, MetricSample.is_valid.is_(True))
        .order_by(MetricSample.timestamp.desc())
        .limit(RECENT_WINDOW)
        .all()
    )
    if not rows:
        return AnomalyResult(available=False, reason="No recent samples for this device")

    rows = [r.to_dict() for r in reversed(rows)]
    df = build_feature_matrix(rows)
    if df.empty:
        return AnomalyResult(available=False, reason="Device unreachable or missing core metrics")

    latest = df.iloc[[-1]]
    model, scaler = model_store.load()
    if model is None:
        return AnomalyResult(available=False, reason="ML model artifact missing")

    X = latest[FEATURE_COLUMNS].to_numpy()
    X_scaled = scaler.transform(X)
    raw_score = float(-model.decision_function(X_scaled)[0])
    threshold = model_store.metadata.anomaly_score_threshold

    # Rescale raw_score to a friendlier 0-100 range using the trained
    # threshold as the "50" midpoint, clipped to [0, 100].
    normalized = 50.0 * (raw_score / threshold) if threshold else 0.0
    normalized = max(0.0, min(100.0, normalized))

    contributing = _explain(latest.iloc[0], scaler)

    return AnomalyResult(
        available=True,
        anomaly_score=round(normalized, 1),
        is_anomalous=raw_score >= threshold,
        threshold=round(threshold, 4),
        contributing_features=contributing,
    )


def _explain(row, scaler) -> list[dict]:
    """Which features are furthest (in scaled units) from the training
    center -- a cheap, honest stand-in for full SHAP-style explanations
    that's good enough to point a human at the right metric."""
    center = scaler.center_
    scale = scaler.scale_
    contributions = []
    for i, feature in enumerate(FEATURE_COLUMNS):
        value = row[feature]
        denom = scale[i] if scale[i] else 1.0
        deviation = abs((value - center[i]) / denom)
        contributions.append({"feature": feature, "value": round(float(value), 2), "deviation": round(float(deviation), 2)})
    contributions.sort(key=lambda c: c["deviation"], reverse=True)
    return contributions[:4]
