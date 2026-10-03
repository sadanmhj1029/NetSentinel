"""
The simulated network. Stands in for ICMP/SNMP/REST polling of real
devices so the whole pipeline (collect -> detect -> correlate -> diagnose
-> alert -> recover) can be demonstrated reliably and repeatably.

Design notes
-------------
* Each device has a small baseline range per metric (see topology_config)
  plus Gaussian jitter each tick, so adaptive baselines have something
  real to learn from.
* A "fault scenario" perturbs one target device. If the fault is
  propagating (e.g. a switch outage), descendants in the topology become
  unreachable a few seconds later -- this is what gives the correlation
  engine a genuine time-and-topology pattern to find, rather than
  something hand-coded to look that way.
* "collector_failure" is special: it does not touch device metrics at
  all. It is read by the collector loop, which simply stops polling
  while it is active -- producing stale data for every device at once,
  which is exactly the case the spec says must NOT be read as a mass
  device-down incident.
"""
from __future__ import annotations

import datetime as dt
import random
import threading
from dataclasses import dataclass, field

from app.monitoring.topology_config import DEVICES, LINKS
from app.utils import utcnow

SCENARIOS = {
    "normal": "Normal operation (clears any active fault)",
    "switch_failure": "Switch / device failure",
    "high_latency": "High latency",
    "packet_loss_burst": "Packet-loss burst",
    "bandwidth_saturation": "Bandwidth saturation",
    "collector_failure": "Collector failure",
    "recovery": "Recovery (restore the active fault's target)",
}

DEFAULT_TARGETS = {
    "switch_failure": "Switch-02",
    "high_latency": "Server-01",
    "packet_loss_burst": "PC-03",
    "bandwidth_saturation": "Switch-02",
}


def _children_map() -> dict[str, list[str]]:
    children: dict[str, list[str]] = {d: [] for d in DEVICES}
    for parent, child in LINKS:
        children.setdefault(parent, []).append(child)
    return children


def _descendants(device_id: str, children: dict[str, list[str]]) -> list[str]:
    out: list[str] = []
    stack = list(children.get(device_id, []))
    while stack:
        node = stack.pop()
        if node not in out:
            out.append(node)
            stack.extend(children.get(node, []))
    return out


# Fallback personality for a device that exists in the database (e.g.
# created later through the admin "add device" API) but isn't one of the
# statically-defined devices above. Modeled on a generic PC so an
# unplanned device still produces plausible, boring-by-default telemetry
# instead of crashing the collector tick.
_GENERIC_PROFILE: dict = {
    "baseline": {
        "latency_ms": (8, 25),
        "cpu_pct": (10, 40),
        "memory_pct": (25, 55),
        "bw_in": (2, 25),
        "bw_out": (1, 15),
    },
    "capacity_mbps": 1000,
}


@dataclass
class ActiveFault:
    scenario: str
    target: str
    started_at: dt.datetime
    # devices considered "down"/affected right now, with the time they
    # started being affected (used to stagger downstream failures a few
    # seconds after the parent, like a real outage).
    affected_since: dict[str, dt.datetime] = field(default_factory=dict)


class NetworkSimulator:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._children = _children_map()
        self._active_fault: ActiveFault | None = None
        self._collector_failure = False
        self._rng = random.Random()
        self._tick = 0
        # Scenario start/stop log, used by /api/reports/summary to
        # approximate Mean-Time-To-Detect (injected fault -> first
        # incident) for the evaluation metrics the spec asks for.
        self._history: list[dict] = []

    # ---------------------------------------------------------------- #
    # Scenario control
    # ---------------------------------------------------------------- #
    def start_scenario(self, scenario: str, target: str | None = None) -> dict:
        if scenario not in SCENARIOS:
            raise ValueError(f"Unknown scenario '{scenario}'")

        now = utcnow()
        with self._lock:
            self._history.append({"action": "start", "scenario": scenario, "target": target, "timestamp": now.isoformat()})

            if scenario in ("normal", "recovery"):
                self._active_fault = None
                self._collector_failure = False
                return {"scenario": scenario, "status": "cleared"}

            if scenario == "collector_failure":
                self._collector_failure = True
                return {"scenario": scenario, "status": "started", "target": None}

            resolved_target = target or DEFAULT_TARGETS.get(scenario)
            if resolved_target not in DEVICES:
                raise ValueError(f"Unknown target device '{resolved_target}'")

            fault = ActiveFault(scenario=scenario, target=resolved_target, started_at=now)
            fault.affected_since[resolved_target] = now

            if scenario == "switch_failure":
                # Downstream devices go dark a few seconds after the parent,
                # like a real outage propagating.
                for i, desc in enumerate(_descendants(resolved_target, self._children)):
                    fault.affected_since[desc] = now + dt.timedelta(seconds=1 + i * 0.7)

            self._active_fault = fault
            return {"scenario": scenario, "status": "started", "target": resolved_target}

    def stop_scenario(self, scenario: str) -> dict:
        with self._lock:
            self._history.append({"action": "stop", "scenario": scenario, "timestamp": utcnow().isoformat()})
            if scenario == "collector_failure":
                self._collector_failure = False
                return {"scenario": scenario, "status": "stopped"}
            if self._active_fault and self._active_fault.scenario == scenario:
                self._active_fault = None
                return {"scenario": scenario, "status": "stopped"}
            return {"scenario": scenario, "status": "not_active"}

    def collector_should_fail(self) -> bool:
        return self._collector_failure

    def get_state(self) -> dict:
        with self._lock:
            fault = self._active_fault
            return {
                "collector_failure": self._collector_failure,
                "active_fault": None
                if not fault
                else {
                    "scenario": fault.scenario,
                    "target": fault.target,
                    "started_at": fault.started_at.isoformat(),
                    "affected_devices": list(fault.affected_since.keys()),
                },
            }

    # ---------------------------------------------------------------- #
    # Sampling
    # ---------------------------------------------------------------- #
    def sample(self, device_id: str, now: dt.datetime | None = None) -> dict:
        now = now or utcnow()
        # A device added later through the Devices page (admin "add
        # device") won't be in the static seed topology. Rather than
        # crash the whole collector tick for every device, fall back to a
        # generic "pc-like" profile so a newly-added simulated device
        # still produces plausible live telemetry out of the box.
        cfg = DEVICES.get(device_id, _GENERIC_PROFILE)
        lat_lo, lat_hi = cfg["baseline"]["latency_ms"]
        cpu_lo, cpu_hi = cfg["baseline"]["cpu_pct"]
        mem_lo, mem_hi = cfg["baseline"]["memory_pct"]
        bwin_lo, bwin_hi = cfg["baseline"]["bw_in"]
        bwout_lo, bwout_hi = cfg["baseline"]["bw_out"]

        sample = {
            "reachable": True,
            "latency_ms": self._rng.uniform(lat_lo, lat_hi),
            "packet_loss_pct": max(0.0, self._rng.gauss(0.2, 0.3)),
            "cpu_pct": self._rng.uniform(cpu_lo, cpu_hi),
            "memory_pct": self._rng.uniform(mem_lo, mem_hi),
            "bandwidth_in_mbps": self._rng.uniform(bwin_lo, bwin_hi),
            "bandwidth_out_mbps": self._rng.uniform(bwout_lo, bwout_hi),
            "interface_errors": 0,
        }

        with self._lock:
            fault = self._active_fault

        if not fault or device_id not in fault.affected_since:
            return sample
        if now < fault.affected_since[device_id]:
            return sample  # hasn't "started" failing yet for this device

        if fault.scenario == "switch_failure":
            sample.update(
                reachable=False,
                latency_ms=None,
                packet_loss_pct=100.0,
                cpu_pct=None,
                memory_pct=None,
                bandwidth_in_mbps=0.0,
                bandwidth_out_mbps=0.0,
            )
        elif fault.scenario == "high_latency":
            sample["latency_ms"] = self._rng.uniform(160, 260)
        elif fault.scenario == "packet_loss_burst":
            sample["packet_loss_pct"] = self._rng.uniform(15, 45)
        elif fault.scenario == "bandwidth_saturation":
            cap = cfg["capacity_mbps"]
            sample["bandwidth_in_mbps"] = cap * self._rng.uniform(0.85, 0.98)
            sample["bandwidth_out_mbps"] = cap * self._rng.uniform(0.80, 0.95)

        return sample

    def device_ids(self) -> list[str]:
        return list(DEVICES.keys())

    def get_history(self, limit: int = 50) -> list[dict]:
        with self._lock:
            return list(self._history[-limit:])


# Process-wide singleton. The collector and the scenario API both need to
# share exactly one simulator instance.
simulator = NetworkSimulator()
