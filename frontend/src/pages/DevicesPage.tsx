import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Radar, Plus, Loader2, Network } from "lucide-react";
import { Card, Button } from "../components/Card";
import { StatusBadge } from "../components/Badges";
import { DevicesApi, DiscoveryApi } from "../api/endpoints";
import type { DiscoveryScanResult } from "../api/endpoints";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";
import { ApiError } from "../api/client";
import type { Device } from "../types";

const DEVICE_TYPES = ["router", "switch", "server", "pc", "service"];

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [form, setForm] = useState({ device_id: "", hostname: "", ip_address: "", device_type: "pc" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Discovery state
  const [subnetInput, setSubnetInput] = useState("192.168.1.0/24");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<DiscoveryScanResult | null>(null);
  const [selectedDiscovered, setSelectedDiscovered] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const { hasRole } = useAuth();
  const { tickVersion } = useLive();

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

  async function handleScanSubnet(e: FormEvent) {
    e.preventDefault();
    setScanning(true);
    setScanResult(null);
    setImportStatus(null);
    try {
      const res = await DiscoveryApi.scan(subnetInput);
      setScanResult(res);
      const initialSelected: Record<string, boolean> = {};
      res.devices.forEach((d) => {
        initialSelected[d.ip_address] = true;
      });
      setSelectedDiscovered(initialSelected);
    } catch (err) {
      setImportStatus(err instanceof ApiError ? err.message : "Discovery scan failed");
    } finally {
      setScanning(false);
    }
  }

  async function handleImportSelected() {
    if (!scanResult) return;
    const toImport = scanResult.devices.filter((d) => selectedDiscovered[d.ip_address]);
    if (toImport.length === 0) return;

    setImporting(true);
    try {
      const res = await DiscoveryApi.import(toImport);
      setImportStatus(`Successfully imported ${res.imported_count} live device(s) into inventory!`);
      await refresh();
    } catch (err) {
      setImportStatus(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Devices</h1>
          <p className="text-sm text-stone-500">Continuous health, performance metrics, and inventory for Company A.</p>
        </div>
        <div className="flex items-center gap-2">
          {hasRole("operator") && (
            <Button
              onClick={() => {
                setShowDiscovery((v) => !v);
                setShowForm(false);
              }}
              variant="secondary"
              className="gap-1.5"
            >
              <Radar className="h-4 w-4 text-brand-orange" />
              {showDiscovery ? "Close discovery" : "Auto-discover subnet"}
            </Button>
          )}
          {hasRole("admin") && (
            <Button
              onClick={() => {
                setShowForm((v) => !v);
                setShowDiscovery(false);
              }}
              variant="secondary"
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {showForm ? "Cancel" : "Add device"}
            </Button>
          )}
        </div>
      </div>

      {showDiscovery && (
        <Card title="Subnet Auto-Discovery">
          <div className="space-y-4">
            <form onSubmit={handleScanSubnet} className="flex flex-wrap items-center gap-3">
              <input
                required
                placeholder="Subnet CIDR (e.g. 192.168.1.0/24 or 10.0.1.0/28)"
                value={subnetInput}
                onChange={(e) => setSubnetInput(e.target.value)}
                className="w-72 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
              />
              <Button type="submit" disabled={scanning} className="gap-2">
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radar className="h-4 w-4" />}
                {scanning ? "Scanning subnet…" : "Scan subnet"}
              </Button>
            </form>

            {importStatus && (
              <div className="rounded-lg bg-stone-100 p-3 text-xs font-medium text-stone-800">
                {importStatus}
              </div>
            )}

            {scanResult && (
              <div className="space-y-3">
                <div className="text-xs text-stone-500">
                  Probed {scanResult.total_probed} addresses in {scanResult.duration_seconds}s. Found{" "}
                  <strong className="text-stone-900">{scanResult.live_count}</strong> responsive device(s):
                </div>

                {scanResult.devices.length === 0 ? (
                  <p className="py-4 text-center text-sm text-stone-500">No active hosts replied to ICMP or TCP probes.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-stone-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-stone-50 uppercase tracking-wide text-stone-500">
                        <tr>
                          <th className="w-10 px-3 py-2 text-center">Select</th>
                          <th className="px-3 py-2">Host / IP</th>
                          <th className="px-3 py-2">Latency</th>
                          <th className="px-3 py-2">Inferred Type</th>
                          <th className="px-3 py-2">Open Ports & Services</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {scanResult.devices.map((d) => (
                          <tr key={d.ip_address} className="hover:bg-stone-50">
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={!!selectedDiscovered[d.ip_address]}
                                onChange={(e) =>
                                  setSelectedDiscovered({
                                    ...selectedDiscovered,
                                    [d.ip_address]: e.target.checked,
                                  })
                                }
                                className="rounded text-brand-orange focus:ring-brand-orange"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-semibold text-stone-900">{d.suggested_device_id}</div>
                              <div className="text-stone-500">
                                {d.ip_address} ({d.hostname})
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono text-stone-600">{d.latency_ms.toFixed(1)}ms</td>
                            <td className="px-3 py-2">
                              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium uppercase text-stone-700">
                                {d.suggested_device_type}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-stone-600">
                              {d.services.length > 0 ? d.services.join(", ") : "ICMP Ping only"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {hasRole("admin") && scanResult.devices.length > 0 && (
                  <Button onClick={handleImportSelected} disabled={importing} className="gap-2">
                    {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
                    {importing ? "Importing to topology…" : "Import Selected into Monitoring"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

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
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">IP</th>
                <th className="px-3 py-2">Mode</th>
                <th className="px-3 py-2">Site / dept</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {(devices ?? []).map((d) => (
                <tr key={d.device_id} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <Link to={`/devices/${d.device_id}`} className="font-medium text-brand-orange-ink hover:underline">
                      {d.device_id}
                    </Link>
                    <div className="text-xs text-stone-500">{d.hostname}</div>
                  </td>
                  <td className="px-3 py-2.5 text-stone-700 capitalize">{d.device_type}</td>
                  <td className="px-3 py-2.5 text-stone-500 font-mono text-xs">{d.ip_address}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        d.monitoring_method === "icmp" || d.monitoring_method === "live"
                          ? "bg-sky-100 text-sky-800"
                          : "bg-stone-100 text-stone-600"
                      }`}
                    >
                      {d.monitoring_method || "simulated"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-stone-500">
                    {d.site} / {d.department}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleTimeString() : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
