import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { DevicesApi, IncidentsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import { markAppReady, renderAll, scheduleSnapshotRefresh } from "../lib/liquidGlass";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Header, HeaderControls } from "./shell/Header";
import { MobileNav, Sidebar } from "./shell/Sidebar";
import { LiquidGlass } from "./LiquidGlass";
import type { Device, Incident } from "../types";

const SAFETY_REFRESH_MS = 60_000;

/**
 * App frame: cream canvas, one large rounded panel holding a compact icon
 * sidebar, a greeting header and the page. On wide screens the header
 * controls float in a Liquid Glass bar that cards slide under as you scroll.
 */
export function Layout() {
  const { tickVersion } = useLive();
  const { pathname } = useLocation();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [devices, setDevices] = useState<Device[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  // Header (status line, search, notifications) and the sidebar badge need
  // a light, always-fresh view of devices + incidents on every page.
  useEffect(() => {
    let cancelled = false;
    Promise.all([DevicesApi.list(), IncidentsApi.list()])
      .then(([d, i]) => {
        if (cancelled) return;
        setDevices(d);
        setIncidents(i);
        if (d.length) markAppReady(); // real data is on screen: glass may now take its snapshot
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tickVersion]);

  // Glass refracts a snapshot of the page. Re-capture only when what's on
  // screen meaningfully changed: a new page, a device changing state, or an
  // incident opening/closing. Plus a slow safety refresh for drifting numbers.
  const activeCount = incidents.filter((i) => i.status !== "resolved").length;
  const signature = `${devices.map((d) => d.status[0]).join("")}|${activeCount}`;
  useEffect(() => {
    scheduleSnapshotRefresh(1200);
  }, [signature]);
  useEffect(() => {
    scheduleSnapshotRefresh(1200, true); // a new page always gets a fresh snapshot
  }, [pathname]);
  useEffect(() => {
    const t = setInterval(() => scheduleSnapshotRefresh(0), SAFETY_REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  // Positions can shift without a scroll (cards growing); re-place the glass each tick.
  useEffect(() => {
    requestAnimationFrame(renderAll);
  }, [tickVersion]);

  return (
    <div className="min-h-screen bg-canvas md:p-4">
      <div className="flex min-h-screen bg-shell md:min-h-[calc(100vh-2rem)] md:rounded-[32px] md:shadow-[0_30px_80px_-40px_rgb(87_48_35/0.28)]">
        <Sidebar incidentCount={activeCount} />
        <div className="relative flex min-w-0 flex-1 flex-col md:border-l md:border-stone-200/60">
          {wide && (
            // Zero-height sticky rail: the glass bar sits in the header row at the top,
            // then stays pinned while the page scrolls underneath it.
            <div className="sticky top-0 z-40 h-0">
              <div className="absolute right-8 top-6">
                <LiquidGlass type="pill" radius={30} tint={0.1} minScrim={0.2} className="p-1.5" trackScroll>
                  <HeaderControls devices={devices} incidents={incidents} onGlass />
                </LiquidGlass>
              </div>
            </div>
          )}
          <Header devices={devices} incidents={incidents} controlsInline={!wide} />
          <main className="flex-1 px-4 pb-28 md:px-8 md:pb-8">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav incidentCount={activeCount} />
    </div>
  );
}
