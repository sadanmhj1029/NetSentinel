import { useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { ApiError } from "../api/client";
import { Button } from "../components/Card";

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    const redirectTo = (location.state as { from?: string } | null)?.from || "/";
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="hero-canvas flex min-h-screen items-center justify-center px-4">
      <div className="hero-grain" />
      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-orange text-base font-bold text-white">
            NS
          </div>
          <h1 className="text-lg font-semibold text-[#4a3326]">NetSentinel</h1>
          <p className="text-sm text-[#6b5847]">Network monitoring &amp; root-cause analysis</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-stone-200 bg-white p-6 shadow-lg shadow-stone-900/10"
        >
          <label className="mb-1 block text-xs font-medium text-stone-500">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="mb-4 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          />

          <label className="mb-1 block text-xs font-medium text-stone-500">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          />

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={submitting} className="w-full justify-center">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <div className="mt-4 rounded-lg bg-stone-50 p-3 text-xs text-stone-500">
            Demo accounts: <span className="text-stone-700">admin / admin123</span>,{" "}
            <span className="text-stone-700">operator / operator123</span>,{" "}
            <span className="text-stone-700">viewer / viewer123</span>
          </div>
        </form>
      </div>
    </div>
  );
}
