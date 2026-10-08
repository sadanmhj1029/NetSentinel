"""
Data retention: raw metric samples pile up fast (8 devices x one sample
every 2s is ~350k rows a day). Left alone, the database grows forever and
every query that scans recent history slowly gets slower. Samples older
than `metric_retention_hours` are deleted in small batches; incidents,
events and the audit log are kept, since they're the actual history.
"""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.metric import MetricSample
from app.utils import utcnow

logger = logging.getLogger("netsentinel.retention")
settings = get_settings()

BATCH = 5000


def prune_metrics(db: Session, now: dt.datetime | None = None, retention_hours: float | None = None) -> int:
    hours = settings.metric_retention_hours if retention_hours is None else retention_hours
    if hours <= 0:
        return 0  # retention disabled
    cutoff = (now or utcnow()) - dt.timedelta(hours=hours)
    total = 0
    while True:
        ids = db.execute(
            select(MetricSample.id).where(MetricSample.timestamp < cutoff).limit(BATCH)
        ).scalars().all()
        if not ids:
            break
        db.execute(delete(MetricSample).where(MetricSample.id.in_(ids)))
        db.commit()
        total += len(ids)
        if len(ids) < BATCH:
            break
    if total:
        logger.info("Pruned %d metric samples older than %.0fh", total, hours)
    return total
