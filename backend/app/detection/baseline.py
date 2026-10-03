"""
Adaptive per-device baselines (spec section 10).

A single global threshold ("latency > 150ms is bad") is misleading across
device types and sites. Instead, each (device, metric) pair learns its own
normal profile from a rolling window of recent observations, using robust
statistics so a handful of outliers don't drag the baseline around:

    median  -- robust "typical" value
    MAD     -- median absolute deviation, a robust stand-in for std-dev
    z = (current - median) / (MAD + epsilon)

z is reported to the UI as a plain Low/Medium/High deviation label rather
than a raw number, per the spec's "current vs expected vs deviation"
requirement.
"""
from __future__ import annotations

import statistics
import threading
from collections import deque
from dataclasses import dataclass

from app.config import get_settings

settings = get_settings()
_EPSILON = 1e-6


@dataclass
class BaselineReading:
    current: float
    median: float
    mad: float
    z_score: float
    expected_low: float
    expected_high: float
    deviation_label: str  # "low" | "medium" | "high"
    has_enough_data: bool


def _median_abs_deviation(values: list[float], median: float) -> float:
    deviations = [abs(v - median) for v in values]
    return statistics.median(deviations) if deviations else 0.0


class MetricBaseline:
    """Rolling window + robust stats for one (device, metric) pair."""

    def __init__(self, window_size: int | None = None) -> None:
        self.window: deque[float] = deque(maxlen=window_size or settings.baseline_window_size)

    def update_and_evaluate(self, value: float) -> BaselineReading:
        history = list(self.window)
        has_enough = len(history) >= settings.baseline_min_samples

        if has_enough:
            median = statistics.median(history)
            mad = _median_abs_deviation(history, median)
            # Floor MAD relative to the median so a run of near-identical
            # samples (little real-world jitter) doesn't make z blow up to
            # an unreadable number -- the classification into low/medium/
            # high is what matters; the raw z is secondary, display-only
            # context.
            mad_floor = max(median * 0.02, 0.05)
            mad_effective = max(mad, mad_floor)
            z = (value - median) / (mad_effective + _EPSILON)
            spread = mad * 3 if mad > 0 else max(median * 0.25, 1.0)
            expected_low = median - spread
            expected_high = median + spread
            abs_z = abs(z)
            if abs_z >= settings.baseline_deviation_high:
                label = "high"
            elif abs_z >= settings.baseline_deviation_medium:
                label = "medium"
            else:
                label = "low"
        else:
            median = statistics.median(history) if history else value
            mad = 0.0
            z = 0.0
            expected_low = expected_high = median
            label = "low"

        # The new value joins the window *after* being scored against the
        # history that came before it -- otherwise a fault sample would
        # immediately widen its own expected range.
        self.window.append(value)

        return BaselineReading(
            current=value,
            median=median,
            mad=mad,
            z_score=round(z, 2),
            expected_low=round(expected_low, 2),
            expected_high=round(expected_high, 2),
            deviation_label=label,
            has_enough_data=has_enough,
        )


class BaselineStore:
    """All adaptive baselines, keyed by (device_id, metric_name)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._baselines: dict[tuple[str, str], MetricBaseline] = {}

    def evaluate(self, device_id: str, metric: str, value: float | None) -> BaselineReading | None:
        if value is None:
            return None
        key = (device_id, metric)
        with self._lock:
            baseline = self._baselines.setdefault(key, MetricBaseline())
            return baseline.update_and_evaluate(value)

    def seed_history(self, device_id: str, metric: str, values: list[float]) -> None:
        key = (device_id, metric)
        with self._lock:
            baseline = self._baselines.setdefault(key, MetricBaseline())
            for v in values:
                baseline.window.append(v)


baseline_store = BaselineStore()
