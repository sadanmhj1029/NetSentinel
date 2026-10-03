import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import type { Role } from "../types";

export function ProtectedRoute({ minRole }: { minRole?: Role }) {
  const { isAuthenticated, hasRole } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (minRole && !hasRole(minRole)) return <Navigate to="/" replace />;

  return <Outlet />;
}
