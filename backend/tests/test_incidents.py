"""
End-to-end integration: collector -> rules -> correlation -> incident
engine, against a real (test) Postgres database. This is intentionally
slower than the unit tests above (it runs real polling ticks a couple of
seconds apart, same as production) because the thing actually being
verified is the full pipeline's timing-sensitive behavior, not just one
function's return value.
"""
import time

import pytest

from app.incidents.engine import IncidentEngine
from app.models.incident import Incident
from app.monitoring.collector import Collector
from app.monitoring.simulator import NetworkSimulator
import app.monitoring.collector as collector_module
import app.seed as seed_module


@pytest.fixture()
def pipeline(db, monkeypatch):
    """A fully isolated pipeline: its own simulator, collector and
    incident engine, so this test can't leak state into others."""
    sim = NetworkSimulator()
    monkeypatch.setattr(collector_module, "simulator", sim)

    col = Collector()
    monkeypatch.setattr("app.incidents.engine.collector", col)

    seed_module.seed_devices_and_topology(db)
    seed_module.seed_users(db)

    incident_engine = IncidentEngine()
    return sim, col, incident_engine


def _run_ticks(db, collector, incident_engine, n, delay=1.0):
    summaries = []
    for _ in range(n):
        time.sleep(delay)
        collector.tick(db)
        summaries.append(incident_engine.process_tick(db))
    return summaries


def test_switch_failure_creates_one_grouped_incident_with_correct_root_cause(db, pipeline):
    sim, col, incident_engine = pipeline

    _run_ticks(db, col, incident_engine, 3, delay=0.3)  # settle into "online"
    assert db.query(Incident).count() == 0

    sim.start_scenario("switch_failure", "Switch-02")
    _run_ticks(db, col, incident_engine, 6, delay=1.0)

    incidents = db.query(Incident).all()
    assert len(incidents) == 1, "downstream symptoms must be grouped into ONE incident, not four"

    incident = incidents[0]
    assert incident.probable_root_cause_device_id == "Switch-02"
    assert incident.root_cause_confidence_label == "high"
    assert incident.severity == "critical"
    assert set(incident.affected_devices) >= {"Switch-02"}
    assert incident.notified is True
    assert "Switch-02" in incident.diagnosis_text


def test_incident_auto_resolves_after_verified_recovery(db, pipeline):
    sim, col, incident_engine = pipeline
    _run_ticks(db, col, incident_engine, 3, delay=0.3)

    sim.start_scenario("switch_failure", "Switch-02")
    _run_ticks(db, col, incident_engine, 6, delay=1.0)
    incident = db.query(Incident).first()
    assert incident.status != "resolved"

    sim.stop_scenario("switch_failure")
    _run_ticks(db, col, incident_engine, 8, delay=1.0)

    db.refresh(incident)
    assert incident.status == "resolved"
    assert incident.recovery_time_seconds is not None
    assert incident.recovery_time_seconds > 0


def test_collector_failure_never_creates_a_false_mass_outage_incident(db, pipeline):
    sim, col, incident_engine = pipeline
    _run_ticks(db, col, incident_engine, 3, delay=0.3)

    sim.start_scenario("collector_failure")
    _run_ticks(db, col, incident_engine, 5, delay=0.5)

    assert db.query(Incident).count() == 0, "a collector outage must never look like every device going down"
    assert col.health.is_healthy is False

    sim.stop_scenario("collector_failure")
    _run_ticks(db, col, incident_engine, 2, delay=0.3)
    assert col.health.is_healthy is True
