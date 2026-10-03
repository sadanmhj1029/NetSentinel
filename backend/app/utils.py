"""Small shared helpers."""
from __future__ import annotations

import datetime as dt


def utcnow() -> dt.datetime:
    """Timezone-aware UTC now.

    Using this everywhere (instead of the deprecated, timezone-naive
    `datetime.utcnow()`) matters in practice: Postgres DateTime(timezone=True)
    columns always return timezone-aware datetimes on read, and mixing
    naive/aware datetimes raises a TypeError the moment you subtract them
    (which the incident engine does constantly for MTTR/MTTA).
    """
    return dt.datetime.now(dt.timezone.utc)
