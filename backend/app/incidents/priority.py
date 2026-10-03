"""
Fix-priority ranking: when several devices are faulty at once, which one
should an operator work on first, and what exactly is wrong with each?

Every faulty device gets a 0-100 priority score built from four parts,
each shown in the API response so the ranking is never a black box:

    impact    (35)  how many devices depend on it (downstream in the topology)
    workload  (25)  how much traffic it carries + how busy its CPU is
    severity  (25)  how bad the fault is (down > packet loss > congested > slow ...)
    role      (15)  how critical its role is (router > switch > server > pc)

Devices that are only failing *because* an upstream device is down are
marked as knock-on symptoms and sorted after the real problems: fixing
the upstream device fixes them, so they're not worth working on first.
"""
from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.correlation.topology_graph import ancestors, descendants, load_graph
from app.incidents.checks import EVENT_LABELS, checks_for
from app.models.device import Device
from app.models.event import Event
from app.models.incident import Incident
from app.models.interface import Interface
from app.models.metric import MetricSample
from app.utils import utcnow

WEIGHTS = {"impact": 35.0, "workload": 25.0, "severity": 25.0, "role": 15.0}

# How bad each kind of fault is, on its own, from 0 to 1.
SEVERITY_FACTOR: dict[str, float] = {
    "unreachable": 1.0,
    "interface_down": 0.9,
    "packet_loss": 0.75,
    "bandwidth_saturation": 0.7,
    "high_latency": 0.6,
    "high_cpu": 0.55,
    "high_memory": 0.45,
    "ml_anomaly": 0.35,
    "baseline_anomaly": 0.35,
}

ROLE_FACTOR: dict[str, float] = {"router": 1.0, "switch": 0.8, "server": 0.7, "service": 0.6, "pc": 0.3}

# How far back to look when working out a device's normal workload.
WORKLOAD_WINDOW = dt.timedelta(minutes=15)
WORKLOAD_SAMPLES = 120

# A knock-on symptom keeps only this share of its score, so it always
# sorts below the devices that actually need fixing.
SYMPTOM_DISCOUNT = 0.35


@dataclass
class _Workload:
    mbps: float | None = None  # average in + out traffic
    cpu_pct: float | None = None
    capacity_mbps: float | None = None


@dataclass
class _Candidate:
    device: Device
    events: list[Event]
    primary: Event
    latest: MetricSample | None
    workload: _Workload
    dependents: list[str]
    incident_ids: list[str] = field(default_factory=list)
    is_root_cause: bool = False
    caused_by: str | None = None
    parts: dict[str, float] = field(default_factory=dict)

    @property
    def score(self) -> float:
        raw = sum(self.parts.values())
        return raw * SYMPTOM_DISCOUNT if self.caused_by else raw


# --------------------------------------------------------------------------- #
# Data gathering
# --------------------------------------------------------------------------- #
def _workload(db: Session, device_id: str, capacity: float | None, now: dt.datetime) -> _Workload:
    """Average traffic and CPU over the device's recent *reachable*
    samples. For a device that is down right now this is what it was
    carrying before it failed, which is exactly the load now going
    unserved."""
    samples = (
        db.query(MetricSample)
        .filter(
            MetricSample.device_id == device_id,
            MetricSample.reachable.is_(True),
            MetricSample.timestamp >= now - WORKLOAD_WINDOW,
        )
        .order_by(MetricSample.timestamp.desc())
        .limit(WORKLOAD_SAMPLES)
        .all()
    )
    if not samples:
        # Nothing recent (e.g. it's been down a long time): fall back to
        # the last reachable samples whenever they were.
        samples = (
            db.query(MetricSample)
            .filter(MetricSample.device_id == device_id, MetricSample.reachable.is_(True))
            .order_by(MetricSample.timestamp.desc())
            .limit(WORKLOAD_SAMPLES)
            .all()
        )
    traffic = [(s.bandwidth_in_mbps or 0.0) + (s.bandwidth_out_mbps or 0.0) for s in samples]
    cpus = [s.cpu_pct for s in samples if s.cpu_pct is not None]
    return _Workload(
        mbps=sum(traffic) / len(traffic) if traffic else None,
        cpu_pct=sum(cpus) / len(cpus) if cpus else None,
        capacity_mbps=capacity,
    )


def _latest_sample(db: Session, device_id: str) -> MetricSample | None:
    return (
        db.query(MetricSample)
        .filter(MetricSample.device_id == device_id)
        .order_by(MetricSample.timestamp.desc())
        .first()
    )


# --------------------------------------------------------------------------- #
# Plain-language problem descriptions
# --------------------------------------------------------------------------- #
def _duration(since: dt.datetime, now: dt.datetime) -> str:
    secs = max(0, int((now - since).total_seconds()))
    if secs < 90:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60} min"
    return f"{secs // 3600}h {(secs % 3600) // 60}m"


def _describe(event: Event, device_id: str, latest: MetricSample | None, now: dt.datetime) -> str:
    ev = event.evidence or {}
    t = event.event_type
    if t == "unreachable":
        # No clock time here: the UI shows "since" in the viewer's own timezone.
        return f"{device_id} has stopped responding. It has missed every check for the last {_duration(event.timestamp, now)}."
    if t == "packet_loss":
        loss = latest.packet_loss_pct if latest and latest.packet_loss_pct is not None else ev.get("packet_loss_pct")
        limit = ev.get("threshold_pct")
        if loss is not None:
            tail = f" (the limit is {limit:.0f}%)" if limit is not None else ""
            return f"{device_id} is dropping {loss:.0f}% of its packets{tail}, so connections through it are unreliable."
    if t == "high_latency":
        lat = latest.latency_ms if latest and latest.latency_ms is not None else ev.get("latency_ms")
        rng = ev.get("baseline_expected_range")
        if lat is not None and rng:
            return (
                f"{device_id} is responding slowly: {lat:.0f} ms, when it normally answers "
                f"in about {rng[0]:.0f} to {rng[1]:.0f} ms."
            )
        if lat is not None:
            return f"{device_id} is responding slowly: {lat:.0f} ms (the limit is {ev.get('threshold_ms', 0):.0f} ms)."
    if t == "high_cpu":
        cpu = latest.cpu_pct if latest and latest.cpu_pct is not None else ev.get("cpu_pct")
        if cpu is not None:
            return f"{device_id}'s CPU is running at {cpu:.0f}% (the limit is {ev.get('threshold_pct', 0):.0f}%)."
    if t == "high_memory":
        mem = latest.memory_pct if latest and latest.memory_pct is not None else ev.get("memory_pct")
        if mem is not None:
            return f"{device_id} is using {mem:.0f}% of its memory (the limit is {ev.get('threshold_pct', 0):.0f}%)."
    if t == "bandwidth_saturation":
        util = ev.get("utilization_pct")
        if util is not None:
            return f"{device_id}'s link is {util:.0f}% full. Anything over 85% causes congestion and dropped traffic."
    if t == "ml_anomaly":
        score = ev.get("anomaly_score")
        feats = ev.get("contributing_features") or []
        what = f", mostly in {', '.join(str(f) for f in feats[:2])}" if feats else ""
        tail = f" (anomaly score {score:.0f})" if isinstance(score, (int, float)) else ""
        return f"{device_id}'s behaviour has drifted away from its normal pattern{what}{tail}."
    label = EVENT_LABELS.get(t, t.replace("_", " "))
    return f"{device_id} has an open '{label}' alert."


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _impact_sentence(c: _Candidate) -> str:
    if c.caused_by:
        return (
            f"This is a knock-on effect: {c.device.device_id} sits behind {c.caused_by}, which is down. "
            f"It should come back on its own once {c.caused_by} is fixed."
        )
    if c.dependents:
        n = len(c.dependents)
        return f"{n} device{'s' if n != 1 else ''} depend{'s' if n == 1 else ''} on it: {_join(sorted(c.dependents))}."
    return "No other devices depend on it, so the impact is limited to this device."


def _why_first(top: _Candidate, runner_up: _Candidate) -> str:
    """Explain, in plain words, why #1 beats #2."""
    a, b = top.device.device_id, runner_up.device.device_id
    reasons: list[str] = []

    sev_a = SEVERITY_FACTOR.get(top.primary.event_type, 0.3)
    sev_b = SEVERITY_FACTOR.get(runner_up.primary.event_type, 0.3)
    label_b = EVENT_LABELS.get(runner_up.primary.event_type, runner_up.primary.event_type).lower()
    if top.primary.event_type == "unreachable" and runner_up.primary.event_type != "unreachable":
        reasons.append(f"it is completely down, while {b} only has {label_b}")
    elif sev_a > sev_b:
        reasons.append(f"its fault is more serious than {b}'s {label_b}")

    if len(top.dependents) > len(runner_up.dependents):
        reasons.append(f"{len(top.dependents)} devices depend on it versus {len(runner_up.dependents)} for {b}")

    wa, wb = top.workload.mbps, runner_up.workload.mbps
    if wa is not None and wb is not None and wa > wb * 1.15:
        reasons.append(f"it carries more traffic ({wa:.0f} Mbps versus {wb:.0f} Mbps)")

    if ROLE_FACTOR.get(top.device.device_type, 0.5) > ROLE_FACTOR.get(runner_up.device.device_type, 0.5):
        reasons.append(f"a {top.device.device_type} is more central to the network than a {runner_up.device.device_type}")

    if not reasons:
        reasons.append("its combined impact, workload and severity score is higher")
    return f"Fix {a} before {b}: " + "; ".join(reasons[:3]) + "."


# --------------------------------------------------------------------------- #
# Main entry point
# --------------------------------------------------------------------------- #
def compute_priorities(db: Session, collector_healthy: bool = True, now: dt.datetime | None = None) -> dict:
    now = now or utcnow()
    if not collector_healthy:
        return {
            "generated_at": now.isoformat(),
            "collector_healthy": False,
            "faulty_count": 0,
            "headline": "Monitoring is interrupted, so device faults can't be ranked right now.",
            "why_first": None,
            "ranked": [],
        }

    devices = {d.device_id: d for d in db.query(Device).filter(Device.is_active.is_(True)).all()}
    open_events = db.query(Event).filter(Event.status == "open").all()
    events_by_device: dict[str, list[Event]] = {}
    for e in open_events:
        if e.device_id in devices:
            events_by_device.setdefault(e.device_id, []).append(e)

    if not events_by_device:
        return {
            "generated_at": now.isoformat(),
            "collector_healthy": True,
            "faulty_count": 0,
            "headline": "No faulty devices. Nothing to fix right now.",
            "why_first": None,
            "ranked": [],
        }

    graph = load_graph(db)
    capacities = {i.device_id: i.capacity_mbps for i in db.query(Interface).all()}
    active_incidents = db.query(Incident).filter(Incident.status != "resolved").all()

    candidates: list[_Candidate] = []
    for device_id, events in events_by_device.items():
        primary = max(events, key=lambda e: (SEVERITY_FACTOR.get(e.event_type, 0.3), -e.timestamp.timestamp()))
        c = _Candidate(
            device=devices[device_id],
            events=events,
            primary=primary,
            latest=_latest_sample(db, device_id),
            workload=_workload(db, device_id, capacities.get(device_id), now),
            dependents=sorted(d for d in descendants(graph, device_id) if d in devices),
            incident_ids=[i.incident_id for i in active_incidents if device_id in (i.affected_devices or [])],
            is_root_cause=any(i.probable_root_cause_device_id == device_id for i in active_incidents),
        )
        candidates.append(c)

    # Knock-on symptoms: down/lossy only because an upstream device is down.
    down = {c.device.device_id for c in candidates if c.primary.event_type == "unreachable"}
    for c in candidates:
        if c.is_root_cause:
            continue
        upstream_down = [a for a in ancestors(graph, c.device.device_id) if a in down]
        if upstream_down and c.primary.event_type in ("unreachable", "packet_loss", "high_latency"):
            # Nearest one = the one with the most ancestors of its own.
            c.caused_by = max(upstream_down, key=lambda a: len(ancestors(graph, a)))

    # Normalisers: biggest fan-out in the whole network, busiest device's traffic.
    max_fan_out = max((len(descendants(graph, d)) for d in devices), default=1) or 1
    busiest = max(
        (w for w in (_workload(db, d, None, now).mbps for d in devices) if w), default=1.0
    ) or 1.0

    for c in candidates:
        impact = math.sqrt(len(c.dependents) / max_fan_out)
        traffic_share = min(1.0, (c.workload.mbps or 0.0) / busiest)
        cpu_share = min(1.0, (c.workload.cpu_pct or 0.0) / 100.0)
        workload = 0.7 * traffic_share + 0.3 * cpu_share
        severity = SEVERITY_FACTOR.get(c.primary.event_type, 0.3)
        role = ROLE_FACTOR.get(c.device.device_type, 0.5)
        c.parts = {
            "impact": round(WEIGHTS["impact"] * impact, 1),
            "workload": round(WEIGHTS["workload"] * workload, 1),
            "severity": round(WEIGHTS["severity"] * severity, 1),
            "role": round(WEIGHTS["role"] * role, 1),
        }

    candidates.sort(key=lambda c: (c.caused_by is not None, -c.score))
    real = [c for c in candidates if not c.caused_by]

    ranked = []
    for rank, c in enumerate(candidates, start=1):
        score = round(c.score, 1)
        if c.caused_by:
            level = "follow_up"
        elif score >= 65:
            level = "critical"
        elif score >= 45:
            level = "high"
        elif score >= 30:
            level = "medium"
        else:
            level = "low"
        others = [e for e in c.events if e is not c.primary]
        since = min(e.timestamp for e in c.events)
        ranked.append(
            {
                "rank": rank,
                "device_id": c.device.device_id,
                "device_type": c.device.device_type,
                "status": c.device.status,
                "priority_score": score,
                "level": level,
                "is_first_priority": rank == 1 and not c.caused_by,
                "is_root_cause": c.is_root_cause,
                "caused_by": c.caused_by,
                "problem": {
                    "type": c.primary.event_type,
                    "title": EVENT_LABELS.get(c.primary.event_type, c.primary.event_type),
                    "summary": _describe(c.primary, c.device.device_id, c.latest, now),
                    "also_seen": [EVENT_LABELS.get(e.event_type, e.event_type) for e in others],
                    "since": since.isoformat(),
                },
                "impact": {
                    "summary": _impact_sentence(c),
                    "dependents": c.dependents,
                    "dependents_count": len(c.dependents),
                },
                "workload": {
                    "traffic_mbps": round(c.workload.mbps, 1) if c.workload.mbps is not None else None,
                    "cpu_pct": round(c.workload.cpu_pct, 1) if c.workload.cpu_pct is not None else None,
                    "capacity_mbps": c.workload.capacity_mbps,
                },
                "score_breakdown": c.parts,
                "recommended_checks": checks_for([c.primary.event_type] + [e.event_type for e in others]),
                "incident_ids": c.incident_ids,
            }
        )

    top = candidates[0]
    if top.caused_by:
        headline = f"{len(candidates)} devices are affected, all knock-on effects of {top.caused_by}."
    elif len(real) == 1:
        extra = len(candidates) - 1
        tail = f" The other {extra} affected device{'s' if extra != 1 else ''} should recover once it's fixed." if extra else ""
        headline = f"Fix {top.device.device_id} first: {_describe(top.primary, top.device.device_id, top.latest, now)}{tail}"
    else:
        headline = (
            f"{len(real)} separate problems found. Start with {top.device.device_id} "
            f"({EVENT_LABELS.get(top.primary.event_type, top.primary.event_type).lower()})."
        )

    return {
        "generated_at": now.isoformat(),
        "collector_healthy": True,
        "faulty_count": len(candidates),
        "headline": headline,
        "why_first": _why_first(real[0], real[1]) if len(real) >= 2 else None,
        "weights": WEIGHTS,
        "ranked": ranked,
    }
