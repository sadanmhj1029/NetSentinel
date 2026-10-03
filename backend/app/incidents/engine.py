"""
The orchestrator: ties the collector, rule engine, adaptive baselines, ML
scoring, topology correlation and incident lifecycle into the single
pipeline the spec keeps insisting on (section 41):

    Simulated Network -> Telemetry Collection -> Data Validation ->
    Metric Storage -> Rule Detection -> Adaptive Baseline ->
    ML Anomaly Detection -> Topology Correlation -> Root-Cause Scoring ->
    Incident Creation -> Dashboard -> Notification -> Recovery Detection
    -> Resolution

One call to `engine.process_tick(db)` runs exactly one pass of this
pipeline over whatever the collector just wrote. It is deliberately a
plain synchronous function (no asyncio) so it is easy to unit test and
easy to call from a background thread in app/scheduler.py.
"""
from __future__ import annotations

import datetime as dt
import logging

from app.utils import utcnow
from dataclasses import dataclass, field

import networkx as nx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.correlation.root_cause import AffectedDevice, build_diagnosis_text, score_candidates
from app.correlation.topology_graph import ancestors, load_graph
from app.detection.baseline import baseline_store
from app.detection.rules import RuleEngine, RuleType, rule_engine
from app.incidents.checks import EVENT_LABELS, checks_for
from app.ml.infer import score_device
from app.ml.model_store import model_store
from app.models.device import Device
from app.models.event import Event
from app.models.incident import Incident
from app.models.interface import Interface
from app.monitoring.collector import collector
from app.services.notifications import send_incident_notification

logger = logging.getLogger("netsentinel.engine")
settings = get_settings()

SEVERITY_RANK = {"critical": 3, "high": 2, "medium": 1, "low": 0}


@dataclass
class MLTrackerState:
    consecutive_anomalous: int = 0
    consecutive_normal: int = 0
    is_open: bool = False


@dataclass
class TickSummary:
    timestamp: str
    collector_healthy: bool
    device_status: dict[str, str] = field(default_factory=dict)
    opened_events: list[dict] = field(default_factory=list)
    recovered_events: list[dict] = field(default_factory=list)
    incidents_created: list[dict] = field(default_factory=list)
    incidents_updated: list[dict] = field(default_factory=list)
    incidents_resolved: list[dict] = field(default_factory=list)
    pending_notifications: list[dict] = field(default_factory=list)


class IncidentEngine:
    def __init__(self) -> None:
        self._next_number = 1
        self._ml_tracker: dict[str, MLTrackerState] = {}
        # incident_id -> device_ids considered part of its active cluster
        # as of the last tick where it had any.
        self._incident_members: dict[str, set[str]] = {}
        self._empty_ticks: dict[str, int] = {}
        self._initialized = False

    def _ensure_initialized(self, db: Session) -> None:
        if self._initialized:
            return
        existing = db.query(Incident.incident_id).all()
        max_n = 0
        for (incident_id,) in existing:
            try:
                n = int(incident_id.split("-")[-1])
                max_n = max(max_n, n)
            except (ValueError, IndexError):
                continue
        self._next_number = max_n + 1
        for incident in db.query(Incident).filter(Incident.status != "resolved").all():
            self._incident_members[incident.incident_id] = set(incident.affected_devices or [])
        self._initialized = True

    def _next_incident_id(self) -> str:
        incident_id = f"INC-{self._next_number:04d}"
        self._next_number += 1
        return incident_id

    # ------------------------------------------------------------------ #
    # Main entry point
    # ------------------------------------------------------------------ #
    def process_tick(self, db: Session, now: dt.datetime | None = None) -> TickSummary:
        self._ensure_initialized(db)
        now = now or utcnow()
        summary = TickSummary(timestamp=now.isoformat(), collector_healthy=collector.health.is_healthy)

        if not collector.health.is_healthy:
            # Spec section 7: a collector outage must never be read as a
            # mass device-down event. Freeze detection state entirely and
            # just surface the degraded monitoring status.
            for device in db.query(Device).filter(Device.is_active.is_(True)).all():
                device.status = "unknown"
                summary.device_status[device.device_id] = "unknown"
            db.commit()
            return summary

        devices = db.query(Device).filter(Device.is_active.is_(True)).all()
        interfaces_by_device = {
            i.device_id: i for i in db.query(Interface).all()
        }

        for device in devices:
            latest = self._run_device_pipeline(db, device, interfaces_by_device.get(device.device_id), now, summary)
            summary.device_status[device.device_id] = latest

        db.commit()

        self._run_correlation_and_incidents(db, now, summary)
        return summary

    # ------------------------------------------------------------------ #
    # Per-device: baseline + rules + ML
    # ------------------------------------------------------------------ #
    def _run_device_pipeline(
        self, db: Session, device: Device, interface: Interface | None, now: dt.datetime, summary: TickSummary
    ) -> str:
        from app.models.metric import MetricSample

        sample = (
            db.query(MetricSample)
            .filter(MetricSample.device_id == device.device_id)
            .order_by(MetricSample.timestamp.desc())
            .first()
        )
        if sample is None:
            return "unknown"

        latency_baseline = None
        if sample.reachable:
            if sample.latency_ms is not None:
                latency_baseline = baseline_store.evaluate(device.device_id, "latency_ms", sample.latency_ms)
            if sample.cpu_pct is not None:
                baseline_store.evaluate(device.device_id, "cpu_pct", sample.cpu_pct)
            if sample.bandwidth_in_mbps is not None:
                baseline_store.evaluate(device.device_id, "bandwidth_in_mbps", sample.bandwidth_in_mbps)

        thresholds = {
            "consecutive_fails": settings.rule_consecutive_fails,
            "consecutive_recoveries": settings.rule_consecutive_recoveries,
            "packet_loss_pct": device.packet_loss_threshold_pct or settings.rule_packet_loss_pct,
            "high_latency_ms": device.latency_threshold_ms or settings.rule_high_latency_ms,
            "high_cpu_pct": device.cpu_threshold_pct or settings.rule_high_cpu_pct,
            "high_memory_pct": device.memory_threshold_pct or settings.rule_high_memory_pct,
        }
        capacity = interface.capacity_mbps if interface else None

        outcomes = rule_engine.evaluate_sample(
            device_id=device.device_id,
            reachable=sample.reachable,
            latency_ms=sample.latency_ms,
            packet_loss_pct=sample.packet_loss_pct,
            cpu_pct=sample.cpu_pct,
            memory_pct=sample.memory_pct,
            bandwidth_in_mbps=sample.bandwidth_in_mbps,
            capacity_mbps=capacity,
            latency_baseline=latency_baseline,
            thresholds=thresholds,
        )

        any_open_rule = False
        for outcome in outcomes:
            if outcome.transitioned_to == "opened":
                event = Event(
                    device_id=device.device_id,
                    event_type=outcome.rule_type.value,
                    severity=outcome.severity,
                    timestamp=now,
                    confidence=90.0,
                    evidence=outcome.evidence,
                    detection_source="rule",
                    status="open",
                )
                db.add(event)
                summary.opened_events.append({"device_id": device.device_id, "event_type": outcome.rule_type.value})
                any_open_rule = True
            elif outcome.transitioned_to == "recovered":
                open_event = (
                    db.query(Event)
                    .filter(
                        Event.device_id == device.device_id,
                        Event.event_type == outcome.rule_type.value,
                        Event.status == "open",
                    )
                    .order_by(Event.timestamp.desc())
                    .first()
                )
                if open_event:
                    open_event.status = "resolved"
                    open_event.resolved_at = now
                summary.recovered_events.append({"device_id": device.device_id, "event_type": outcome.rule_type.value})
            elif outcome.transitioned_to == "still_open":
                any_open_rule = True

        self._run_ml(db, device.device_id, now, summary)

        if rule_engine.is_open(device.device_id, RuleType.UNREACHABLE):
            status = "offline"
        elif any_open_rule:
            status = "degraded"
        else:
            status = "online"
        device.status = status
        return status

    def _run_ml(self, db: Session, device_id: str, now: dt.datetime, summary: TickSummary) -> None:
        if not model_store.is_ready():
            return
        result = score_device(db, device_id)
        if not result.available:
            return

        state = self._ml_tracker.setdefault(device_id, MLTrackerState())
        if result.is_anomalous:
            state.consecutive_anomalous += 1
            state.consecutive_normal = 0
        else:
            state.consecutive_normal += 1
            state.consecutive_anomalous = 0

        if not state.is_open and state.consecutive_anomalous >= 2:
            state.is_open = True
            db.add(
                Event(
                    device_id=device_id,
                    event_type="ml_anomaly",
                    severity="medium",
                    timestamp=now,
                    confidence=min(99.0, result.anomaly_score),
                    evidence={
                        "anomaly_score": result.anomaly_score,
                        "threshold": result.threshold,
                        "contributing_features": result.contributing_features,
                    },
                    detection_source="ml",
                    status="open",
                )
            )
            summary.opened_events.append({"device_id": device_id, "event_type": "ml_anomaly"})
        elif state.is_open and state.consecutive_normal >= 2:
            state.is_open = False
            open_event = (
                db.query(Event)
                .filter(Event.device_id == device_id, Event.event_type == "ml_anomaly", Event.status == "open")
                .order_by(Event.timestamp.desc())
                .first()
            )
            if open_event:
                open_event.status = "resolved"
                open_event.resolved_at = now
            summary.recovered_events.append({"device_id": device_id, "event_type": "ml_anomaly"})

    # ------------------------------------------------------------------ #
    # Correlation + incident lifecycle
    # ------------------------------------------------------------------ #
    def _run_correlation_and_incidents(self, db: Session, now: dt.datetime, summary: TickSummary) -> None:
        graph = load_graph(db)
        open_events = db.query(Event).filter(Event.status == "open").all()

        affected: dict[str, AffectedDevice] = {}
        event_ids_by_device: dict[str, list[int]] = {}
        for event in open_events:
            event_ids_by_device.setdefault(event.device_id, []).append(event.id)
            if event.device_id not in affected:
                affected[event.device_id] = AffectedDevice(event.device_id, event.timestamp, [event.event_type])
            else:
                a = affected[event.device_id]
                if event.timestamp < a.first_bad_at:
                    a.first_bad_at = event.timestamp
                if event.event_type not in a.event_types:
                    a.event_types.append(event.event_type)

        clusters = self._cluster(graph, set(affected.keys()))

        matched_incident_ids: set[str] = set()
        for cluster_devices in clusters:
            cluster_affected = {d: affected[d] for d in cluster_devices if d in affected}
            if not cluster_affected:
                continue
            ranked = score_candidates(graph, cluster_affected)
            if not ranked:
                continue

            cluster_event_ids = [eid for d in cluster_affected for eid in event_ids_by_device.get(d, [])]

            existing_id = self._find_matching_incident(db, cluster_affected.keys())
            if existing_id:
                self._update_incident(db, existing_id, graph, cluster_affected, ranked, now, summary, cluster_event_ids)
                matched_incident_ids.add(existing_id)
            else:
                new_id = self._create_incident(db, graph, cluster_affected, ranked, now, summary, cluster_event_ids)
                matched_incident_ids.add(new_id)

        self._advance_recoveries(db, matched_incident_ids, now, summary)
        db.commit()

    def _cluster(self, graph: nx.DiGraph, affected_ids: set[str]) -> list[set[str]]:
        """Group affected devices that share a common ancestor in the
        topology into one cluster, so two unrelated simultaneous faults
        in different branches become two separate incidents instead of
        one. Ancestor nodes are only used to *discover* the link; the
        returned sets contain affected devices only."""
        if not affected_ids:
            return []
        nodes = set(affected_ids)
        for d in affected_ids:
            nodes |= ancestors(graph, d)
        induced = graph.subgraph(nodes).to_undirected()

        merged: list[set[str]] = []
        seen: set[str] = set()
        for node in nodes:
            if node in seen:
                continue
            comp = nx.node_connected_component(induced, node)
            seen |= comp
            affected_in_comp = comp & affected_ids
            if affected_in_comp:
                merged.append(affected_in_comp)
        return merged

    def _find_matching_incident(self, db: Session, device_ids) -> str | None:
        device_ids = set(device_ids)
        for incident_id, members in self._incident_members.items():
            if members & device_ids:
                incident = db.get(Incident, incident_id)
                if incident and incident.status != "resolved":
                    return incident_id
        return None

    def _build_common_fields(self, graph, cluster_affected, ranked, now):
        top = ranked[0]
        affected_device_ids = sorted(cluster_affected.keys())
        all_event_types = sorted({et for a in cluster_affected.values() for et in a.event_types})
        severity = max(
            (self._event_severity(et) for et in all_event_types), key=lambda s: SEVERITY_RANK[s], default="low"
        )
        diagnosis = build_diagnosis_text(top, cluster_affected, graph)
        descendants_of_top = {
            d for d in affected_device_ids if d != top.device_id
        }
        primary_type = cluster_affected.get(top.device_id)
        type_label = EVENT_LABELS.get(primary_type.event_types[0], "Network") if primary_type else "Network"
        title = (
            f"{top.device_id} Network Failure"
            if "unreachable" in (primary_type.event_types if primary_type else [])
            else f"{top.device_id} {type_label}"
        )
        return {
            "title": title,
            "severity": severity,
            "diagnosis": diagnosis,
            "ranked": [r.to_dict() for r in ranked[:5]],
            "affected_device_ids": affected_device_ids,
            "blast_radius": {
                "root_cause": top.device_id,
                "downstream_count": len(descendants_of_top),
                "downstream_devices": sorted(descendants_of_top),
            },
            "checks": checks_for(all_event_types),
            "all_event_types": all_event_types,
        }

    @staticmethod
    def _event_severity(event_type: str) -> str:
        from app.detection.rules import RULE_SEVERITY, RuleType

        try:
            return RULE_SEVERITY[RuleType(event_type)]
        except ValueError:
            return "medium"

    def _create_incident(self, db, graph, cluster_affected, ranked, now, summary, event_ids: list[int]) -> str:
        fields = self._build_common_fields(graph, cluster_affected, ranked, now)
        incident_id = self._next_incident_id()
        top = ranked[0]

        incident = Incident(
            incident_id=incident_id,
            title=fields["title"],
            severity=fields["severity"],
            status="detected",
            probable_root_cause_device_id=top.device_id,
            root_cause_confidence=top.overall_score,
            root_cause_confidence_label=top.confidence_label,
            root_cause_score_breakdown=top.to_dict(),
            ranked_candidates=fields["ranked"],
            affected_devices=fields["affected_device_ids"],
            affected_services=[],
            blast_radius=fields["blast_radius"],
            evidence={
                "event_types": fields["all_event_types"],
                "cluster_members": {d: a.event_types for d, a in cluster_affected.items()},
            },
            diagnosis_text=fields["diagnosis"],
            recommended_checks=fields["checks"],
            child_event_ids=event_ids,
            timeline=[{"stage": "detected", "timestamp": now.isoformat()}],
            created_at=now,
            detected_at=now,
        )
        db.add(incident)
        db.flush()
        db.query(Event).filter(Event.id.in_(event_ids)).update(
            {"incident_id": incident_id, "correlation_id": incident_id}, synchronize_session=False
        )

        self._incident_members[incident_id] = set(cluster_affected.keys())
        self._empty_ticks[incident_id] = 0

        notification = send_incident_notification(incident.to_dict())
        incident.notified = True
        summary.pending_notifications.append(notification)
        summary.incidents_created.append(incident.to_dict())
        return incident_id

    def _update_incident(self, db, incident_id, graph, cluster_affected, ranked, now, summary, event_ids: list[int]) -> None:
        incident = db.get(Incident, incident_id)
        if incident is None:
            return
        fields = self._build_common_fields(graph, cluster_affected, ranked, now)
        top = ranked[0]

        previous_members = self._incident_members.get(incident_id, set())
        merged_affected = sorted(set(incident.affected_devices or []) | set(cluster_affected.keys()))

        incident.probable_root_cause_device_id = top.device_id
        incident.root_cause_confidence = top.overall_score
        incident.root_cause_confidence_label = top.confidence_label
        incident.root_cause_score_breakdown = top.to_dict()
        incident.ranked_candidates = fields["ranked"]
        incident.affected_devices = merged_affected
        incident.blast_radius = fields["blast_radius"]
        incident.evidence = {
            "event_types": fields["all_event_types"],
            "cluster_members": {d: a.event_types for d, a in cluster_affected.items()},
        }
        incident.diagnosis_text = fields["diagnosis"]
        incident.recommended_checks = fields["checks"]
        incident.child_event_ids = sorted(set((incident.child_event_ids or []) + event_ids))
        if incident.status == "detected":
            incident.status = "acknowledged" if incident.acknowledged else "investigating"

        db.query(Event).filter(Event.id.in_(event_ids)).update(
            {"incident_id": incident_id, "correlation_id": incident_id}, synchronize_session=False
        )

        self._incident_members[incident_id] = set(cluster_affected.keys())
        self._empty_ticks[incident_id] = 0
        summary.incidents_updated.append(incident.to_dict())

    def _advance_recoveries(self, db, matched_ids: set[str], now: dt.datetime, summary: TickSummary) -> None:
        for incident_id in list(self._incident_members.keys()):
            if incident_id in matched_ids:
                continue
            incident = db.get(Incident, incident_id)
            if incident is None or incident.status == "resolved":
                self._incident_members.pop(incident_id, None)
                self._empty_ticks.pop(incident_id, None)
                continue

            self._empty_ticks[incident_id] = self._empty_ticks.get(incident_id, 0) + 1

            if incident.status != "recovering":
                incident.status = "recovering"
                incident.timeline = (incident.timeline or []) + [
                    {"stage": "recovering", "timestamp": now.isoformat()}
                ]
                incident.recovery_evidence = {
                    "note": "All member devices passed their consecutive-good-poll recovery check.",
                    "observed_at": now.isoformat(),
                }
            elif self._empty_ticks[incident_id] >= 2:
                incident.status = "resolved"
                incident.resolved_at = now
                incident.recovery_time_seconds = (now - incident.detected_at).total_seconds()
                incident.resolution = incident.resolution or "Automatically resolved after verified recovery."
                incident.timeline = (incident.timeline or []) + [
                    {"stage": "resolved", "timestamp": now.isoformat()}
                ]
                summary.incidents_resolved.append(incident.to_dict())
                self._incident_members.pop(incident_id, None)
                self._empty_ticks.pop(incident_id, None)


engine = IncidentEngine()
