"""Rule-based detection: persistence and hysteresis (spec section 9)."""
from app.detection.rules import RuleEngine, RuleType


def _poll(engine, reachable=True, **kwargs):
    defaults = dict(
        latency_ms=10.0,
        packet_loss_pct=0.0,
        cpu_pct=10.0,
        memory_pct=10.0,
        bandwidth_in_mbps=5.0,
        capacity_mbps=1000.0,
        latency_baseline=None,
        thresholds={},
    )
    defaults.update(kwargs)
    return engine.evaluate_sample("DeviceX", reachable=reachable, **defaults)


def _unreachable_outcome(outcomes):
    return next(o for o in outcomes if o.rule_type == RuleType.UNREACHABLE)


def test_single_bad_poll_does_not_open_an_incident():
    engine = RuleEngine()
    outcome = _unreachable_outcome(_poll(engine, reachable=False))
    assert outcome.transitioned_to == "evaluating"


def test_three_consecutive_bad_polls_open_the_event():
    engine = RuleEngine()
    transitions = [_unreachable_outcome(_poll(engine, reachable=False)).transitioned_to for _ in range(3)]
    assert transitions == ["evaluating", "evaluating", "opened"]


def test_recovery_requires_three_consecutive_good_polls():
    engine = RuleEngine()
    for _ in range(3):
        _poll(engine, reachable=False)  # open it

    transitions = [_unreachable_outcome(_poll(engine, reachable=True)).transitioned_to for _ in range(3)]
    assert transitions == ["still_open", "still_open", "recovered"]


def test_a_single_good_poll_midstream_does_not_reset_bad_count_improperly():
    """One good poll after two bad ones should not have silently opened
    anything -- it should just reset the bad counter per the spec's
    persistence rule."""
    engine = RuleEngine()
    assert _unreachable_outcome(_poll(engine, reachable=False)).transitioned_to == "evaluating"
    assert _unreachable_outcome(_poll(engine, reachable=False)).transitioned_to == "evaluating"
    assert _unreachable_outcome(_poll(engine, reachable=True)).transitioned_to == "still_closed"
    # and now it takes a fresh 3 bad polls to open
    transitions = [_unreachable_outcome(_poll(engine, reachable=False)).transitioned_to for _ in range(3)]
    assert transitions == ["evaluating", "evaluating", "opened"]


def test_packet_loss_rule_uses_configured_threshold():
    engine = RuleEngine()
    outcomes = _poll(engine, packet_loss_pct=15.0, thresholds={"packet_loss_pct": 10.0})
    loss_outcome = next(o for o in outcomes if o.rule_type == RuleType.PACKET_LOSS)
    assert loss_outcome.transitioned_to == "evaluating"
    assert loss_outcome.evidence["packet_loss_pct"] == 15.0


def test_high_cpu_rule_respects_per_device_threshold_override():
    engine = RuleEngine()
    # 85% CPU is fine against an 80% global default but should NOT fire
    # against a looser 95% device-specific override.
    outcomes = _poll(engine, cpu_pct=85.0, thresholds={"high_cpu_pct": 95.0})
    cpu_outcome = next(o for o in outcomes if o.rule_type == RuleType.HIGH_CPU)
    assert cpu_outcome.transitioned_to == "still_closed"


def test_unreachable_device_does_not_also_fire_metric_rules():
    engine = RuleEngine()
    outcomes = _poll(engine, reachable=False)
    fired_types = {o.rule_type for o in outcomes}
    assert fired_types == {RuleType.UNREACHABLE}


def test_bandwidth_saturation_rule():
    engine = RuleEngine()
    outcomes = _poll(engine, bandwidth_in_mbps=950.0, capacity_mbps=1000.0)
    bw = next(o for o in outcomes if o.rule_type == RuleType.BANDWIDTH_SATURATION)
    assert bw.evidence["utilization_pct"] == 95.0
