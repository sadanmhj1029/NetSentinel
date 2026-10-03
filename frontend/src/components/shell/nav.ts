import {
  BarChart3,
  BrainCircuit,
  FileText,
  FlaskConical,
  LayoutDashboard,
  Network,
  Server,
  Settings,
  Siren,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "../../types";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  minRole?: Role;
  badge?: "incidents";
}

/** Grouped like the reference: each group renders as one rounded pill in the sidebar. */
export const NAV_GROUPS: NavItem[][] = [
  [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/devices", label: "Devices", icon: Server },
    { to: "/topology", label: "Network Topology", icon: Network },
    { to: "/incidents", label: "Active Incidents", icon: Siren, badge: "incidents" },
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
  ],
  [
    { to: "/scenarios", label: "Fault Injection", icon: FlaskConical, minRole: "operator" },
    { to: "/ml", label: "AI / Anomaly Detection", icon: BrainCircuit, minRole: "admin" },
    { to: "/reports", label: "Reports", icon: FileText },
  ],
  [{ to: "/settings", label: "Settings", icon: Settings }],
];
