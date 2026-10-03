"""
Rule-based detection engine with persistence and hysteresis (spec
sections 8-9).

Every rule is deliberately simple and deterministic -- that is the point.
ML and baselines (app/detection/baseline.py, app/ml/) add the fuzzier
"this looks unusual" layer on top; this module handles "this is a known,
named bad condition" and never fires off a single noisy sample:

    1st bad poll  -> no incident
    2nd bad poll  -> warning / evaluation
    3rd bad poll  -> trigger event
    ... 3 consecutive good polls -> recover

Each (device, rule_type) pair gets its own small state machine so one
device's packet loss doesn't affect another device's CPU evaluation.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import Enum

from app.config import get_settings
from app.detection.baseline import BaselineReading

settings = get_settings()


class RuleType(str, Enum):
    UNREACHABLE = "unreachable"
    PACKET_LOSS = "packet_loss"
    HIGH_LATENCY = "high_latency"
    HIGH_CPU = "high_cpu"
    HIGH_MEMORY = "high_memory"
    BANDWIDTH_SATURATION = "bandwidth_saturation"


RULE_SEVERITY = {
    RuleType.UNREACHABLE: "critical",
    RuleType.PACKET_LOSS: "high",
    RuleType.HIGH_LATENCY: "medium",
    RuleType.HIGH_CPU: "medium",
    RuleType.HIGH_MEMORY: "medium",
    RuleType.BANDWIDTH_SATURATION: "medium",
}


@dataclass
class RuleState:
    consecutive_bad: int = 0
    consecutive_good: int = 0
    is_open: bool = False
    last_evidence: dict = field(default_factory=dict)


@dataclass
class RuleOutcome:
    rule_type: RuleType
    device_id: str
    transitioned_to: str  # "opened" | "still_open" | "evaluating" | "recovered" | "still_closed"
    severity: str
    evidence: dict


class RuleEngine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: dict[tuple[str, RuleType], RuleState] = {}

    def _get_state(self, device_id: str, rule_type: RuleType) -> RuleState:
        key = (device_id, rule_type)
        return self._state.setdefault(key, RuleState())

    def _evaluate(
        self,
        device_id: str,
        rule_type: RuleType,
        is_bad: bool,
        evidence: dict,
        fails_needed: int,
        recoveries_needed: int,
    ) -> RuleOutcome:
        with self._lock:
            state = self._get_state(device_id, rule_type)

            if is_bad:
                state.consecutive_bad += 1
                state.consecutive_good = 0
                state.last_evidence = evidence
                if state.is_open:
                    transition = "still_open"
                elif state.consecutive_bad >= fails_needed:
                    state.is_open = True
                    transition = "opened"
                else:
                    transition = "evaluating"
            else:
                state.consecutive_good += 1
                state.consecutive_bad = 0
                if state.is_open:
                    if state.consecutive_good >= recoveries_needed:
                        state.is_open = False
                        transition = "recovered"
                    else:
                        transition = "still_open"
                else:
                    transition = "still_closed"

            evidence_out = dict(evidence)
            evidence_out["consecutive_bad"] = state.consecutive_bad
            evidence_out["consecutive_good"] = state.consecutive_good

            return RuleOutcome(
                rule_type=rule_type,
                device_id=device_id,
                transitioned_to=transition,
                severity=RULE_SEVERITY[rule_type],
                evidence=evidence_out,
            )

    def evaluate_sample(
        self,
        device_id: str,
        reachable: bool,
        latency_ms: float | None,
        packet_loss_pct: float | None,
        cpu_pct: float | None,
        memory_pct: float | None,
        bandwidth_in_mbps: float | None,
        capacity_mbps: float | None,
        latency_baseline: BaselineReading | None,
        thresholds: dict,
    ) -> list[RuleOutcome]:
        """Run every rule against one sample. Returns one RuleOutcome per
        rule, regardless of whether anything changed -- callers filter
        for the transitions they care about (usually "opened" and
        "recovered")."""
        fails_needed = thresholds.get("consecutive_fails", settings.rule_consecutive_fails)
        recoveries_needed = thresholds.get("consecutive_recoveries", settings.rule_consecutive_recoveries)
        outcomes: list[RuleOutcome] = []

        outcomes.append(
            self._evaluate(
                device_id,
                RuleType.UNREACHABLE,
                is_bad=not reachable,
                evidence={"reachable": reachable},
                fails_needed=fails_needed,
                recoveries_needed=recoveries_needed,
            )
        )

        if reachable:
            loss_threshold = thresholds.get("packet_loss_pct", settings.rule_packet_loss_pct)
            if packet_loss_pct is not None:
                outcomes.append(
                    self._evaluate(
                        device_id,
                        RuleType.PACKET_LOSS,
                        is_bad=packet_loss_pct > loss_threshold,
                        evidence={"packet_loss_pct": packet_loss_pct, "threshold_pct": loss_threshold},
                        fails_needed=fails_needed,
                        recoveries_needed=recoveries_needed,
                    )
                )

            # Dynamic threshold: baseline median + headroom, floored by the
            # configured static threshold so a brand-new device with no
            # baseline yet still gets a sane cutoff.
            static_latency_threshold = thresholds.get("high_latency_ms", settings.rule_high_latency_ms)
            dynamic_threshold = static_latency_threshold
            if latency_baseline and latency_baseline.has_enough_data:
                dynamic_threshold = max(static_latency_threshold, latency_baseline.expected_high)
            if latency_ms is not None:
                outcomes.append(
                    self._evaluate(
                        device_id,
                        RuleType.HIGH_LATENCY,
                        is_bad=latency_ms > dynamic_threshold,
                        evidence={
                            "latency_ms": latency_ms,
                            "threshold_ms": round(dynamic_threshold, 1),
                            "baseline_expected_range": (
                                [latency_baseline.expected_low, latency_baseline.expected_high]
                                if latency_baseline and latency_baseline.has_enough_data
                                else None
                            ),
                        },
                        fails_needed=fails_needed,
                        recoveries_needed=recoveries_needed,
                    )
                )

            cpu_threshold = thresholds.get("high_cpu_pct", settings.rule_high_cpu_pct)
            if cpu_pct is not None:
                outcomes.append(
                    self._evaluate(
                        device_id,
                        RuleType.HIGH_CPU,
                        is_bad=cpu_pct > cpu_threshold,
                        evidence={"cpu_pct": cpu_pct, "threshold_pct": cpu_threshold},
                        fails_needed=fails_needed,
                        recoveries_needed=recoveries_needed,
                    )
                )

            mem_threshold = thresholds.get("high_memory_pct", settings.rule_high_memory_pct)
            if memory_pct is not None:
                outcomes.append(
                    self._evaluate(
                        device_id,
                        RuleType.HIGH_MEMORY,
                        is_bad=memory_pct > mem_threshold,
                        evidence={"memory_pct": memory_pct, "threshold_pct": mem_threshold},
                        fails_needed=fails_needed,
                        recoveries_needed=recoveries_needed,
                    )
                )

            if bandwidth_in_mbps is not None and capacity_mbps:
                utilization = 100.0 * bandwidth_in_mbps / capacity_mbps
                outcomes.append(
                    self._evaluate(
                        device_id,
                        RuleType.BANDWIDTH_SATURATION,
                        is_bad=utilization > 85.0,
                        evidence={"utilization_pct": round(utilization, 1), "threshold_pct": 85.0},
                        fails_needed=fails_needed,
                        recoveries_needed=recoveries_needed,
                    )
                )
        else:
            # Device unreachable: the rest of the per-metric rules have
            # nothing meaningful to evaluate against. Reset their state so
            # a recovering device doesn't instantly show a stale verdict.
            for rt in (
                RuleType.PACKET_LOSS,
                RuleType.HIGH_LATENCY,
                RuleType.HIGH_CPU,
                RuleType.HIGH_MEMORY,
                RuleType.BANDWIDTH_SATURATION,
            ):
                with self._lock:
                    self._state.pop((device_id, rt), None)

        return outcomes

    def is_open(self, device_id: str, rule_type: RuleType) -> bool:
        with self._lock:
            state = self._state.get((device_id, rule_type))
            return bool(state and state.is_open)


rule_engine = RuleEngine()
