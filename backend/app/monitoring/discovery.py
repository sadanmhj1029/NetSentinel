"""
Network auto-discovery engine.

Scans an IPv4 subnet using concurrent ICMP ping and TCP socket sweeps,
resolves hostnames, probes common ports to classify device roles (router,
switch, server, workstation), and allows bulk importing into the monitoring
inventory and topology graph.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import ipaddress
import logging
import socket
import threading
import time

from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.interface import Interface
from app.models.topology import TopologyLink
from app.monitoring.live_poller import ping_host, tcp_probe

logger = logging.getLogger("netsentinel.discovery")

PORT_SERVICES = {
    22: "SSH",
    53: "DNS",
    80: "HTTP",
    161: "SNMP",
    443: "HTTPS",
    445: "SMB",
    3306: "MySQL",
    3389: "RDP",
    5432: "PostgreSQL",
    8080: "HTTP-Alt",
}


def _classify_device(open_ports: list[int], hostname: str) -> str:
    hn = (hostname or "").lower()
    ports = set(open_ports)

    if "router" in hn or "gateway" in hn or "gw" in hn:
        return "router"
    if "switch" in hn or "sw" in hn:
        return "switch"
    if "srv" in hn or "server" in hn or "db" in hn or "app" in hn:
        return "server"
    if "pc" in hn or "ws" in hn or "laptop" in hn or "desktop" in hn:
        return "pc"

    # Port heuristic
    if 161 in ports:
        return "switch" if (80 in ports or 443 in ports) else "router"
    if 445 in ports or 3389 in ports:
        return "pc"
    if any(p in ports for p in (80, 443, 3306, 5432, 8080, 22)):
        return "server"

    return "pc"


def _scan_single_host(ip: str, timeout_sec: float) -> dict | None:
    reachable, latency_ms, _ = ping_host(ip, count=1, timeout_sec=timeout_sec)

    # Fallback to TCP check if ICMP blocked
    if not reachable:
        tcp_ok, tcp_lat = tcp_probe(ip, [80, 443, 22, 445, 3389, 53], timeout_sec=timeout_sec)
        if tcp_ok:
            reachable = True
            latency_ms = tcp_lat

    if not reachable:
        return None

    # Resolve reverse DNS hostname
    hostname = ip
    try:
        host_info = socket.gethostbyaddr(ip)
        if host_info and host_info[0]:
            hostname = host_info[0].split(".")[0]
    except Exception:
        hostname = f"host-{ip.replace('.', '-')}"

    # Check common ports for identification
    open_ports: list[int] = []
    for port in [22, 53, 80, 161, 443, 445, 3306, 3389, 5432, 8080]:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.3)
        try:
            if s.connect_ex((ip, port)) == 0:
                open_ports.append(port)
        except Exception:
            pass
        finally:
            s.close()

    device_type = _classify_device(open_ports, hostname)

    return {
        "ip_address": ip,
        "hostname": hostname,
        "latency_ms": latency_ms or 1.0,
        "open_ports": open_ports,
        "services": [PORT_SERVICES.get(p, str(p)) for p in open_ports],
        "suggested_device_type": device_type,
        "suggested_device_id": f"{device_type.capitalize()}-{ip.split('.')[-1]}",
    }


class NetworkDiscoveryEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last_result: dict | None = None
        self._is_scanning = False

    def is_scanning(self) -> bool:
        return self._is_scanning

    def get_last_result(self) -> dict | None:
        with self._lock:
            return self._last_result

    def scan_subnet(
        self,
        subnet_cidr: str = "192.168.1.0/24",
        timeout_sec: float = 0.6,
        max_hosts: int = 256,
        workers: int = 25,
    ) -> dict:
        self._is_scanning = True
        t_start = time.perf_counter()

        try:
            net = ipaddress.ip_network(subnet_cidr.strip(), strict=False)
            hosts = [str(ip) for ip in net.hosts()]
            if len(hosts) > max_hosts:
                hosts = hosts[:max_hosts]
        except Exception as exc:
            self._is_scanning = False
            raise ValueError(f"Invalid CIDR subnet '{subnet_cidr}': {exc}") from exc

        discovered: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            future_to_ip = {executor.submit(_scan_single_host, ip, timeout_sec): ip for ip in hosts}
            for future in concurrent.futures.as_completed(future_to_ip):
                try:
                    res = future.result()
                    if res:
                        discovered.append(res)
                except Exception as err:
                    logger.debug("Error probing host: %s", err)

        # Sort discovered devices by IP address integer value
        discovered.sort(key=lambda d: ipaddress.ip_address(d["ip_address"]))
        duration = round(time.perf_counter() - t_start, 2)

        result = {
            "subnet": subnet_cidr,
            "total_probed": len(hosts),
            "live_count": len(discovered),
            "duration_seconds": duration,
            "scanned_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "devices": discovered,
        }

        with self._lock:
            self._last_result = result
            self._is_scanning = False

        return result

    def import_devices(
        self,
        db: Session,
        devices_to_import: list[dict],
        uplink_parent_id: str | None = None,
        site: str = "HQ",
        department: str = "IT",
    ) -> list[str]:
        """Bulk import discovered devices into database and topology."""
        imported_ids: list[str] = []

        # Find a default upstream parent for topology linkage if not given
        if not uplink_parent_id:
            sw = db.query(Device).filter(Device.device_type == "switch", Device.is_active.is_(True)).first()
            if sw:
                uplink_parent_id = sw.device_id
            else:
                router = db.query(Device).filter(Device.device_type == "router", Device.is_active.is_(True)).first()
                uplink_parent_id = router.device_id if router else None

        for item in devices_to_import:
            dev_id = item.get("device_id") or item.get("suggested_device_id") or f"Host-{item['ip_address']}"
            ip = item["ip_address"]
            hostname = item.get("hostname", dev_id)
            dev_type = item.get("device_type") or item.get("suggested_device_type") or "pc"

            # Check if device already exists
            existing = db.get(Device, dev_id)
            if existing:
                existing.ip_address = ip
                existing.hostname = hostname
                existing.device_type = dev_type
                existing.is_active = True
                existing.monitoring_method = "icmp"
            else:
                new_dev = Device(
                    device_id=dev_id,
                    hostname=hostname,
                    ip_address=ip,
                    device_type=dev_type,
                    vendor="Discovered",
                    site=site,
                    department=department,
                    monitoring_method="icmp",
                    status="online",
                    is_active=True,
                )
                db.add(new_dev)
                # Create standard interface
                db.add(Interface(device_id=dev_id, name="eth0", capacity_mbps=1000.0, state="up"))

            imported_ids.append(dev_id)

            # Link to topology if uplink exists and no link already present
            if uplink_parent_id and uplink_parent_id != dev_id:
                link_exists = (
                    db.query(TopologyLink)
                    .filter(
                        TopologyLink.source_device_id == uplink_parent_id,
                        TopologyLink.destination_device_id == dev_id,
                    )
                    .first()
                )
                if not link_exists:
                    db.add(
                        TopologyLink(
                            source_device_id=uplink_parent_id,
                            destination_device_id=dev_id,
                            link_type="ethernet",
                            dependency_direction="parent_to_child",
                        )
                    )

        db.commit()
        return imported_ids


discovery_engine = NetworkDiscoveryEngine()
