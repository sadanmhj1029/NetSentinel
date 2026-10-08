import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, Keyboard, LogOut, ScrollText, Users, Volume2 } from "lucide-react";
import { Card, Switch } from "../components/Card";
import { Initials } from "../components/shell/Sidebar";
import { API_BASE_URL } from "../api/client";
import { CollectorApi } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { glassAvailable, glassEnabledPref, scheduleSnapshotRefresh, setGlassEnabledPref } from "../lib/liquidGlass";
import type { CollectorHealth } from "../types";
import { SystemStatusCard } from "../components/settings/SystemStatusCard";
import {
  alertNewIncidents,
  desktopPermission,
  desktopSupported,
  getAlertPrefs,
  playChime,
  requestDesktopPermission,
  setAlertPrefs,
} from "../lib/alerts";

const LIVE_FEED_PREF_KEY = "netsentinel:showLiveFeed";

const ROLE_CAN: Record<string, string[]> = {
  viewer: ["See every dashboard, topology, incident and report"],
  operator: [
    "Everything a viewer can",
    "Acknowledge, annotate and resolve incidents",
    "Run fault-injection scenarios",
  ],
  admin: [
    "Everything an operator can",
    "Add, edit and deactivate devices and topology links",
    "Train and enable the anomaly model",
    "Manage users and read the audit log",
  ],
};

export function SettingsPage() {
  const { username, role, logout, hasRole } = useAuth();
  const { connected } = useLive();
  const [collector, setCollector] = useState<CollectorHealth | null>(null);
  const [streamDefault, setStreamDefault] = useState(() => {
    try {
      return localStorage.getItem(LIVE_FEED_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [glassOn, setGlassOn] = useState(glassEnabledPref);
  const canGlass = glassAvailable();

  function setGlass(v: boolean) {
    setGlassOn(v);
    setGlassEnabledPref(v);
    if (v) scheduleSnapshotRefresh(600, true); // the old snapshot may be stale
  }

  const [alerts, setAlerts] = useState(getAlertPrefs);
  const [permission, setPermission] = useState(desktopPermission);

  async function setDesktop(on: boolean) {
    if (on) {
      const p = await requestDesktopPermission();
      setPermission(p);
      if (p !== "granted") return; // browser said no; leave the switch off
    }
    const next = { ...alerts, desktop: on };
    setAlerts(next);
    setAlertPrefs(next);
  }
  function setSound(on: boolean) {
    const next = { ...alerts, sound: on };
    setAlerts(next);
    setAlertPrefs(next);
    if (on) playChime();
  }

  useEffect(() => {
    CollectorApi.health().then(setCollector).catch(() => {});
  }, []);

  function setStream(v: boolean) {
    setStreamDefault(v);
    try {
      localStorage.setItem(LIVE_FEED_PREF_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-stone-900">Settings</h2>
        <p className="text-sm text-stone-500">Your account, display preferences and connection details.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card title="Account">
          <div className="flex items-center gap-4">
            <Initials name={username ?? "?"} className="h-14 w-14 text-lg" />
            <div>
              <div className="text-lg font-semibold text-stone-900">{username}</div>
              <div className="text-sm capitalize text-stone-500">{role}</div>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-stone-50 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-stone-500">What your role can do</div>
            <ul className="mt-2 space-y-1 text-sm text-stone-700">
              {(ROLE_CAN[role ?? "viewer"] ?? []).map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-orange" /> {line}
                </li>
              ))}
            </ul>
          </div>
          <button
            onClick={logout}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </Card>

        <Card title="Display">
          <div className="flex items-center justify-between gap-4 py-2">
            <div>
              <div className="text-sm font-medium text-stone-900">Live event stream on by default</div>
              <div className="text-xs text-stone-500">Shows detections and recoveries as they happen on the dashboard timeline.</div>
            </div>
            <Switch checked={streamDefault} onChange={setStream} />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-stone-100 py-2 pt-3">
            <div>
              <div className="text-sm font-medium text-stone-900">Liquid glass effects</div>
              <div className="text-xs text-stone-500">
                {canGlass
                  ? "Real glass on the header bar, health score and phone menu. Turn off on slow computers."
                  : "Not available in this browser (needs WebGL). A frosted look is used instead."}
              </div>
            </div>
            <Switch checked={canGlass && glassOn} onChange={canGlass ? setGlass : () => {}} />
          </div>
          <div className="mt-2 flex items-start gap-3 rounded-2xl bg-stone-50 p-3 text-xs text-stone-600">
            <Keyboard className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
            <span>
              Keyboard shortcuts: press <kbd className="rounded border border-stone-300 bg-white px-1 font-mono">?</kbd> anywhere for the list,{" "}
              <kbd className="rounded border border-stone-300 bg-white px-1 font-mono">/</kbd> to search, and{" "}
              <kbd className="rounded border border-stone-300 bg-white px-1 font-mono">g</kbd> then a letter to jump between pages.
            </span>
          </div>
        </Card>

        <Card title="Alerts" subtitle="Get told about new incidents even when this tab isn't in front">
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="flex items-start gap-3">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
              <div>
                <div className="text-sm font-medium text-stone-900">Desktop notifications</div>
                <div className="text-xs text-stone-500">
                  {!desktopSupported()
                    ? "This browser doesn't support notifications."
                    : permission === "denied"
                      ? "Blocked in your browser. Allow notifications for this site in the address bar, then try again."
                      : "A pop-up for every new incident. Click it to open the incident."}
                </div>
              </div>
            </div>
            <Switch checked={alerts.desktop && permission === "granted"} onChange={setDesktop} />
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-stone-100 py-2 pt-3">
            <div className="flex items-start gap-3">
              <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-stone-500" />
              <div>
                <div className="text-sm font-medium text-stone-900">Sound</div>
                <div className="text-xs text-stone-500">A short chime for new incidents, a sharper one for critical ones.</div>
              </div>
            </div>
            <Switch checked={alerts.sound} onChange={setSound} />
          </div>
          <button
            onClick={() =>
              alertNewIncidents([{ incident_id: "TEST-0000", title: "Test alert from NetSentinel", severity: "critical", root_cause: "Switch-02" }])
            }
            disabled={!alerts.desktop && !alerts.sound}
            className="mt-3 rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50 disabled:opacity-40"
          >
            Send a test alert
          </button>
          <p className="mt-3 text-xs text-stone-500">
            The tab title also shows a count, like “(2) NetSentinel”, when incidents arrive while you're on another tab.
          </p>
        </Card>

        <SystemStatusCard />

        <Card title="Connection">
          <dl className="divide-y divide-stone-100 text-sm">
            {[
              ["Live updates", connected ? "Connected" : "Reconnecting…"],
              ["Collector", collector ? (collector.is_healthy ? "Polling normally" : "Interrupted") : "…"],
              ["Polling success", collector ? `${collector.polling_success_rate_pct.toFixed(1)}%` : "…"],
              ["API", API_BASE_URL],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2.5">
                <dt className="text-stone-500">{k}</dt>
                <dd className="truncate text-right font-medium text-stone-900">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {hasRole("admin") && (
          <Card title="Administration">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Link to="/users" className="flex items-center gap-3 rounded-2xl bg-stone-50 p-4 hover:bg-stone-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-brand-orange">
                  <Users className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-stone-900">Manage Users</span>
                  <span className="block text-xs text-stone-500">Add accounts and set roles</span>
                </span>
              </Link>
              <Link to="/audit" className="flex items-center gap-3 rounded-2xl bg-stone-50 p-4 hover:bg-stone-100">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-brand-orange">
                  <ScrollText className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-stone-900">View Audit Log</span>
                  <span className="block text-xs text-stone-500">Every change, who made it, when</span>
                </span>
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
