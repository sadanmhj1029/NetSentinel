import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  // Set by the API client when a request came back 401 while signed in.
  const [expired] = useState(() => {
    try {
      const v = sessionStorage.getItem("netsentinel:sessionExpired") === "1";
      sessionStorage.removeItem("netsentinel:sessionExpired");
      return v;
    } catch {
      return false;
    }
  });
  const checkCaps = (e: KeyboardEvent) => setCapsLock(e.getModifierState?.("CapsLock") ?? false);

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
          {expired && !error && (
            <p className="mb-4 rounded-lg bg-beige px-3 py-2 text-sm text-stone-800">
              Your session expired. Please sign in again.
            </p>
          )}
          <label className="mb-1 block text-xs font-medium text-stone-500">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            className="mb-4 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-brand-orange"
          />

          <label className="mb-1 block text-xs font-medium text-stone-500">Password</label>
          <div className="relative mb-4">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={checkCaps}
              onKeyDown={checkCaps}
              autoComplete="current-password"
              className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-3 pr-10 text-sm text-stone-900 outline-none focus:border-brand-orange"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-stone-500 hover:text-stone-800"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            {capsLock && <p className="mt-1 text-xs font-medium text-amber-700">Caps Lock is on</p>}
          </div>

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
