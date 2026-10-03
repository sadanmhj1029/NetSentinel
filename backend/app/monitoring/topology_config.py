"""
Default simulated network: the same one used throughout the project spec
and in the demo script (docs/DEMO.md).

    Router-01
      +-- Switch-01
      |     +-- PC-01
      |     +-- PC-02
      +-- Switch-02
            +-- PC-03
            +-- PC-04
            +-- Server-01

This topology is seeded into the devices/topology_links tables on first
startup (app/seed.py) and is also what the simulator uses to decide which
devices should "sympathetically" fail when an upstream device goes down.
It can be edited later through the Devices/Topology pages -- the engine
reads topology from the database at runtime, not from this file; this file
only supplies the initial seed and the simulator's baseline personality
per device.
"""
from __future__ import annotations

# device_id -> static attributes used for both seeding and for generating
# plausible baseline metrics per device type.
DEVICES: dict[str, dict] = {
    "Router-01": {
        "hostname": "edge-router-01",
        "ip_address": "10.0.0.1",
        "device_type": "router",
        "vendor": "Cisco",
        "site": "HQ",
        "department": "Network Core",
        "baseline": {"latency_ms": (3, 9), "cpu_pct": (10, 28), "memory_pct": (20, 38), "bw_in": (80, 220), "bw_out": (70, 200)},
        "capacity_mbps": 10000,
    },
    "Switch-01": {
        "hostname": "access-switch-01",
        "ip_address": "10.0.1.1",
        "device_type": "switch",
        "vendor": "Cisco",
        "site": "HQ",
        "department": "Network Core",
        "baseline": {"latency_ms": (1, 4), "cpu_pct": (5, 18), "memory_pct": (12, 28), "bw_in": (40, 150), "bw_out": (40, 140)},
        "capacity_mbps": 1000,
    },
    "Switch-02": {
        "hostname": "access-switch-02",
        "ip_address": "10.0.2.1",
        "device_type": "switch",
        "vendor": "Cisco",
        "site": "HQ",
        "department": "Network Core",
        "baseline": {"latency_ms": (1, 4), "cpu_pct": (5, 18), "memory_pct": (12, 28), "bw_in": (60, 220), "bw_out": (60, 210)},
        "capacity_mbps": 1000,
    },
    "PC-01": {
        "hostname": "ws-pc-01",
        "ip_address": "10.0.1.10",
        "device_type": "pc",
        "vendor": "Dell",
        "site": "HQ",
        "department": "Finance",
        "baseline": {"latency_ms": (8, 22), "cpu_pct": (10, 35), "memory_pct": (25, 55), "bw_in": (2, 25), "bw_out": (1, 15)},
        "capacity_mbps": 1000,
    },
    "PC-02": {
        "hostname": "ws-pc-02",
        "ip_address": "10.0.1.11",
        "device_type": "pc",
        "vendor": "Dell",
        "site": "HQ",
        "department": "Finance",
        "baseline": {"latency_ms": (8, 22), "cpu_pct": (10, 35), "memory_pct": (25, 55), "bw_in": (2, 25), "bw_out": (1, 15)},
        "capacity_mbps": 1000,
    },
    "PC-03": {
        "hostname": "ws-pc-03",
        "ip_address": "10.0.2.10",
        "device_type": "pc",
        "vendor": "HP",
        "site": "HQ",
        "department": "Engineering",
        "baseline": {"latency_ms": (8, 22), "cpu_pct": (10, 35), "memory_pct": (25, 55), "bw_in": (2, 25), "bw_out": (1, 15)},
        "capacity_mbps": 1000,
    },
    "PC-04": {
        "hostname": "ws-pc-04",
        "ip_address": "10.0.2.11",
        "device_type": "pc",
        "vendor": "HP",
        "site": "HQ",
        "department": "Engineering",
        "baseline": {"latency_ms": (8, 22), "cpu_pct": (10, 35), "memory_pct": (25, 55), "bw_in": (2, 25), "bw_out": (1, 15)},
        "capacity_mbps": 1000,
    },
    "Server-01": {
        "hostname": "app-server-01",
        "ip_address": "10.0.2.50",
        "device_type": "server",
        "vendor": "Dell",
        "site": "HQ",
        "department": "Engineering",
        "baseline": {"latency_ms": (5, 15), "cpu_pct": (20, 55), "memory_pct": (30, 60), "bw_in": (50, 300), "bw_out": (80, 350)},
        "capacity_mbps": 1000,
    },
}

# (parent, child) edges, dependency_direction is always parent_to_child.
LINKS: list[tuple[str, str]] = [
    ("Router-01", "Switch-01"),
    ("Router-01", "Switch-02"),
    ("Switch-01", "PC-01"),
    ("Switch-01", "PC-02"),
    ("Switch-02", "PC-03"),
    ("Switch-02", "PC-04"),
    ("Switch-02", "Server-01"),
]
