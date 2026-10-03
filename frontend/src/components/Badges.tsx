import type { DeviceStatus, IncidentStatus, Severity } from "../types";

const STATUS_STYLES: Record<DeviceStatus, string> = {
  online: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  offline: "bg-red-500/15 text-red-600 ring-red-500/30",
  unknown: "bg-stone-500/15 text-stone-600 ring-stone-500/30",
};

export function StatusBadge({ status }: { status: DeviceStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-red-500/15 text-red-600 ring-red-500/30",
  high: "bg-orange-500/15 text-orange-700 ring-orange-500/30",
  medium: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  low: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}

const INCIDENT_STATUS_STYLES: Record<IncidentStatus, string> = {
  detected: "bg-red-500/15 text-red-600 ring-red-500/30",
  investigating: "bg-orange-500/15 text-orange-700 ring-orange-500/30",
  acknowledged: "bg-amber-500/15 text-amber-700 ring-amber-500/30",
  recovering: "bg-sky-500/15 text-sky-700 ring-sky-500/30",
  resolved: "bg-emerald-500/15 text-emerald-600 ring-emerald-500/30",
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${INCIDENT_STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "text-emerald-600",
  medium: "text-amber-700",
  low: "text-stone-500",
};

export function ConfidenceLabel({ label }: { label: string }) {
  return <span className={`font-medium ${CONFIDENCE_STYLES[label] ?? "text-stone-500"}`}>{label}</span>;
}
