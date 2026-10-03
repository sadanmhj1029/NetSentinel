import { NavLink } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "../../lib/utils";
import { useAuth } from "../../store/AuthContext";
import { useLive } from "../../store/LiveContext";
import { NAV_GROUPS } from "./nav";
import type { NavItem } from "./nav";
import { LiquidGlass } from "../LiquidGlass";
import { useMediaQuery } from "../../lib/useMediaQuery";

function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-full bg-brand-orange font-semibold uppercase text-white",
        className,
      )}
    >
      {name.slice(0, 2)}
    </span>
  );
}
export { Initials };

function SideLink({ item, incidentCount }: { item: NavItem; incidentCount: number }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      aria-label={item.label}
      className="group relative flex h-11 w-11 items-center justify-center"
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-full bg-ink shadow-md shadow-stone-900/20"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          )}
          <Icon
            className={cn(
              "relative h-[19px] w-[19px] transition-colors",
              isActive ? "text-brand-orange" : "text-stone-600 group-hover:text-stone-900",
            )}
            strokeWidth={1.9}
          />
          {item.badge === "incidents" && incidentCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
              {incidentCount}
            </span>
          )}
          {/* hover label */}
          <span className="pointer-events-none absolute left-full z-50 ml-3 hidden md:block whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar({ incidentCount }: { incidentCount: number }) {
  const { username, logout, hasRole } = useAuth();
  const { connected } = useLive();
  const groups = NAV_GROUPS.map((g) => g.filter((i) => !i.minRole || hasRole(i.minRole))).filter((g) => g.length);

  return (
    <aside className="sticky top-4 hidden h-[calc(100vh-2rem)] w-[88px] shrink-0 flex-col items-center py-6 md:flex">
      <NavLink to="/" className="mb-6 flex flex-col items-center gap-1" aria-label="NetSentinel home">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink">
          <ShieldCheck className="h-5 w-5 text-brand-orange" strokeWidth={2.2} />
        </span>
        <span className="text-[10px] font-semibold tracking-tight text-stone-800">NetSentinel</span>
      </NavLink>

      <nav className="flex flex-1 flex-col items-center gap-3">
        {groups.map((group, i) => (
          <div key={i} className="flex flex-col items-center gap-1 rounded-full bg-white p-1.5 shadow-card">
            {group.map((item) => (
              <SideLink key={item.to} item={item} incidentCount={incidentCount} />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col items-center gap-3">
        <span
          className="flex items-center gap-1.5 text-[10px] font-medium text-stone-500"
          title={connected ? "Live updates connected" : "Reconnecting to live updates"}
        >
          <span className={cn("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "animate-pulse bg-red-500")} />
          {connected ? "Live" : "Offline"}
        </span>
        <div className="flex flex-col items-center gap-1 rounded-full bg-white p-1.5 shadow-card">
          <button
            onClick={logout}
            aria-label="Sign out"
            className="group relative flex h-11 w-11 items-center justify-center rounded-full text-stone-500 hover:text-stone-900"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.9} />
            <span className="pointer-events-none absolute left-full z-50 ml-3 hidden md:block whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
              Sign out
            </span>
          </button>
        </div>
        <Initials name={username ?? "?"} className="h-11 w-11 text-sm ring-4 ring-white" />
      </div>
    </aside>
  );
}

/** Bottom bar for phones, same destinations. */
export function MobileNav({ incidentCount }: { incidentCount: number }) {
  const { hasRole } = useAuth();
  const phone = useMediaQuery("(max-width: 767px)");
  const items = NAV_GROUPS.flat().filter((i) => !i.minRole || hasRole(i.minRole));
  if (!phone) return null; // don't spend a WebGL context on a hidden bar
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40" aria-label="Main">
      <LiquidGlass type="pill" radius={30} tint={0.1} minScrim={0.2} textColor="#57534e" minContrast={3} trackScroll>
        <div className="flex items-center gap-1 overflow-x-auto p-1.5">
          {items.map((item) => (
            <SideLink key={item.to} item={item} incidentCount={incidentCount} />
          ))}
        </div>
      </LiquidGlass>
    </nav>
  );
}
