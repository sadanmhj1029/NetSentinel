"""
Real ICMP polling for devices marked monitoring_method="icmp" (see
app/models/device.py).

This is deliberately scoped to ICMP only: reachability, latency and
packet loss -- the three things `ping` can actually measure, and not
coincidentally the three symptoms named in the brief (slow speeds,
intermittent connectivity, outages). CPU, memory and bandwidth
utilization need SNMP against the real device, which is a larger,
vendor-specific undertaking with nothing here to test it against, so it
stays out of scope for now (see docs/ARCHITECTURE.md). A device polled
this way simply reports those three fields as None, which the rest of
the pipeline already treats as "not available" rather than "zero" --
app/monitoring/collector.py's _validate() only range-checks a metric
when it isn't None, and app/ml/features.py's build_feature_matrix()
drops rows missing cpu/memory rather than scoring them with fabricated
zeros.

Shells out to the system `ping` binary rather than a raw-socket library:
no extra Python dependency, no CAP_NET_RAW wrangling inside the
container, and it is the same tool a network admin would reach for by
hand.
"""
from __future__ import annotations

import re
import subprocess

_LOSS_RE = re.compile(r"(\d+(?:\.\d+)?)%\s*packet loss")
# "rtt min/avg/max/mdev = 0.024/0.040/0.065/0.015 ms" -- avg is the 2nd number.
_RTT_RE = re.compile(r"rtt [a-z/]+ = [\d.]+/([\d.]+)/")


def _empty_sample(packet_loss_pct: float = 100.0) -> dict:
    return {
        "reachable": False,
        "latency_ms": None,
        "packet_loss_pct": packet_loss_pct,
        "cpu_pct": None,
        "memory_pct": None,
        "bandwidth_in_mbps": None,
        "bandwidth_out_mbps": None,
        "interface_errors": 0,
    }


def ping_host(ip_address: str, count: int = 4, timeout_s: float = 1.0) -> dict:
    """Real ICMP probe of one IP address. Returns a raw sample dict in the
    same shape app/monitoring/simulator.py produces, so it is a drop-in
    replacement at the call site in collector.py regardless of which one
    actually ran."""
    if not ip_address:
        return _empty_sample()

    try:
        proc = subprocess.run(
            ["ping", "-c", str(count), "-W", str(max(1, int(timeout_s))), ip_address],
            capture_output=True,
            text=True,
            timeout=count * timeout_s + 3,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        # No `ping` binary, sandboxed network, or the probe itself hung --
        # that is a real "could not determine reachability" state, not the
        # same thing as a confirmed-down device, but it still has to
        # resolve to *something* for the rest of the pipeline, so it reads
        # as unreachable/100% loss rather than silently skipping the tick.
        return _empty_sample()

    output = proc.stdout or ""
    loss_match = _LOSS_RE.search(output)
    packet_loss_pct = float(loss_match.group(1)) if loss_match else 100.0

    reachable = packet_loss_pct < 100.0
    rtt_match = _RTT_RE.search(output) if reachable else None
    latency_ms = float(rtt_match.group(1)) if rtt_match else None

    return {
        "reachable": reachable,
        "latency_ms": latency_ms,
        "packet_loss_pct": packet_loss_pct,
        "cpu_pct": None,
        "memory_pct": None,
        "bandwidth_in_mbps": None,
        "bandwidth_out_mbps": None,
        "interface_errors": 0,
    }
