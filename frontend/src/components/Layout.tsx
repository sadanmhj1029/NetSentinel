import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../store/AuthContext";
import { useLive } from "../store/LiveContext";

const NAV_ITEMS: { to: string; label: string; minRole?: "operator" | "admin" }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/topology", label: "Topology" },
  { to: "/incidents", label: "Incidents" },
  { to: "/devices", label: "Devices" },
  { to: "/analytics", label: "Analytics" },
  { to: "/scenarios", label: "Fault Injection", minRole: "operator" },
  { to: "/ml", label: "ML Admin", minRole: "admin" },
  { to: "/audit", label: "Audit Log", minRole: "admin" },
  { to: "/users", label: "Users", minRole: "admin" },
];

export function Layout() {
  const { username, role, logout, hasRole } = useAuth();
  const { connected } = useLive();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-stone-200 bg-white px-4 py-5">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-orange text-sm font-bold text-white">
            NS
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight text-stone-900">NetSentinel</div>
            <div className="text-[11px] leading-tight text-stone-500">Network ops</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV_ITEMS.filter((item) => !item.minRole || hasRole(item.minRole)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-brand-orange/10 text-brand-orange-ink"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-4 border-t border-stone-200 pt-4">
          <div className="flex items-center gap-2 px-2 text-xs text-stone-500">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
            {connected ? "Live" : "Reconnecting…"}
          </div>
          <div className="mt-3 flex items-center justify-between px-2">
            <div>
              <div className="text-sm font-medium text-stone-800">{username}</div>
              <div className="text-xs capitalize text-stone-500">{role}</div>
            </div>
            <button
              onClick={logout}
              className="rounded-lg px-2 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-cream p-8">
        <Outlet />
      </main>
    </div>
  );
}
