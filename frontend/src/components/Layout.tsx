import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { DevicesApi, IncidentsApi } from "../api/endpoints";
import { useLive } from "../store/LiveContext";
import { Header } from "./shell/Header";
import { MobileNav, Sidebar } from "./shell/Sidebar";
import type { Device, Incident } from "../types";

/**
 * App frame, modeled on the reference: soft neutral canvas, one large
 * rounded panel holding a compact icon sidebar, a greeting header and
 * the page content.
 */
export function Layout() {
  const { tickVersion } = useLive();
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
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tickVersion]);

  const activeCount = incidents.filter((i) => i.status !== "resolved").length;

  return (
    <div className="min-h-screen bg-canvas md:p-4">
      <div className="flex min-h-screen bg-shell md:min-h-[calc(100vh-2rem)] md:rounded-[32px] md:shadow-[0_30px_80px_-40px_rgb(28_25_23/0.35)]">
        <Sidebar incidentCount={activeCount} />
        <div className="flex min-w-0 flex-1 flex-col md:border-l md:border-stone-200/60">
          <Header devices={devices} incidents={incidents} />
          <main className="flex-1 px-4 pb-28 md:px-8 md:pb-8">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileNav incidentCount={activeCount} />
    </div>
  );
}
