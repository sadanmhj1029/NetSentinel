"""
Brute-force protection for the login form.

After `login_max_attempts` wrong passwords for the same username from the
same address inside `login_window_seconds`, that pair is locked out for
`login_lockout_seconds`. Kept in memory on purpose: the backend runs as a
single process (see docs/ARCHITECTURE.md), and a restart clearing
lockouts is fine for this.
"""
from __future__ import annotations

import threading
import time

from app.config import get_settings

settings = get_settings()


class LoginGuard:
    def __init__(self) -> None:
        self._failures: dict[tuple[str, str], list[float]] = {}
        self._locked_until: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(username: str, address: str) -> tuple[str, str]:
        return (username.strip().lower(), address or "unknown")

    def seconds_locked(self, username: str, address: str, now: float | None = None) -> int:
        now = now if now is not None else time.monotonic()
        key = self._key(username, address)
        with self._lock:
            until = self._locked_until.get(key)
            if until is None:
                return 0
            if now >= until:
                self._locked_until.pop(key, None)
                self._failures.pop(key, None)
                return 0
            return int(until - now) + 1

    def record_failure(self, username: str, address: str, now: float | None = None) -> int:
        """Returns how many attempts are left before a lockout (0 = now locked)."""
        now = now if now is not None else time.monotonic()
        key = self._key(username, address)
        with self._lock:
            recent = [t for t in self._failures.get(key, []) if now - t < settings.login_window_seconds]
            recent.append(now)
            self._failures[key] = recent
            left = settings.login_max_attempts - len(recent)
            if left <= 0:
                self._locked_until[key] = now + settings.login_lockout_seconds
                return 0
            return left

    def record_success(self, username: str, address: str) -> None:
        key = self._key(username, address)
        with self._lock:
            self._failures.pop(key, None)
            self._locked_until.pop(key, None)

    def active_lockouts(self) -> int:
        now = time.monotonic()
        with self._lock:
            return sum(1 for until in self._locked_until.values() if until > now)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()
            self._locked_until.clear()


login_guard = LoginGuard()
