export type Role = "viewer" | "operator" | "admin";

export type DeviceStatus = "online" | "degraded" | "offline" | "unknown";

export interface Device {
  device_id: string;
  hostname: string;
  ip_address: string;
  device_type: string;
  vendor: string;
  site: string;
  owner: string;
  department: string;
  status: DeviceStatus;
  monitoring_method: string;
  latency_threshold_ms: number | null;
  packet_loss_threshold_pct: number | null;
  cpu_threshold_pct: number | null;
  memory_threshold_pct: number | null;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
  // present only on /api/topology nodes
  active_incidents?: string[];
  is_root_cause_of?: string[];
}

export interface MetricSample {
  id: number;
  device_id: string;
  timestamp: string;
  reachable: boolean;
  latency_ms: number | null;
  packet_loss_pct: number | null;
  cpu_pct: number | null;
  memory_pct: number | null;
  bandwidth_in_mbps: number | null;
  bandwidth_out_mbps: number | null;
  interface_errors: number;
  is_stale: boolean;
  is_valid: boolean;
  collector_healthy: boolean;
  validation_notes: string | null;
}

export interface TopologyLink {
  id: number;
  source_device_id: string;
  source_interface: string | null;
  destination_device_id: string;
  destination_interface: string | null;
  link_type: string;
  dependency_direction: string;
}

export interface TopologyResponse {
  nodes: Device[];
  edges: TopologyLink[];
}

export interface RankedCandidate {
  device_id: string;
  overall_score: number;
  confidence_label: "low" | "medium" | "high";
  coverage_pct: number;
  temporal_correlation_pct: number;
  health_contrast_pct: number;
  dependency_importance_pct: number;
  missing_evidence_penalty: number;
  has_direct_evidence: boolean;
}

export interface TimelineEntry {
  stage: string;
  timestamp: string;
  by?: string;
  manual?: boolean;
}

export interface OperatorNoteEntry {
  author: string;
  note: string;
  timestamp: string;
}

export type IncidentStatus =
  | "detected"
  | "investigating"
  | "acknowledged"
  | "recovering"
  | "resolved";

export type Severity = "critical" | "high" | "medium" | "low";

export interface Event {
  id: number;
  device_id: string;
  event_type: string;
  severity: Severity;
  timestamp: string;
  confidence: number;
  evidence: Record<string, unknown>;
  detection_source: "rule" | "baseline" | "ml";
  correlation_id: string | null;
  incident_id: string | null;
  status: "open" | "resolved";
  resolved_at: string | null;
}

export interface Incident {
  incident_id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  probable_root_cause_device_id: string | null;
  root_cause_confidence: number;
  root_cause_confidence_label: "low" | "medium" | "high";
  root_cause_score_breakdown: Record<string, number>;
  ranked_candidates: RankedCandidate[];
  affected_devices: string[];
  affected_services: string[];
  blast_radius: Record<string, unknown>;
  evidence: Record<string, unknown>;
  diagnosis_text: string;
  recommended_checks: string[];
  child_event_ids: number[];
  timeline: TimelineEntry[];
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  operator_notes: OperatorNoteEntry[];
  resolution: string | null;
  recovery_evidence: Record<string, unknown>;
  recovery_time_seconds: number | null;
  notified: boolean;
  created_at: string;
  detected_at: string;
  resolved_at: string | null;
  events?: Event[];
}

export interface Scenario {
  id: string;
  description: string;
}

export interface ActiveFault {
  scenario: string;
  target: string;
  started_at: string;
  affected_devices: string[];
}

export interface SimulatorState {
  collector_failure: boolean;
  active_faults: ActiveFault[];
  active_fault: ActiveFault | null;
}

export type PriorityLevel = "critical" | "high" | "medium" | "low" | "follow_up";

export interface PriorityItem {
  rank: number;
  device_id: string;
  device_type: string;
  status: DeviceStatus;
  priority_score: number;
  level: PriorityLevel;
  is_first_priority: boolean;
  is_root_cause: boolean;
  caused_by: string | null;
  problem: { type: string; title: string; summary: string; also_seen: string[]; since: string };
  impact: { summary: string; dependents: string[]; dependents_count: number };
  workload: { traffic_mbps: number | null; cpu_pct: number | null; capacity_mbps: number | null };
  score_breakdown: { impact: number; workload: number; severity: number; role: number };
  recommended_checks: string[];
  incident_ids: string[];
}

export interface PriorityResult {
  generated_at: string;
  collector_healthy: boolean;
  faulty_count: number;
  headline: string;
  why_first: string | null;
  weights?: { impact: number; workload: number; severity: number; role: number };
  ranked: PriorityItem[];
}

export interface CollectorHealth {
  is_healthy: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
}

export interface ReportSummary {
  network_health: { total_devices: number | null };
  incidents: {
    total: number;
    resolved: number;
    active: number;
    by_severity: Record<Severity, number>;
  };
  mttd_seconds: number | null;
  mtta_seconds: number | null;
  mttr_seconds: number | null;
  root_cause_accuracy_pct: number | null;
  false_positive_rate_pct: number | null;
  collector_reliability: CollectorHealth;
  notes: string;
}

export interface MlStatus {
  status: string;
  enabled: boolean;
  version: number | string | null;
  trained_at: string | null;
  n_samples: number | null;
  n_devices: number | null;
  features: string[] | null;
  contamination: number | null;
  anomaly_score_threshold: number | null;
  evaluation: Record<string, unknown> | null;
  last_error: string | null;
  training_data: Record<string, unknown>;
}

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  resource: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  ip_address: string | null;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface TickMessage {
  type: "tick" | "tick_error";
  timestamp?: string;
  collector_healthy?: boolean;
  device_status?: Record<string, DeviceStatus>;
  opened_events?: number;
  recovered_events?: number;
  incidents_created?: string[];
  incidents_updated?: string[];
  incidents_resolved?: string[];
  collector_health?: CollectorHealth;
}
