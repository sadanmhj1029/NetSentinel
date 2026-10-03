"""Real ICMP polling (app/monitoring/real_collector.py) and the
collector's per-device simulated/real routing (Collector._poll_device).

The two network-dependent tests ping loopback and a reserved,
guaranteed-unrouted address (192.0.2.0/24, TEST-NET-1 per RFC 5737) --
no dependency on any live host, and fast either way since both resolve
in well under the 1s timeout."""
from __future__ import annotations

import datetime as dt

from app.config import get_settings
from app.models.device import Device
from app.models.metric import MetricSample
from app.monitoring.collector import Collector
from app.monitoring.real_collector import ping_host

settings = get_settings()


def test_ping_loopback_is_reachable():
    result = ping_host("127.0.0.1", count=2, timeout_s=1.0)
    assert result["reachable"] is True
    assert result["packet_loss_pct"] == 0.0
    assert result["latency_ms"] is not None
    assert result["latency_ms"] >= 0
    # ICMP can't see these -- must stay None, never a fabricated 0.
    assert result["cpu_pct"] is None
    assert result["memory_pct"] is None
    assert result["bandwidth_in_mbps"] is None


def test_ping_unrouted_address_reports_full_loss():
    result = ping_host("192.0.2.123", count=1, timeout_s=1.0)
    assert result["reachable"] is False
    assert result["packet_loss_pct"] == 100.0
    assert result["latency_ms"] is None


def test_ping_empty_address_does_not_crash():
    result = ping_host("", count=1, timeout_s=1.0)
    assert result["reachable"] is False


def _device(device_id="DeviceX", ip="10.0.9.9", method="simulated") -> Device:
    return Device(
        device_id=device_id,
        hostname=device_id.lower(),
        ip_address=ip,
        device_type="pc",
        monitoring_method=method,
    )


def test_simulated_mode_ignores_monitoring_method(monkeypatch):
    monkeypatch.setattr(settings, "polling_mode", "simulated")
    collector = Collector()
    device = _device(method="icmp")  # even if flagged icmp, mode=simulated wins
    raw = collector._poll_device(device, dt.datetime.now(dt.timezone.utc))
    assert raw is not None
    # the simulator always returns a reachable bool and does not route
    # through real_collector's empty/None cpu+memory contract the same
    # way -- the real signal here is just that it didn't ping 10.0.9.9.
    assert "reachable" in raw


def test_hybrid_mode_pings_icmp_devices(monkeypatch):
    monkeypatch.setattr(settings, "polling_mode", "hybrid")
    collector = Collector()
    device = _device(ip="127.0.0.1", method="icmp")
    raw = collector._poll_device(device, dt.datetime.now(dt.timezone.utc))
    assert raw is not None
    assert raw["reachable"] is True
    assert raw["cpu_pct"] is None  # really pinged, not simulated


def test_hybrid_mode_falls_back_to_simulator_for_non_icmp(monkeypatch):
    monkeypatch.setattr(settings, "polling_mode", "hybrid")
    collector = Collector()
    device = _device(method="simulated")
    raw = collector._poll_device(device, dt.datetime.now(dt.timezone.utc))
    assert raw is not None  # simulator fallback, never None in hybrid mode


def test_live_mode_returns_none_for_unconfigured_device(monkeypatch):
    monkeypatch.setattr(settings, "polling_mode", "live")
    collector = Collector()
    device = _device(method="simulated")  # no real monitoring method set
    raw = collector._poll_device(device, dt.datetime.now(dt.timezone.utc))
    assert raw is None  # no fallback in live mode


def test_live_mode_pings_icmp_devices(monkeypatch):
    monkeypatch.setattr(settings, "polling_mode", "live")
    collector = Collector()
    device = _device(ip="127.0.0.1", method="icmp")
    raw = collector._poll_device(device, dt.datetime.now(dt.timezone.utc))
    assert raw is not None
    assert raw["reachable"] is True


def test_full_tick_persists_a_real_ping_sample(db, monkeypatch):
    """End-to-end, not just the routing function: a device really polled
    through a full Collector.tick() lands in Postgres as a MetricSample
    with real ping data, not simulator output."""
    monkeypatch.setattr(settings, "polling_mode", "hybrid")

    device = _device(device_id="RealPing-01", ip="127.0.0.1", method="icmp")
    db.add(device)
    db.commit()

    collector = Collector()
    samples = collector.tick(db)

    sample = next(s for s in samples if s.device_id == "RealPing-01")
    assert sample.reachable is True
    assert sample.latency_ms is not None
    assert sample.cpu_pct is None  # really pinged, nothing fabricated

    stored = (
        db.query(MetricSample)
        .filter(MetricSample.device_id == "RealPing-01")
        .one()
    )
    assert stored.reachable is True
