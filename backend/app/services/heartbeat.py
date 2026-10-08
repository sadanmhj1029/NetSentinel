"""
Scheduler heartbeat: when did the monitoring loop last run, how long did
it take, and is it failing?

The readiness check and the Settings "System status" card both read this,
so a stuck or crashing pipeline is visible instead of silently freezing
the dashboard on old data.
"""
from __future__ import annotations

import datetime as dt
import threading
from dataclasses import dataclass, field

from app.utils import utcnow


@dataclass
class Heartbeat:
    started_at: dt.datetime = field(default_factory=utcnow)
    last_tick_at: dt.datetime | None = None
    last_tick_ms: float | None = None
    last_error: str | None = None
    last_error_at: dt.datetime | None = None
    consecutive_errors: int = 0
    total_ticks: int = 0
    total_errors: int = 0
    last_prune_at: dt.datetime | None = None
    last_prune_deleted: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def ok(self, duration_ms: float) -> None:
        with self._lock:
            self.last_tick_at = utcnow()
            self.last_tick_ms = round(duration_ms, 1)
            self.consecutive_errors = 0
            self.total_ticks += 1

    def error(self, message: str) -> None:
        with self._lock:
            self.last_error = message[:500]
            self.last_error_at = utcnow()
            self.consecutive_errors += 1
            self.total_errors += 1

    def pruned(self, deleted: int) -> None:
        with self._lock:
            self.last_prune_at = utcnow()
            self.last_prune_deleted = deleted

    def seconds_since_tick(self, now: dt.datetime | None = None) -> float | None:
        if self.last_tick_at is None:
            return None
        return ((now or utcnow()) - self.last_tick_at).total_seconds()

    def to_dict(self) -> dict:
        iso = lambda d: d.isoformat() if d else None  # noqa: E731
        return {
            "started_at": iso(self.started_at),
            "uptime_seconds": round((utcnow() - self.started_at).total_seconds()),
            "last_tick_at": iso(self.last_tick_at),
            "seconds_since_tick": (round(s, 1) if (s := self.seconds_since_tick()) is not None else None),
            "last_tick_ms": self.last_tick_ms,
            "consecutive_errors": self.consecutive_errors,
            "total_ticks": self.total_ticks,
            "total_errors": self.total_errors,
            "last_error": self.last_error,
            "last_error_at": iso(self.last_error_at),
            "last_prune_at": iso(self.last_prune_at),
            "last_prune_deleted": self.last_prune_deleted,
        }

    def reset(self) -> None:
        fresh = Heartbeat()
        with self._lock:
            for name in ("started_at", "last_tick_at", "last_tick_ms", "last_error", "last_error_at",
                         "consecutive_errors", "total_ticks", "total_errors", "last_prune_at", "last_prune_deleted"):
                setattr(self, name, getattr(fresh, name))


heartbeat = Heartbeat()
