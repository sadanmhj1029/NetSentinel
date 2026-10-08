"""Reliability features: login lockout, health/readiness, data retention,
scheduler heartbeat, and planned maintenance suppressing incidents."""
import datetime as dt
import time

import pytest
from fastapi.testclient import TestClient

from app.incidents.engine import IncidentEngine
from app.incidents.priority import compute_priorities
from app.main import app
from app.models.incident import Incident
from app.models.maintenance import MaintenanceWindow
from app.models.metric import MetricSample
from app.monitoring.collector import Collector
from app.monitoring.simulator import NetworkSimulator
from app.services.heartbeat import Heartbeat
from app.services.retention import prune_metrics
from app.utils import utcnow
import app.monitoring.collector as collector_module
import app.seed as seed_module


def _login(client, username, password):
    return client.post("/api/auth/login", data={"username": username, "password": password})


def _token(client, username, password):
    return {"Authorization": f"Bearer {_login(client, username, password).json()['access_token']}"}


# --------------------------------------------------------------------------- #
# Login lockout
# --------------------------------------------------------------------------- #
def test_login_locks_out_after_repeated_wrong_passwords(db):
    with TestClient(app) as client:
        codes = [_login(client, "operator", "nope").status_code for _ in range(5)]
        assert codes[:4] == [401, 401, 401, 401]
        assert codes[4] == 429, "fifth wrong password should trigger the lockout"

        # Even the right password is refused while locked, with a Retry-After hint.
        locked = _login(client, "operator", "operator123")
        assert locked.status_code == 429
        assert int(locked.headers["Retry-After"]) > 0
        assert "Try again" in locked.json()["detail"]

        # Other accounts are unaffected.
        assert _login(client, "viewer", "viewer123").status_code == 200


def test_wrong_password_message_warns_before_lockout(db):
    with TestClient(app) as client:
        for _ in range(3):
            resp = _login(client, "viewer", "bad")
        assert "2 attempts left" in resp.json()["detail"]
        assert _login(client, "viewer", "viewer123").status_code == 200
        # A success resets the counter.
        assert "left" not in _login(client, "viewer", "bad").json()["detail"]


# --------------------------------------------------------------------------- #
# Health, readiness, status
# --------------------------------------------------------------------------- #
def test_readiness_reports_database_and_scheduler(db):
    with TestClient(app) as client:
        resp = client.get("/api/health/ready")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ready"
        assert body["checks"]["database"]["ok"] is True
        assert "latency_ms" in body["checks"]["database"]


def test_system_status_needs_login_and_returns_counts(db):
    with TestClient(app) as client:
        assert client.get("/api/system/status").status_code == 401
        resp = client.get("/api/system/status", headers=_token(client, "viewer", "viewer123"))
        assert resp.status_code == 200
        body = resp.json()
        assert body["counts"]["devices"] == 8
        assert {"pipeline", "collector", "checks", "ml", "settings"} <= body.keys()


def test_heartbeat_tracks_failures_and_recovery():
    hb = Heartbeat()
    assert hb.seconds_since_tick() is None
    hb.error("OperationalError: database restarting")
    hb.error("OperationalError: database restarting")
    assert hb.consecutive_errors == 2 and hb.total_errors == 2
    hb.ok(12.3)
    assert hb.consecutive_errors == 0 and hb.total_ticks == 1
    assert hb.to_dict()["last_tick_ms"] == 12.3


# --------------------------------------------------------------------------- #
# Retention
# --------------------------------------------------------------------------- #
def test_retention_prunes_only_old_metric_samples(db):
    seed_module.seed_devices_and_topology(db)
    now = utcnow()
    for hours_ago in (100, 80, 10, 1):
        db.add(MetricSample(device_id="PC-01", timestamp=now - dt.timedelta(hours=hours_ago), latency_ms=5.0))
    db.commit()

    deleted = prune_metrics(db, now=now, retention_hours=72)
    assert deleted == 2
    left = sorted(round((now - s.timestamp).total_seconds() / 3600) for s in db.query(MetricSample).all())
    assert left == [1, 10]

    assert prune_metrics(db, now=now, retention_hours=0) == 0, "0 disables retention"


# --------------------------------------------------------------------------- #
# Planned maintenance
# --------------------------------------------------------------------------- #
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
    last = None
    for _ in range(n):
        time.sleep(delay)
        col.tick(db)
        last = engine.process_tick(db)
    return last


def _maintain(db, device_id, minutes=30):
    now = utcnow()
    db.add(MaintenanceWindow(device_id=device_id, starts_at=now, ends_at=now + dt.timedelta(minutes=minutes),
                             reason="test", created_by="tester"))
    db.commit()


def test_maintenance_suppresses_incident_for_device_and_everything_behind_it(db, pipeline):
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 3, delay=0.3)
    _maintain(db, "Switch-02")

    sim.start_scenario("switch_failure", "Switch-02")
    summary = _run_ticks(db, col, engine, 6, delay=1.0)

    assert db.query(Incident).count() == 0, "planned work must not open an incident"
    assert "Switch-02" in summary.suppressed_devices
    pr = compute_priorities(db, collector_healthy=True)
    assert pr["ranked"] == []
    assert "Switch-02" in pr["in_maintenance"]
    assert len(pr["in_maintenance"]) > 1, "devices behind the switch are covered too"


def test_fault_still_present_after_maintenance_ends_opens_an_incident(db, pipeline):
    sim, col, engine = pipeline
    _run_ticks(db, col, engine, 3, delay=0.3)
    _maintain(db, "Switch-02")
    sim.start_scenario("switch_failure", "Switch-02")
    _run_ticks(db, col, engine, 5, delay=1.0)
    assert db.query(Incident).count() == 0

    w = db.query(MaintenanceWindow).first()
    w.ended_early_at = utcnow()
    db.commit()
    _run_ticks(db, col, engine, 2, delay=0.5)

    incidents = db.query(Incident).all()
    assert len(incidents) == 1
    assert incidents[0].probable_root_cause_device_id == "Switch-02"


def test_maintenance_api_roles_and_lifecycle(db):
    with TestClient(app) as client:
        viewer = _token(client, "viewer", "viewer123")
        operator = _token(client, "operator", "operator123")

        body = {"device_id": "Switch-01", "duration_minutes": 30, "reason": "Firmware upgrade"}
        assert client.post("/api/maintenance", json=body, headers=viewer).status_code == 403
        assert client.post("/api/maintenance", json={**body, "device_id": "Nope"}, headers=operator).status_code == 404

        started = client.post("/api/maintenance", json=body, headers=operator)
        assert started.status_code == 200
        w = started.json()
        assert w["active"] is True and w["seconds_left"] > 25 * 60

        active = client.get("/api/maintenance", headers=viewer).json()
        assert [a["device_id"] for a in active] == ["Switch-01"]
        assert active[0]["covers"], "a switch covers the devices behind it"

        ended = client.post(f"/api/maintenance/{w['id']}/end", headers=operator).json()
        assert ended["active"] is False and ended["ended_early"] is True
        assert client.get("/api/maintenance", headers=viewer).json() == []
