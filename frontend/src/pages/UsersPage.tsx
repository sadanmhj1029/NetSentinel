import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card, Button } from "../components/Card";
import { UsersApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import type { Role, User } from "../types";

export function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [form, setForm] = useState({ username: "", password: "", role: "viewer" as Role });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setUsers(await UsersApi.list());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await UsersApi.create(form);
      setForm({ username: "", password: "", role: "viewer" });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Users</h1>
        <p className="text-sm text-stone-500">Role-based access: viewer, operator, admin.</p>
      </div>

      <Card title="Add user">
        <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <input
            required
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          />
          <input
            required
            type="password"
            placeholder="Password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          >
            <option value="viewer">viewer</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create user"}
          </Button>
          {error && <p className="col-span-full text-sm text-red-600">{error}</p>}
        </form>
      </Card>

      <Card>
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2">Username</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {(users ?? []).map((u) => (
                <tr key={u.id} className="border-t border-stone-200 hover:bg-stone-50">
                  <td className="px-3 py-2.5 text-stone-800">{u.username}</td>
                  <td className="px-3 py-2.5 capitalize text-stone-700">{u.role}</td>
                  <td className="px-3 py-2.5 text-stone-500">{u.is_active ? "yes" : "no"}</td>
                  <td className="px-3 py-2.5 text-xs text-stone-500">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
