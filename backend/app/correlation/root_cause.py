"""
Root-cause scoring (spec section 13-14): turn a set of simultaneous,
topologically-related failures into a ranked list of probable causes with
a transparent, inspectable score -- never a bare "trust me" confidence
number.

    overall_score = 0.35*coverage + 0.25*temporal_correlation
                  + 0.20*health_contrast + 0.20*dependency_importance
                  - missing_evidence_penalty

Every component is 0-100 and is returned alongside the total so the
incident detail page can show its breakdown exactly like the spec's
worked example (Switch-02: coverage 92%, temporal 96%, ...).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import networkx as nx

from app.config import get_settings
from app.correlation.topology_graph import ancestors, descendants, fan_out, parents

settings = get_settings()

WEIGHTS = {"coverage": 0.35, "temporal": 0.25, "health_contrast": 0.20, "dependency": 0.20}
MISSING_EVIDENCE_PENALTY = 20.0


@dataclass
class AffectedDevice:
    device_id: str
    first_bad_at: dt.datetime
    event_types: list[str] = field(default_factory=list)


@dataclass
class RankedCandidate:
    device_id: str
    overall_score: float
    confidence_label: str
    coverage_pct: float
    temporal_correlation_pct: float
    health_contrast_pct: float
    dependency_importance_pct: float
    missing_evidence_penalty: float
    has_direct_evidence: bool

    def to_dict(self) -> dict:
        return {
            "device_id": self.device_id,
            "overall_score": round(self.overall_score, 1),
            "confidence_label": self.confidence_label,
            "coverage_pct": round(self.coverage_pct, 1),
            "temporal_correlation_pct": round(self.temporal_correlation_pct, 1),
            "health_contrast_pct": round(self.health_contrast_pct, 1),
            "dependency_importance_pct": round(self.dependency_importance_pct, 1),
            "missing_evidence_penalty": round(self.missing_evidence_penalty, 1),
            "has_direct_evidence": self.has_direct_evidence,
        }


def _confidence_label(score: float) -> str:
    if score >= settings.root_cause_high_confidence:
        return "high"
    if score >= settings.root_cause_medium_confidence:
        return "medium"
    return "low"


def candidate_pool(graph: nx.DiGraph, affected: dict[str, AffectedDevice]) -> set[str]:
    """Every affected device, plus every ancestor of every affected
    device, is a plausible root-cause candidate."""
    pool: set[str] = set(affected.keys())
    for device_id in list(affected.keys()):
        pool |= ancestors(graph, device_id)
    return pool


def score_candidates(
    graph: nx.DiGraph, affected: dict[str, AffectedDevice]
) -> list[RankedCandidate]:
    if not affected:
        return []

    affected_ids = set(affected.keys())
    pool = candidate_pool(graph, affected)
    if not pool:
        pool = affected_ids

    max_fan_out = max((fan_out(graph, c) for c in pool), default=0) or 1

    results: list[RankedCandidate] = []
    for candidate in pool:
        candidate_descendants = descendants(graph, candidate)
        covered = affected_ids & (candidate_descendants | {candidate})
        coverage = 100.0 * len(covered) / len(affected_ids) if affected_ids else 0.0

        has_direct_evidence = candidate in affected
        other_affected = [a for a in affected.values() if a.device_id != candidate]

        if has_direct_evidence and other_affected:
            candidate_time = affected[candidate].first_bad_at
            deltas = [
                abs((other.first_bad_at - candidate_time).total_seconds())
                for other in other_affected
                if other.device_id in candidate_descendants
            ]
            if deltas:
                avg_delta = sum(deltas) / len(deltas)
                temporal = max(0.0, 100.0 * (1 - avg_delta / settings.correlation_time_window_seconds))
                # Reward the candidate failing *before* its descendants,
                # penalize it failing after (that would mean it's a
                # symptom, not the cause).
                candidate_first = all(other.first_bad_at >= candidate_time for other in other_affected if other.device_id in candidate_descendants)
                if not candidate_first:
                    temporal *= 0.4
            else:
                temporal = 50.0
        elif has_direct_evidence:
            temporal = 70.0  # only node affected, nothing to correlate against
        else:
            temporal = 30.0  # purely inferred from topology, no timing evidence of its own

        candidate_parents = parents(graph, candidate)
        parents_healthy = not any(p in affected_ids for p in candidate_parents)
        if has_direct_evidence and parents_healthy:
            health_contrast = 90.0
        elif has_direct_evidence:
            health_contrast = 40.0  # candidate's own parent is also affected -- ambiguous
        else:
            health_contrast = 20.0  # no direct evidence this node is unhealthy at all

        dependency_importance = 100.0 * fan_out(graph, candidate) / max_fan_out

        missing_evidence_penalty = 0.0 if has_direct_evidence else MISSING_EVIDENCE_PENALTY

        overall = (
            WEIGHTS["coverage"] * coverage
            + WEIGHTS["temporal"] * temporal
            + WEIGHTS["health_contrast"] * health_contrast
            + WEIGHTS["dependency"] * dependency_importance
            - missing_evidence_penalty
        )
        overall = max(0.0, min(100.0, overall))

        results.append(
            RankedCandidate(
                device_id=candidate,
                overall_score=overall,
                confidence_label=_confidence_label(overall),
                coverage_pct=coverage,
                temporal_correlation_pct=temporal,
                health_contrast_pct=health_contrast,
                dependency_importance_pct=dependency_importance,
                missing_evidence_penalty=missing_evidence_penalty,
                has_direct_evidence=has_direct_evidence,
            )
        )

    results.sort(key=lambda r: r.overall_score, reverse=True)
    return results


def build_diagnosis_text(
    top: RankedCandidate, affected: dict[str, AffectedDevice], graph: nx.DiGraph
) -> str:
    """Plain-language, evidence-citing narrative -- spec section 14
    explicitly forbids a vague AI statement here."""
    root_time = affected[top.device_id].first_bad_at if top.device_id in affected else None
    downstream = [a for a in affected.values() if a.device_id != top.device_id]
    downstream_names = [a.device_id for a in downstream]

    parts: list[str] = []
    if root_time:
        parts.append(f"{top.device_id} became unreachable at {root_time.strftime('%H:%M:%S')}.")
    else:
        parts.append(
            f"{top.device_id} was not directly observed as unhealthy, but every affected "
            f"device depends on it in the topology."
        )

    if downstream_names:
        if len(downstream_names) == 1:
            listing = downstream_names[0]
        else:
            listing = ", ".join(downstream_names[:-1]) + f" and {downstream_names[-1]}"
        earliest = min(a.first_bad_at for a in downstream)
        latest = max(a.first_bad_at for a in downstream)
        spread = (latest - earliest).total_seconds()
        parts.append(
            f"{listing} became unreachable within "
            f"{'the same second' if spread < 1 else f'{spread:.0f} seconds'} of each other."
        )

    healthy_parents = [p for p in parents(graph, top.device_id) if p not in affected]
    if healthy_parents:
        parts.append(f"{', '.join(healthy_parents)} remained healthy throughout.")

    parts.append(
        f"Because the affected devices depend on {top.device_id} and it failed before "
        f"(or coincides with) the downstream symptoms, {top.device_id} is ranked as the "
        f"probable root cause with {top.confidence_label} confidence "
        f"(score {top.overall_score:.0f}/100)."
    )
    return " ".join(parts)
