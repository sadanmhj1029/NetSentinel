"""
Unit tests for the live network poller and ping/socket probing.
"""
import datetime as dt
from unittest.mock import MagicMock, patch

from app.models.device import Device
from app.monitoring.live_poller import LiveNetworkPoller, ping_host, tcp_probe


def test_ping_host_success():
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    mock_proc.stdout = "Reply from 192.168.1.1: bytes=32 time=12ms TTL=64\nPackets: Sent = 2, Received = 2, Lost = 0 (0% loss)\nAverage = 12ms"

    with patch("subprocess.run", return_value=mock_proc):
        reachable, latency, loss = ping_host("192.168.1.1", count=2)
        assert reachable is True
        assert latency == 12.0
        assert loss == 0.0


def test_ping_host_unreachable():
    mock_proc = MagicMock()
    mock_proc.returncode = 1
    mock_proc.stdout = "Request timed out.\nPackets: Sent = 2, Received = 0, Lost = 2 (100% loss)"

    with patch("subprocess.run", return_value=mock_proc):
        reachable, latency, loss = ping_host("10.255.255.1", count=2)
        assert reachable is False
        assert loss == 100.0


def test_tcp_probe_fallback():
    with patch("socket.socket") as mock_socket_cls:
        sock_inst = MagicMock()
        sock_inst.connect_ex.return_value = 0  # success
        mock_socket_cls.return_value = sock_inst

        reachable, latency = tcp_probe("192.168.1.50", ports=[80, 443])
        assert reachable is True
        assert latency is not None


def test_live_poller_sample_reachable():
    poller = LiveNetworkPoller()
    dev = Device(
        device_id="Router-Physical",
        hostname="gw-cisco-core",
        ip_address="192.168.1.1",
        device_type="router",
    )
    with patch("app.monitoring.live_poller.ping_host", return_value=(True, 4.2, 0.0)):
        sample = poller.sample(dev, dt.datetime.now(dt.timezone.utc))
        assert sample["reachable"] is True
        assert sample["latency_ms"] == 4.2
        assert sample["packet_loss_pct"] == 0.0
        assert sample["bandwidth_in_mbps"] > 0
        assert sample["bandwidth_out_mbps"] > 0


def test_live_poller_sample_unreachable():
    poller = LiveNetworkPoller()
    dev = Device(
        device_id="PC-Physical-Dead",
        hostname="pc-finance-09",
        ip_address="192.168.1.99",
        device_type="pc",
    )
    with (
        patch("app.monitoring.live_poller.ping_host", return_value=(False, None, 100.0)),
        patch("app.monitoring.live_poller.tcp_probe", return_value=(False, None)),
    ):
        sample = poller.sample(dev, dt.datetime.now(dt.timezone.utc))
        assert sample["reachable"] is False
        assert sample["latency_ms"] is None
        assert sample["packet_loss_pct"] == 100.0
