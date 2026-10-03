import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bell, ChevronDown, LogOut, Search, Server, Settings, Siren, Users, ScrollText } from "lucide-react";
import { cn } from "../../lib/utils";
import { describeLiveEvent, greeting, timeAgo, TONE_DOT } from "../../lib/format";
import { useAuth } from "../../store/AuthContext";
import { useLive } from "../../store/LiveContext";
import { SeverityBadge } from "../Badges";
import { Initials } from "./Sidebar";
import type { Device, Incident } from "../../types";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onOutside, active]);
}

function Popover({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className={cn(
            "absolute right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-stone-200/70 bg-white shadow-xl shadow-stone-900/10",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --------------------------------------------------------------------------- //
// Global search: devices + incidents
// --------------------------------------------------------------------------- //
interface SearchResult {
  key: string;
  to: string;
  title: string;
  sub: string;
  kind: "device" | "incident";
  incident?: Incident;
}

function GlobalSearch({ devices, incidents, surface }: { devices: Device[]; incidents: Incident[]; surface: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false), open);

  // "/" focuses search from anywhere (unless typing in a field already).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo<SearchResult[]>(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const d: SearchResult[] = devices
      .filter((x) => [x.device_id, x.hostname, x.ip_address, x.device_type].some((v) => v?.toLowerCase().includes(term)))
      .slice(0, 5)
      .map((x) => ({
        key: `d-${x.device_id}`,
        to: `/devices/${x.device_id}`,
        title: x.device_id,
        sub: `${x.device_type} · ${x.ip_address} · ${x.status}`,
        kind: "device" as const,
      }));
    const i: SearchResult[] = incidents
      .filter((x) =>
        [x.incident_id, x.title, x.probable_root_cause_device_id ?? ""].some((v) => v.toLowerCase().includes(term)),
      )
      .slice(0, 5)
      .map((x) => ({
        key: `i-${x.incident_id}`,
        to: `/incidents/${x.incident_id}`,
        title: `${x.incident_id} · ${x.title}`,
        sub: `${x.status} · root cause ${x.probable_root_cause_device_id ?? "investigating"}`,
        kind: "incident" as const,
        incident: x,
      }));
    return [...d, ...i];
  }, [q, devices, incidents]);

  function go(to: string) {
    navigate(to);
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1 sm:w-72 sm:flex-none lg:w-80">
      <label className={cn("flex h-11 items-center gap-2 rounded-full px-4 focus-within:ring-2 focus-within:ring-brand-orange/40", surface)}>
        <Search className="h-4 w-4 text-stone-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setCursor((c) => Math.min(c + 1, results.length - 1));
            if (e.key === "ArrowUp") setCursor((c) => Math.max(c - 1, 0));
            if (e.key === "Enter" && results[cursor]) go(results[cursor].to);
            if (e.key === "Escape") {
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search devices or incidents"
          className="min-w-0 flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-500"
        />
        <kbd className="hidden rounded border border-stone-200 px-1.5 text-[10px] text-stone-400 sm:block">/</kbd>
      </label>
      <Popover open={open && q.trim().length > 0} className="left-0 right-auto w-full">
        {results.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">No devices or incidents match “{q}”.</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1.5">
            {results.map((r, idx) => (
              <li key={r.key}>
                <button
                  onMouseEnter={() => setCursor(idx)}
                  onClick={() => go(r.to)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left",
                    idx === cursor ? "bg-stone-100" : "hover:bg-stone-50",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600">
                    {r.kind === "device" ? <Server className="h-4 w-4" /> : <Siren className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-stone-900">{r.title}</span>
                    <span className="block truncate text-xs capitalize text-stone-500">{r.sub}</span>
                  </span>
                  {r.incident && <SeverityBadge severity={r.incident.severity} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Notifications: active incidents + live events
// --------------------------------------------------------------------------- //
function Notifications({ active, surface }: { active: Incident[]; surface: string }) {
  const { events, unread, markAllRead } = useLive();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const count = unread;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o);
          markAllRead();
        }}
        aria-label={`Notifications${count ? `, ${count} new` : ""}`}
        className={cn("relative flex h-11 w-11 items-center justify-center rounded-full text-stone-700 hover:text-stone-900", surface)}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.9} />
        {(count > 0 || active.length > 0) && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ring-2 ring-shell",
              active.length ? "bg-red-500" : "bg-brand-orange",
            )}
          >
            {count > 0 ? (count > 99 ? "99+" : count) : active.length}
          </span>
        )}
      </button>
      <Popover open={open} className="w-[22rem]">
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <span className="text-sm font-semibold text-stone-900">Notifications</span>
          <Link to="/incidents" onClick={() => setOpen(false)} className="text-xs font-medium text-brand-orange-ink hover:underline">
            View Active Incidents
          </Link>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {active.length > 0 && (
            <div className="px-2 pt-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Needs attention</div>
              {active.map((i) => (
                <Link
                  key={i.incident_id}
                  to={`/incidents/${i.incident_id}`}
                  onClick={() => setOpen(false)}
                  className="flex items-start gap-3 rounded-xl px-2 py-2 hover:bg-stone-50"
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-stone-900">{i.title}</span>
                    <span className="block text-xs text-stone-500">
                      {i.incident_id} · {i.status} · {i.affected_devices.length} device(s)
                    </span>
                  </span>
                  <SeverityBadge severity={i.severity} />
                </Link>
              ))}
            </div>
          )}
          <div className="px-2 py-2">
            <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Recent activity</div>
            {events.length === 0 ? (
              <p className="px-2 py-3 text-sm text-stone-500">Nothing new since you opened NetSentinel.</p>
            ) : (
              events.slice(0, 25).map((e) => {
                const d = describeLiveEvent(e);
                return (
                  <div key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-1.5">
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", TONE_DOT[d.tone])} />
                    <span className="flex-1 text-sm text-stone-700">{d.text}</span>
                    <span className="shrink-0 text-[11px] text-stone-400">{timeAgo(e.at)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </Popover>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Profile menu
// --------------------------------------------------------------------------- //
function ProfileMenu({ surface }: { surface: string }) {
  const { username, role, logout, hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const item = "flex w-full items-center gap-2.5 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("flex h-11 items-center gap-2 rounded-full pl-1 pr-3", surface)}
        aria-label="Account menu"
      >
        <Initials name={username ?? "?"} className="h-9 w-9 text-xs" />
        <span className="hidden text-left lg:block">
          <span className="block text-sm font-medium leading-tight text-stone-900">{username}</span>
          <span className="block text-[11px] capitalize leading-tight text-stone-500">{role}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-stone-400" />
      </button>
      <Popover open={open} className="w-56 py-1.5">
        <Link to="/settings" onClick={() => setOpen(false)} className={item}>
          <Settings className="h-4 w-4" /> Settings
        </Link>
        {hasRole("admin") && (
          <>
            <Link to="/users" onClick={() => setOpen(false)} className={item}>
              <Users className="h-4 w-4" /> Manage Users
            </Link>
            <Link to="/audit" onClick={() => setOpen(false)} className={item}>
              <ScrollText className="h-4 w-4" /> View Audit Log
            </Link>
          </>
        )}
        <div className="my-1 border-t border-stone-100" />
        <button onClick={logout} className={cn(item, "text-red-600")}>
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </Popover>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// Header
// --------------------------------------------------------------------------- //
/** Search, notifications, profile and the context CTA. `onGlass` swaps solid pills for translucent ones. */
export function HeaderControls({
  devices,
  incidents,
  onGlass = false,
}: {
  devices: Device[];
  incidents: Incident[];
  onGlass?: boolean;
}) {
  const active = incidents.filter((i) => i.status !== "resolved");
  const surface = onGlass ? "bg-white/55 ring-1 ring-inset ring-white/70" : "bg-white shadow-card";
  return (
    <div className="flex w-full items-center gap-2.5 xl:w-auto">
      <GlobalSearch devices={devices} incidents={incidents} surface={surface} />
      <Notifications active={active} surface={surface} />
      <ProfileMenu surface={surface} />
      <Link
        to={active.length ? "/incidents" : "/topology"}
        className="hidden h-11 shrink-0 items-center rounded-full bg-ink px-5 text-sm font-medium text-white hover:bg-ink-soft 2xl:flex"
      >
        {active.length ? `View Active Incidents (${active.length})` : "View Network Topology"}
      </Link>
    </div>
  );
}

export function Header({
  devices,
  incidents,
  controlsInline = true,
}: {
  devices: Device[];
  incidents: Incident[];
  controlsInline?: boolean;
}) {
  const { username } = useAuth();
  const { lastTick } = useLive();
  const active = incidents.filter((i) => i.status !== "resolved");
  const collectorDown = lastTick?.type === "tick" && lastTick.collector_healthy === false;

  const counts = { online: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const d of devices) counts[d.status]++;
  const rootCause = active.find((i) => i.probable_root_cause_device_id)?.probable_root_cause_device_id;

  let tone: "good" | "warn" | "bad" = "good";
  let summary: string;
  if (collectorDown) {
    tone = "warn";
    summary = "Monitoring interrupted: device data is going stale, so new faults can't be confirmed.";
  } else if (active.length) {
    tone = "bad";
    const parts = [`${active.length} active incident${active.length > 1 ? "s" : ""}`];
    if (counts.offline) parts.push(`${counts.offline} offline`);
    if (counts.degraded) parts.push(`${counts.degraded} degraded`);
    summary = parts.join(" · ") + (rootCause ? ` · probable root cause ${rootCause}` : "");
  } else if (counts.degraded || counts.offline) {
    tone = "warn";
    summary = `${counts.offline} offline, ${counts.degraded} degraded. Waiting for confirmation before raising an incident.`;
  } else {
    summary = devices.length
      ? `All ${devices.length} devices healthy · collector polling normally`
      : "Loading network status…";
  }

  const name = username ? username.charAt(0).toUpperCase() + username.slice(1) : "";

  return (
    <header className="relative z-30 flex flex-col gap-4 px-4 pb-4 pt-5 md:px-8 md:pt-7 xl:flex-row xl:items-center xl:justify-between">
      <div className={cn("min-w-0", !controlsInline && "max-w-[calc(100%-46rem)] 2xl:max-w-[calc(100%-56rem)]")}>
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900 md:text-[28px]">
          {greeting()}, {name}!
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-stone-500">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "animate-pulse bg-red-500",
            )}
          />
          <span className="truncate">{summary}</span>
        </p>
      </div>
      {controlsInline && <HeaderControls devices={devices} incidents={incidents} />}
    </header>
  );
}
