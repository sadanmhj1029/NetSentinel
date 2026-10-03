import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, CheckCircle2, LogOut, Mail, MessageSquare, ScrollText, Send, Terminal, Users, Webhook } from "lucide-react";
import { Button, Card, Switch } from "../components/Card";
import { Initials } from "../components/shell/Sidebar";
import { API_BASE_URL } from "../api/client";
import { CollectorApi, SettingsApi } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { glassAvailable, glassEnabledPref, scheduleSnapshotRefresh, setGlassEnabledPref } from "../lib/liquidGlass";
import type { CollectorHealth } from "../types";

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
  const [channels, setChannels] = useState<Record<string, any> | null>(null);
  const [testingAlert, setTestingAlert] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
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

  useEffect(() => {
    CollectorApi.health().then(setCollector).catch(() => {});
    SettingsApi.getNotifications().then(setChannels).catch(() => {});
  }, []);

  async function handleTestAlert() {
    setTestingAlert(true);
    setTestResult(null);
    try {
      const res = await SettingsApi.testNotification("Verification alert sent from Settings UI");
      setTestResult(`Delivered via: ${res.delivered_via.join(", ")}`);
    } catch {
      setTestResult("Failed to dispatch test notification.");
    } finally {
      setTestingAlert(false);
    }
  }

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
        </Card>

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

        <Card title="Alert Notification Channels">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
              <div className="flex items-center gap-3">
                <Terminal className="h-5 w-5 text-stone-500" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Console / Stdout</div>
                  <div className="text-xs text-stone-500">Live logs in backend runtime</div>
                </div>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Active</span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
              <div className="flex items-center gap-3">
                <Webhook className="h-5 w-5 text-stone-500" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Slack / Teams Webhook</div>
                  <div className="text-xs text-stone-500 truncate max-w-xs">{channels?.webhook?.target ?? "Configured via NOTIFY_WEBHOOK_URL"}</div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${channels?.webhook?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>
                {channels?.webhook?.enabled ? "Configured" : "Unset"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-stone-500" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Email (SMTP Alerts)</div>
                  <div className="text-xs text-stone-500">{channels?.email?.enabled ? `Host: ${channels.email.host}` : "Set SMTP_HOST & NOTIFY_EMAIL_ENABLED"}</div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${channels?.email?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>
                {channels?.email?.enabled ? "Active" : "Unset"}
              </span>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
              <div className="flex items-center gap-3">
                <MessageSquare className="h-5 w-5 text-stone-500" />
                <div>
                  <div className="text-sm font-medium text-stone-900">Telegram Bot</div>
                  <div className="text-xs text-stone-500">{channels?.telegram?.enabled ? "Bot token & Chat ID set" : "Set NOTIFY_TELEGRAM_BOT_TOKEN"}</div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${channels?.telegram?.enabled ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}>
                {channels?.telegram?.enabled ? "Active" : "Unset"}
              </span>
            </div>

            {hasRole("operator") && (
              <div className="pt-2">
                <Button onClick={handleTestAlert} disabled={testingAlert} variant="secondary" className="w-full justify-center gap-2">
                  <Send className="h-4 w-4" />
                  {testingAlert ? "Dispatching test alert…" : "Dispatch Test Alert Across Channels"}
                </Button>
                {testResult && (
                  <p className="mt-2 text-center text-xs font-medium text-brand-orange-ink">{testResult}</p>
                )}
              </div>
            )}
          </div>
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
