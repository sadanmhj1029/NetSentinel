"""Static copy used to build the Incident Detail page's "Recommended
First Check" list (spec section 18) from whatever event types are
present on the incident."""

RECOMMENDED_CHECKS: dict[str, list[str]] = {
    "unreachable": ["Check device power", "Check uplink interface", "Check recent configuration changes"],
    "packet_loss": ["Check interface errors", "Check cabling / uplink quality", "Check upstream connectivity"],
    "high_latency": ["Check upstream connectivity", "Check for routing changes", "Check CPU load on path devices"],
    "high_cpu": ["Check running processes/services", "Check for traffic spikes", "Check recent configuration changes"],
    "high_memory": ["Check for memory leaks in running services", "Check recent configuration changes"],
    "bandwidth_saturation": [
        "Check for traffic spikes or large transfers",
        "Check interface capacity planning",
        "Check QoS configuration",
    ],
    "ml_anomaly": [
        "Review contributing metrics in the evidence panel",
        "Compare the current value against its adaptive baseline",
        "Check for unlabeled/undocumented configuration changes",
    ],
}

EVENT_LABELS: dict[str, str] = {
    "unreachable": "Unreachable",
    "packet_loss": "Packet Loss",
    "high_latency": "High Latency",
    "high_cpu": "High CPU",
    "high_memory": "High Memory",
    "bandwidth_saturation": "Bandwidth Saturation",
    "ml_anomaly": "Anomaly (ML)",
}


def checks_for(event_types: list[str]) -> list[str]:
    seen: list[str] = []
    for et in event_types:
        for check in RECOMMENDED_CHECKS.get(et, []):
            if check not in seen:
                seen.append(check)
    return seen[:5]
