import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Keyboard, X } from "lucide-react";
import { useAuth } from "../../store/AuthContext";
import type { Role } from "../../types";

const GO: { key: string; to: string; label: string; role?: Role }[] = [
  { key: "d", to: "/", label: "Dashboard" },
  { key: "i", to: "/incidents", label: "Incidents" },
  { key: "v", to: "/devices", label: "Devices" },
  { key: "t", to: "/topology", label: "Topology" },
  { key: "a", to: "/analytics", label: "Analytics" },
  { key: "r", to: "/reports", label: "Reports" },
  { key: "f", to: "/scenarios", label: "Fault injection", role: "operator" },
  { key: "s", to: "/settings", label: "Settings" },
];

function typingInField(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Keyboard shortcuts: press "g" then a letter to jump to a page, "?" for the
 * list. "/" (search) already lives in the header.
 */
export function Shortcuts() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const pendingG = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typingInField(e)) return;
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (pendingG.current) {
        window.clearTimeout(pendingG.current);
        pendingG.current = null;
        const hit = GO.find((g) => g.key === e.key.toLowerCase() && (!g.role || hasRole(g.role)));
        if (hit) {
          e.preventDefault();
          setOpen(false);
          navigate(hit.to);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        pendingG.current = window.setTimeout(() => (pendingG.current = null), 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, hasRole]);

  if (!open) return null;
  const rows = GO.filter((g) => !g.role || hasRole(g.role));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-md rounded-[26px] bg-shell p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Keyboard className="h-5 w-5 text-brand-orange" /> Keyboard shortcuts
          </h2>
          <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-1.5 text-stone-500 hover:bg-stone-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="divide-y divide-stone-200/70 text-sm">
          <Row keys={["/"]} label="Search devices and incidents" />
          <Row keys={["?"]} label="Show or hide this list" />
          {rows.map((g) => (
            <Row key={g.key} keys={["g", g.key]} label={`Go to ${g.label}`} />
          ))}
          <Row keys={["Esc"]} label="Close dialogs" />
        </ul>
      </div>
    </div>
  );
}

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <li className="flex items-center justify-between py-2">
      <span className="text-stone-700">{label}</span>
      <span className="flex items-center gap-1">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-stone-400">then</span>}
            <kbd className="min-w-[1.75rem] rounded-md border border-stone-300 bg-white px-1.5 py-0.5 text-center font-mono text-xs text-stone-800">
              {k}
            </kbd>
          </span>
        ))}
      </span>
    </li>
  );
}
