import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { AuditApi } from "../api/endpoints";
import type { AuditLogEntry } from "../types";

export function AuditPage() {
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    AuditApi.list().then(setLogs);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Audit Log</h1>
        <p className="text-sm text-stone-500">Every write made through the API, who made it, and when.</p>
      </div>

      <Card>
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Resource</th>
              </tr>
            </thead>
            <tbody>
              {(logs ?? []).map((log) => (
                <tr key={log.id} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-3 py-2.5 text-xs text-stone-500">{new Date(log.timestamp).toLocaleString()}</td>
                  <td className="px-3 py-2.5 text-stone-700">{log.username}</td>
                  <td className="px-3 py-2.5 text-stone-800">{log.action}</td>
                  <td className="px-3 py-2.5 text-stone-500">{log.resource ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs && logs.length === 0 && <p className="p-4 text-sm text-stone-500">No audit entries yet.</p>}
        </div>
      </Card>
    </div>
  );
}
