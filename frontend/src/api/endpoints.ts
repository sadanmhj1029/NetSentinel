import { api } from "./client";
import type {
  AuditLogEntry,
  CollectorHealth,
  Device,
  Incident,
  MetricSample,
  MlStatus,
  PriorityResult,
  ReportSummary,
  Role,
  Scenario,
  SimulatorState,
  TopologyLink,
  TopologyResponse,
  User,
} from "../types";

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: Role;
  username: string;
}

export const AuthApi = {
  login: (username: string, password: string) =>
    api.postForm<LoginResponse>("/api/auth/login", { username, password }),
  me: () => api.get<{ id: number; username: string; role: Role; is_active: boolean; created_at: string }>(
    "/api/auth/me"
  ),
};

export interface DeviceCreateBody {
  device_id: string;
  hostname: string;
  ip_address: string;
  device_type: string;
  vendor?: string;
  site?: string;
  department?: string;
  monitoring_method?: string;
}

export const DevicesApi = {
  list: () => api.get<Device[]>("/api/devices"),
  get: (id: string) => api.get<Device>(`/api/devices/${encodeURIComponent(id)}`),
  create: (body: DeviceCreateBody) => api.post<Device>("/api/devices", body),
  update: (id: string, body: Partial<Device>) =>
    api.patch<Device>(`/api/devices/${encodeURIComponent(id)}`, body),
  deactivate: (id: string) => api.delete<{ status: string }>(`/api/devices/${encodeURIComponent(id)}`),
  metrics: (id: string, minutes = 30) =>
    api.get<{
      device: Device;
      samples: MetricSample[];
      latency_baseline: { median: number; sample_count: number } | null;
      ml_anomaly: {
        available: boolean;
        anomaly_score: number | null;
        is_anomalous: boolean;
        contributing_features: unknown;
      };
    }>(`/api/devices/${encodeURIComponent(id)}/metrics?minutes=${minutes}`),
};

export const TopologyApi = {
  get: () => api.get<TopologyResponse>("/api/topology"),
  createLink: (body: { source_device_id: string; destination_device_id: string; link_type?: string }) =>
    api.post<TopologyLink>("/api/topology/links", body),
  deleteLink: (id: number) => api.delete<{ status: string }>(`/api/topology/links/${id}`),
};

export const IncidentsApi = {
  list: (filters?: { status?: string; severity?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.severity) params.set("severity", filters.severity);
    const qs = params.toString();
    return api.get<Incident[]>(`/api/incidents${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => api.get<Incident>(`/api/incidents/${encodeURIComponent(id)}`),
  acknowledge: (id: string, note?: string) =>
    api.post<Incident>(`/api/incidents/${encodeURIComponent(id)}/acknowledge`, { note }),
  addNote: (id: string, note: string) =>
    api.post<Incident>(`/api/incidents/${encodeURIComponent(id)}/notes`, { note }),
  resolve: (id: string, resolution: string) =>
    api.post<Incident>(`/api/incidents/${encodeURIComponent(id)}/resolve`, { resolution }),
};

export const ScenariosApi = {
  list: () => api.get<{ scenarios: Scenario[]; state: SimulatorState }>("/api/scenarios"),
  start: (id: string, target?: string) =>
    api.post<{ scenario: string; status: string; target?: string | null }>(
      `/api/scenarios/${encodeURIComponent(id)}/start`,
      { target }
    ),
  stop: (id: string, target?: string) =>
    api.post<{ scenario: string; status: string }>(
      `/api/scenarios/${encodeURIComponent(id)}/stop`,
      target ? { target } : {}
    ),
};

export const CollectorApi = {
  health: () => api.get<CollectorHealth>("/api/collector/health"),
};

export const ReportsApi = {
  summary: () => api.get<ReportSummary>("/api/reports/summary"),
};

export const PriorityApi = {
  get: () => api.get<PriorityResult>("/api/priority"),
};

export const MlApi = {
  status: () => api.get<MlStatus>("/api/ml/status"),
  train: () => api.post<{ status: string; version: number; n_samples: number }>("/api/ml/train"),
  enable: () => api.post<{ enabled: boolean }>("/api/ml/enable"),
  disable: () => api.post<{ enabled: boolean }>("/api/ml/disable"),
};

export const AuditApi = {
  list: (limit = 200) => api.get<AuditLogEntry[]>(`/api/audit-logs?limit=${limit}`),
};

export const UsersApi = {
  list: () => api.get<User[]>("/api/users"),
  create: (body: { username: string; password: string; role: Role }) => api.post<User>("/api/users", body),
};

export interface DiscoveredDevice {
  ip_address: string;
  hostname: string;
  latency_ms: number;
  open_ports: number[];
  services: string[];
  suggested_device_type: string;
  suggested_device_id: string;
}

export interface DiscoveryScanResult {
  subnet: string;
  total_probed: number;
  live_count: number;
  duration_seconds: number;
  scanned_at: string;
  devices: DiscoveredDevice[];
}

export const DiscoveryApi = {
  status: () => api.get<{ is_scanning: boolean; last_result: DiscoveryScanResult | null }>("/api/discovery/status"),
  scan: (subnet = "192.168.1.0/24", timeout_sec = 0.6) =>
    api.post<DiscoveryScanResult>("/api/discovery/scan", { subnet, timeout_sec }),
  import: (devices: Partial<DiscoveredDevice>[], uplink_parent_id?: string) =>
    api.post<{ status: string; imported_count: number; imported_device_ids: string[] }>(
      "/api/discovery/import",
      { devices, uplink_parent_id }
    ),
};

export const SettingsApi = {
  getNotifications: () => api.get<Record<string, any>>("/api/settings/notifications"),
  testNotification: (custom_message?: string) =>
    api.post<{ status: string; delivered_via: string[]; message: string; channels: Record<string, any> }>(
      "/api/settings/notifications/test",
      { custom_message }
    ),
};

