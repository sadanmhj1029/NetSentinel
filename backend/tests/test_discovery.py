"""
Unit and integration tests for the network auto-discovery engine.
"""
from unittest.mock import patch

from app.models.device import Device
from app.models.topology import TopologyLink
from app.monitoring.discovery import _classify_device, discovery_engine


def test_classify_device():
    assert _classify_device([], "gw-core-router") == "router"
    assert _classify_device([], "switch-access-floor1") == "switch"
    assert _classify_device([], "db-server-prod") == "server"
    assert _classify_device([], "laptop-alice") == "pc"

    # Port based
    assert _classify_device([161, 80], "unknown-node") == "switch"
    assert _classify_device([445], "host-10") == "pc"
    assert _classify_device([5432, 8080], "host-20") == "server"


def test_scan_subnet_mocked():
    with patch("app.monitoring.discovery._scan_single_host") as mock_scan:
        mock_scan.side_effect = lambda ip, timeout: (
            {
                "ip_address": ip,
                "hostname": f"host-{ip.replace('.', '-')}",
                "latency_ms": 2.5,
                "open_ports": [80, 443],
                "services": ["HTTP", "HTTPS"],
                "suggested_device_type": "server",
                "suggested_device_id": f"Server-{ip.split('.')[-1]}",
            }
            if ip.endswith(".1") or ip.endswith(".2")
            else None
        )

        result = discovery_engine.scan_subnet(subnet_cidr="10.0.99.0/30", timeout_sec=0.2)
        assert result["subnet"] == "10.0.99.0/30"
        assert result["live_count"] == 2
        assert len(result["devices"]) == 2
        assert result["devices"][0]["suggested_device_type"] == "server"


def test_import_discovered_devices(db):
    # Setup initial router for topology uplink
    db.add(
        Device(
            device_id="Router-Core",
            hostname="core-gw",
            ip_address="10.0.0.1",
            device_type="router",
            is_active=True,
        )
    )
    db.commit()

    to_import = [
        {
            "ip_address": "10.0.0.55",
            "hostname": "new-file-server",
            "suggested_device_type": "server",
            "suggested_device_id": "Server-55",
        },
        {
            "ip_address": "10.0.0.105",
            "hostname": "workstation-105",
            "suggested_device_type": "pc",
            "suggested_device_id": "PC-105",
        },
    ]

    imported_ids = discovery_engine.import_devices(
        db,
        to_import,
        uplink_parent_id="Router-Core",
        site="HQ",
        department="Engineering",
    )

    assert len(imported_ids) == 2
    assert "Server-55" in imported_ids
    assert "PC-105" in imported_ids

    # Check database
    d1 = db.get(Device, "Server-55")
    assert d1 is not None
    assert d1.monitoring_method == "icmp"
    assert d1.department == "Engineering"

    # Check topology link created
    link = (
        db.query(TopologyLink)
        .filter(TopologyLink.source_device_id == "Router-Core", TopologyLink.destination_device_id == "Server-55")
        .first()
    )
    assert link is not None
    assert link.link_type == "ethernet"
