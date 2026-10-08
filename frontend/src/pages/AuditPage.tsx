import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button, Card } from "../components/Card";
import { FilterBar } from "../components/FilterBar";
import { downloadCsv, stamp, toCsv } from "../lib/csv";
import { AuditApi } from "../api/endpoints";
import type { AuditLogEntry } from "../types";

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);

  const [query, setQuery] = useState("");

  useEffect(() => {
    AuditApi.list(1000).then(setLogs);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (logs ?? []).filter(
      (l) => !q || [l.username, l.action, l.resource ?? ""].some((v) => v.toLowerCase().includes(q))
    );
  }, [logs, query]);

  function exportCsv() {
    const csv = toCsv(visible, [
      { header: "Time", value: (l) => new Date(l.timestamp).toLocaleString() },
      { header: "User", value: (l) => l.username },
      { header: "Action", value: (l) => l.action },
      { header: "Resource", value: (l) => l.resource },
      { header: "IP", value: (l) => l.ip_address },
    ]);
    downloadCsv(`netsentinel-audit-${stamp()}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Audit Log</h1>
          <p className="text-sm text-stone-500">Every write made through the API, who made it, and when.</p>
        </div>
        <Button onClick={exportCsv} variant="secondary" disabled={!visible.length}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
      </div>

      <Card>
        <FilterBar
          query={query}
          onQuery={setQuery}
          placeholder="Filter by user, action or resource"
          count={visible.length}
          total={logs?.length ?? 0}
        />
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((log) => (
                <tr key={log.id} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-3 py-2.5 text-xs text-stone-500">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-stone-700">{log.username}</td>
                  <td className="px-3 py-2.5 text-stone-800">{log.action}</td>
                  <td className="px-3 py-2.5 text-stone-500">{log.resource ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs && visible.length === 0 && (
            <p className="p-4 text-sm text-stone-500">{logs.length ? "No entries match this filter." : "No audit entries yet."}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
