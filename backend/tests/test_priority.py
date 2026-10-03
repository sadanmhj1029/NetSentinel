"""
Fix-priority ranking, run against real collector ticks and a real (test)
database, same style as test_incidents.py. Covers the case the feature
exists for: several devices faulty at once, and which one to fix first.
"""
import time

import pytest

from app.incidents.engine import IncidentEngine
from app.incidents.priority import compute_priorities
from app.monitoring.collector import Collector
from app.monitoring.simulator import NetworkSimulator
import app.monitoring.collector as collector_module
import app.seed as seed_module


@pytest.fixture()
def pipeline(db, monkeypatch):
    sim = NetworkSimulator()
    monkeypatch.setattr(collector_module, "simulator", sim)
    col = Collector()
    monkeypatch.setattr("app.incidents.engine.collector", col)
    seed_module.seed_devices_and_topology(db)
    seed_module.seed_users(db)
    return sim, col, IncidentEngine()


def _run_ticks(db, col, engine, n, delay):
    for _ in range(n):
        time.sleep(delay)
        col.tick(db)
        engine.process_tick(db)


def _by_id(result):
    return {r["device_id"]: r for r in result["ranked"]}


# --------------------------------------------------------------------------- #
# Simulator: several faults at once
# --------------------------------------------------------------------------- #
def test_simulator_holds_independent_faults_and_stops_one_by_target():
    sim = NetworkSimulator()
    sim.start_scenario("switch_failure", "Switch-01")
    sim.start_scenario("high_latency", "Server-01")

    targets = {f["target"] for f in sim.get_state()["active_faults"]}
    assert targets == {"Switch-01", "Server-01"}
    assert sim.sample("Switch-01")["reachable"] is False
    assert sim.sample("Server-01")["latency_ms"] >= 160
    assert sim.sample("PC-03")["reachable"] is True  # untouched by either fault

    sim.stop_scenario("high_latency", "Server-01")
    assert [f["target"] for f in sim.get_state()["active_faults"]] == ["Switch-01"]

    sim.start_scenario("normal")
    assert sim.get_state()["active_faults"] == []
    assert sim.get_state()["active_fault"] is None


# --------------------------------------------------------------------------- #
# Ranking
# --------------------------------------------------------------------------- #
def test_no_faults_means_nothing_to_rank(db, pipeline):
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 3, delay=0.3)
    result = compute_priorities(db)
    assert result["faulty_count"] == 0
    assert result["ranked"] == []


def test_down_switch_outranks_a_slow_server(db, pipeline):
    """Two unrelated problems: Switch-01 completely down (2 PCs behind it)
    and Server-01 only slow. The outage must be fixed first, and the
    explanation must compare the two devices."""
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 4, delay=0.3)  # build some normal workload history

    sim.start_scenario("switch_failure", "Switch-01")
    sim.start_scenario("high_latency", "Server-01")
    _run_ticks(db, col, engine, 6, delay=1.0)

    result = compute_priorities(db)
    ranked = _by_id(result)
    assert {"Switch-01", "Server-01"} <= set(ranked)

    first = result["ranked"][0]
    assert first["device_id"] == "Switch-01"
    assert first["is_first_priority"] is True
    assert ranked["Server-01"]["rank"] > ranked["Switch-01"]["rank"]
    assert ranked["Server-01"]["caused_by"] is None, "the slow server is its own problem, not a knock-on"

    # Problems are described in plain words, with real numbers.
    assert "stopped responding" in first["problem"]["summary"]
    assert "responding slowly" in ranked["Server-01"]["problem"]["summary"]
    assert "ms" in ranked["Server-01"]["problem"]["summary"]
    assert first["impact"]["dependents"] == ["PC-01", "PC-02"]

    # The comparison names both devices and says why.
    assert result["why_first"].startswith("Fix Switch-01 before Server-01")
    assert "completely down" in result["why_first"]

    # PCs behind the dead switch are knock-on symptoms, ranked last.
    for pc in ("PC-01", "PC-02"):
        if pc in ranked:
            assert ranked[pc]["caused_by"] == "Switch-01"
            assert ranked[pc]["level"] == "follow_up"
            assert ranked[pc]["rank"] > ranked["Server-01"]["rank"]


def test_unrelated_faults_become_separate_incidents(db, pipeline):
    """Regression: Switch-01 (left branch) and Server-01 (right branch)
    used to be merged into one incident through their shared top router."""
    from app.models.incident import Incident

    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 4, delay=0.3)
    sim.start_scenario("switch_failure", "Switch-01")
    sim.start_scenario("high_latency", "Server-01")
    _run_ticks(db, col, engine, 6, delay=1.0)

    incidents = db.query(Incident).filter(Incident.status != "resolved").all()
    by_root = {i.probable_root_cause_device_id: set(i.affected_devices) for i in incidents}
    assert len(incidents) == 2, f"expected two separate incidents, got {by_root}"
    assert "Server-01" not in by_root["Switch-01"]
    assert by_root["Server-01"] == {"Server-01"}


def test_same_fault_on_two_devices_is_decided_by_workload(db, pipeline):
    """Server-01 and PC-01 both slow, same fault type. The server carries
    far more traffic and has a more important role, so it goes first and
    the explanation says it carries more traffic."""
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 4, delay=0.3)

    sim.start_scenario("high_latency", "Server-01")
    sim.start_scenario("high_latency", "PC-01")
    _run_ticks(db, col, engine, 5, delay=0.8)

    result = compute_priorities(db)
    ranked = _by_id(result)
    assert result["ranked"][0]["device_id"] == "Server-01"
    server, pc = ranked["Server-01"], ranked["PC-01"]
    assert server["score_breakdown"]["severity"] == pc["score_breakdown"]["severity"]
    assert server["score_breakdown"]["workload"] > pc["score_breakdown"]["workload"]
    assert server["workload"]["traffic_mbps"] > pc["workload"]["traffic_mbps"]
    assert "carries more traffic" in result["why_first"]


def test_single_switch_failure_puts_switch_first_and_downstream_as_follow_up(db, pipeline):
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 4, delay=0.3)

    sim.start_scenario("switch_failure", "Switch-02")
    _run_ticks(db, col, engine, 7, delay=1.0)

    result = compute_priorities(db)
    assert result["ranked"][0]["device_id"] == "Switch-02"
    assert result["ranked"][0]["is_root_cause"] is True
    assert result["headline"].startswith("Fix Switch-02 first")
    for r in result["ranked"][1:]:
        assert r["caused_by"] == "Switch-02"
        assert "knock-on" in r["impact"]["summary"]


def test_collector_outage_never_produces_a_ranking(db, pipeline):
    result = compute_priorities(db, collector_healthy=False)
    assert result["collector_healthy"] is False
    assert result["ranked"] == []
