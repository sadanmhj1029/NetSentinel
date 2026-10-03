import type { Incident } from "../../types";

export type StageState = "done" | "current" | "pending" | "skipped";

export interface Stage {
  key: string;
  label: string;
  state: StageState;
  at: string | null;
  detail: string;
}

/**
 * NetSentinel's pipeline for one incident, derived only from fields the
 * incident already carries:
 * Detection → Correlation → Root-Cause Analysis → Alert → Acknowledgement → Recovery
 */
export function incidentStages(inc: Incident): Stage[] {
  const stageAt = (name: string) => inc.timeline.find((t) => t.stage === name)?.timestamp ?? null;
  const resolved = inc.status === "resolved";
  const recovering = inc.status === "recovering" || !!stageAt("recovering");

  const raw: Omit<Stage, "state">[] = [
    {
      key: "detection",
      label: "Detection",
      at: inc.detected_at,
      detail: `${inc.child_event_ids.length || inc.events?.length || 1} fault event(s) confirmed after repeated failed polls`,
    },
    {
      key: "correlation",
      label: "Correlation",
      at: inc.created_at,
      detail: `${inc.affected_devices.length} device(s) grouped by topology into one incident`,
    },
    {
      key: "rca",
      label: "Root-Cause Analysis",
      at: inc.probable_root_cause_device_id ? inc.created_at : null,
      detail: inc.probable_root_cause_device_id
        ? `${inc.probable_root_cause_device_id} ranked most likely (${inc.root_cause_confidence_label} confidence)`
        : "Still ranking candidates",
    },
    {
      key: "alert",
      label: "Alert",
      at: inc.notified ? inc.created_at : null,
      detail: inc.notified ? "Notification sent to on-call" : "Not sent yet",
    },
    {
      key: "ack",
      label: "Acknowledgement",
      at: inc.acknowledged_at,
      detail: inc.acknowledged
        ? `Acknowledged by ${inc.acknowledged_by ?? "operator"}`
        : resolved
          ? "Recovered before anyone acknowledged it"
          : "Waiting for an operator",
    },
    {
      key: "recovery",
      label: "Recovery",
      at: inc.resolved_at ?? stageAt("recovering"),
      detail: resolved
        ? `Resolved${inc.recovery_time_seconds != null ? ` in ${Math.round(inc.recovery_time_seconds)}s` : ""}`
        : recovering
          ? "Healthy polls coming back, verifying recovery"
          : "Fault still active",
    },
  ];

  const done = [
    true,
    inc.affected_devices.length > 0,
    !!inc.probable_root_cause_device_id,
    inc.notified,
    inc.acknowledged,
    resolved,
  ];

  let currentAssigned = false;
  return raw.map((s, i) => {
    let state: StageState;
    if (done[i]) state = "done";
    else if (s.key === "ack" && resolved) state = "skipped";
    else if (!currentAssigned) {
      state = "current";
      currentAssigned = true;
    } else state = "pending";
    return { ...s, state };
  });
}

export function stageProgress(inc: Incident): { done: number; total: number; current: string | null } {
  const stages = incidentStages(inc);
  return {
    done: stages.filter((s) => s.state === "done" || s.state === "skipped").length,
    total: stages.length,
    current: stages.find((s) => s.state === "current")?.label ?? null,
  };
}
