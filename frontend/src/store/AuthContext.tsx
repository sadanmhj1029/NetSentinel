import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AuthApi } from "../api/endpoints";
import { setAuthToken, setUnauthorizedHandler } from "../api/client";
import type { Role } from "../types";

const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

interface AuthState {
  token: string | null;
  username: string | null;
  role: Role | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (minimum: Role) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const STORAGE_KEY = "netsentinel.auth";

function loadStored(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, username: null, role: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, username: null, role: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // The lazy initializer runs synchronously during AuthProvider's first
  // render, before any child component renders or mounts -- so pushing
  // the token into the API client here (rather than in a useEffect)
  // guarantees it's set before any child's effect can fire its first
  // fetch. A useEffect-based version of this raced on a full page
  // reload: React mounts children's effects before a parent's, so a
  // page like Incidents could fire its first GET before the token was
  // ever attached, get a 401, and trip the auto-logout handler --
  // kicking a freshly-reloaded, still-logged-in user back to /login.
  const [state, setState] = useState<AuthState>(() => {
    const loaded = loadStored();
    setAuthToken(loaded.token);
    return loaded;
  });

  useEffect(() => {
    setAuthToken(state.token);
  }, [state.token]);

  const logout = useCallback(() => {
    setState({ token: null, username: null, role: null });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const login = useCallback(async (username: string, password: string) => {
    const resp = await AuthApi.login(username, password);
    const next: AuthState = { token: resp.access_token, username: resp.username, role: resp.role };
    setState(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const hasRole = useCallback(
    (minimum: Role) => {
      if (!state.role) return false;
      return ROLE_RANK[state.role] >= ROLE_RANK[minimum];
    },
    [state.role]
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, isAuthenticated: !!state.token, login, logout, hasRole }),
    [state, login, logout, hasRole]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
