import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card, Button } from "../components/Card";
import { StatusBadge } from "../components/Badges";
import { DevicesApi } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { ApiError } from "../api/client";
import { MaintenanceBadge } from "../components/system/Maintenance";
import { FilterBar } from "../components/FilterBar";
import { downloadCsv, stamp, toCsv } from "../lib/csv";
import type { Device } from "../types";

const DEVICE_TYPES = ["router", "switch", "server", "pc", "service"];

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ device_id: "", hostname: "", ip_address: "", device_type: "pc" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { hasRole } = useAuth();
  const { tickVersion, maintenanceCover } = useLive();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (devices ?? []).filter(
      (d) =>
        (statusFilter === "all" || d.status === statusFilter) &&
        (!q || [d.device_id, d.hostname, d.ip_address, d.device_type, d.site].some((v) => v?.toLowerCase().includes(q)))
    );
  }, [devices, query, statusFilter]);

  function exportCsv() {
    const csv = toCsv(visible, [
      { header: "Device", value: (d) => d.device_id },
      { header: "Hostname", value: (d) => d.hostname },
      { header: "Type", value: (d) => d.device_type },
      { header: "IP", value: (d) => d.ip_address },
      { header: "Site", value: (d) => d.site },
      { header: "Department", value: (d) => d.department },
      { header: "Status", value: (d) => d.status },
      { header: "Maintenance", value: (d) => (maintenanceCover[d.device_id] ? `yes (${maintenanceCover[d.device_id]})` : "") },
      { header: "Last seen", value: (d) => (d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "") },
    ]);
    downloadCsv(`netsentinel-devices-${stamp()}.csv`, csv);
  }

  async function refresh() {
    setDevices(await DevicesApi.list());
  }

  useEffect(() => {
    refresh();
  }, [tickVersion]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await DevicesApi.create(form);
      setForm({ device_id: "", hostname: "", ip_address: "", device_type: "pc" });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create device");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Devices</h1>
          <p className="text-sm text-stone-500">Everything the collector polls, simulated or real.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportCsv} variant="secondary" disabled={!visible.length}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          {hasRole("admin") && (
            <Button onClick={() => setShowForm((v) => !v)} variant="secondary">
              {showForm ? "Cancel" : "Add device"}
            </Button>
          )}
        </div>
      </div>

      {showForm && (
        <Card title="New device">
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <input
              required
              placeholder="Device ID (e.g. PC-05)"
              value={form.device_id}
              onChange={(e) => setForm({ ...form, device_id: e.target.value })}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
            />
            <input
              required
              placeholder="Hostname"
              value={form.hostname}
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
            />
            <input
              required
              placeholder="IP address"
              value={form.ip_address}
              onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
            />
            <select
              value={form.device_type}
              onChange={(e) => setForm({ ...form, device_type: e.target.value })}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
            >
              {DEVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="col-span-2 md:col-span-4">
              {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating…" : "Create device"}
              </Button>
              <p className="mt-2 text-xs text-stone-500">
                Note: this device won't be on the seeded topology map until a link is added for it; it will still
                be polled and monitored with generic baseline thresholds.
              </p>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Filter by name, IP, type or site"
          options={["all", "online", "degraded", "offline", "unknown"]}
          value={statusFilter}
          onChange={setStatusFilter}
          count={visible.length}
          total={devices?.length ?? 0}
        />
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Site / dept</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <tr key={d.device_id} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <Link to={`/devices/${d.device_id}`} className="font-medium text-brand-orange-ink hover:underline">
                      {d.device_id}
                    </Link>
                    <div className="text-xs text-stone-500">{d.hostname}</div>
                  </td>
                  <td className="px-3 py-2.5 text-stone-700">{d.device_type}</td>
                  <td className="px-3 py-2.5 text-stone-500">{d.ip_address}</td>
                  <td className="px-3 py-2.5 text-stone-500">
                    {d.site} / {d.department}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={d.status} />
                      <MaintenanceBadge deviceId={d.device_id} />
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleTimeString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {devices && visible.length === 0 && <p className="p-4 text-sm text-stone-500">No devices match this filter.</p>}
        </div>
      </Card>
    </div>
  );
}
