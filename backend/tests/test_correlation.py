"""Topology correlation + root-cause scoring (spec sections 13-14) --
the canonical Switch-02 scenario from the project spec itself."""
import datetime as dt

import networkx as nx

from app.correlation.root_cause import AffectedDevice, build_diagnosis_text, score_candidates


def _spec_topology() -> nx.DiGraph:
    g = nx.DiGraph()
    g.add_edges_from(
        [
            ("Router-01", "Switch-01"),
            ("Router-01", "Switch-02"),
            ("Switch-01", "PC-01"),
            ("Switch-01", "PC-02"),
            ("Switch-02", "PC-03"),
            ("Switch-02", "PC-04"),
            ("Switch-02", "Server-01"),
        ]
    )
    return g


def test_switch_failure_ranks_the_switch_as_top_candidate():
    graph = _spec_topology()
    t0 = dt.datetime(2026, 10, 2, 14, 3, 12, tzinfo=dt.timezone.utc)
    affected = {
        "Switch-02": AffectedDevice("Switch-02", t0, ["unreachable"]),
        "PC-03": AffectedDevice("PC-03", t0 + dt.timedelta(seconds=3), ["unreachable"]),
        "PC-04": AffectedDevice("PC-04", t0 + dt.timedelta(seconds=4), ["unreachable"]),
        "Server-01": AffectedDevice("Server-01", t0 + dt.timedelta(seconds=5), ["unreachable"]),
    }

    ranked = score_candidates(graph, affected)

    assert ranked[0].device_id == "Switch-02"
    assert ranked[0].confidence_label == "high"
    assert ranked[0].coverage_pct == 100.0
    # Router-01 is a plausible but much weaker candidate (no direct
    # evidence it is itself unhealthy).
    router = next(r for r in ranked if r.device_id == "Router-01")
    assert router.overall_score < ranked[0].overall_score
    assert router.has_direct_evidence is False


def test_symptom_devices_rank_below_the_true_root_cause():
    graph = _spec_topology()
    t0 = dt.datetime(2026, 10, 2, 14, 3, 12, tzinfo=dt.timezone.utc)
    affected = {
        "Switch-02": AffectedDevice("Switch-02", t0, ["unreachable"]),
        "PC-03": AffectedDevice("PC-03", t0 + dt.timedelta(seconds=2), ["unreachable"]),
    }
    ranked = score_candidates(graph, affected)
    scores = {r.device_id: r.overall_score for r in ranked}
    assert scores["Switch-02"] > scores["PC-03"]


def test_single_isolated_device_fault_has_no_inflated_confidence():
    """A lone PC with high latency and no topology fan-out should not be
    scored as if it were a major infrastructure failure."""
    graph = _spec_topology()
    t0 = dt.datetime(2026, 10, 2, 9, 0, 0, tzinfo=dt.timezone.utc)
    affected = {"PC-01": AffectedDevice("PC-01", t0, ["high_latency"])}
    ranked = score_candidates(graph, affected)
    assert ranked[0].device_id == "PC-01"
    assert ranked[0].dependency_importance_pct == 0.0


def test_diagnosis_text_cites_concrete_evidence():
    graph = _spec_topology()
    t0 = dt.datetime(2026, 10, 2, 14, 3, 12, tzinfo=dt.timezone.utc)
    affected = {
        "Switch-02": AffectedDevice("Switch-02", t0, ["unreachable"]),
        "PC-03": AffectedDevice("PC-03", t0 + dt.timedelta(seconds=3), ["unreachable"]),
        "Server-01": AffectedDevice("Server-01", t0 + dt.timedelta(seconds=5), ["unreachable"]),
    }
    ranked = score_candidates(graph, affected)
    text = build_diagnosis_text(ranked[0], affected, graph)

    assert "Switch-02" in text
    assert "14:03:12" in text
    assert "Router-01" in text  # cites the healthy upstream device
    assert "high confidence" in text


def test_two_independent_faults_do_not_force_a_shared_candidate():
    """PC-01 (under Switch-01) and Server-01 (under Switch-02) failing at
    the same time are unrelated -- scoring either branch alone should not
    be contaminated by the other branch's devices."""
    graph = _spec_topology()
    t0 = dt.datetime(2026, 10, 2, 9, 0, 0, tzinfo=dt.timezone.utc)
    affected = {
        "PC-01": AffectedDevice("PC-01", t0, ["unreachable"]),
        "Server-01": AffectedDevice("Server-01", t0, ["unreachable"]),
    }
    ranked = score_candidates(graph, affected)
    top_two = {ranked[0].device_id, ranked[1].device_id}
    assert top_two == {"PC-01", "Server-01"}
