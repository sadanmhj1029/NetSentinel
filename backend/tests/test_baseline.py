"""Adaptive per-device baselines (spec section 10)."""
import random

from app.detection.baseline import MetricBaseline


def test_no_deviation_label_until_enough_samples():
    baseline = MetricBaseline(window_size=60)
    reading = baseline.update_and_evaluate(10.0)
    assert reading.has_enough_data is False
    assert reading.deviation_label == "low"


def test_stable_metric_reports_low_deviation():
    rnd = random.Random(42)
    baseline = MetricBaseline(window_size=60)
    reading = None
    for _ in range(30):
        reading = baseline.update_and_evaluate(10.0 + rnd.uniform(-1, 1))
    assert reading.has_enough_data is True
    assert reading.deviation_label == "low"
    assert 8 <= reading.median <= 12


def test_sudden_spike_is_flagged_high_deviation():
    rnd = random.Random(42)
    baseline = MetricBaseline(window_size=60)
    for _ in range(30):
        baseline.update_and_evaluate(10.0 + rnd.uniform(-1, 1))

    spike = baseline.update_and_evaluate(250.0)
    assert spike.deviation_label == "high"
    assert spike.z_score > 0


def test_expected_range_is_reported_alongside_current_value():
    rnd = random.Random(7)
    baseline = MetricBaseline(window_size=60)
    reading = None
    for _ in range(25):
        reading = baseline.update_and_evaluate(50.0 + rnd.uniform(-5, 5))
    assert reading.expected_low < reading.median < reading.expected_high


def test_window_is_bounded_so_baseline_recovers_after_a_fault_clears():
    baseline = MetricBaseline(window_size=20)
    for _ in range(20):
        baseline.update_and_evaluate(10.0)
    for _ in range(20):
        baseline.update_and_evaluate(500.0)  # sustained fault fills the whole window
    reading = baseline.update_and_evaluate(500.0)
    # the window no longer contains any of the original "10.0" samples,
    # so 500 now looks "normal" relative to its own recent history --
    # this is a deliberate tradeoff documented in docs/ARCHITECTURE.md.
    assert reading.deviation_label == "low"
