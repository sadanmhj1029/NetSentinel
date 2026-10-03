import { FixPriority } from "../components/FixPriority";
import { HealthCard } from "../components/dashboard/HealthCard";
import { RootCauseCard } from "../components/dashboard/RootCauseCard";
import { IncidentsCard } from "../components/dashboard/IncidentsCard";
import { PerformanceCard } from "../components/dashboard/PerformanceCard";
import { TopologyPreview } from "../components/dashboard/TopologyPreview";
import { AnomalyCard } from "../components/dashboard/AnomalyCard";
import { CollectorCard } from "../components/dashboard/CollectorCard";
import { EventTimeline } from "../components/dashboard/EventTimeline";
import { FaultInjectionCard } from "../components/dashboard/FaultInjectionCard";
import { useDashboardData } from "../components/dashboard/useDashboardData";

/**
 * NOC overview. Reading order answers, top to bottom:
 *   what is affected (Network Health), what's the probable root cause and
 *   the evidence (Root-Cause Insight), what to fix first (Fix priority),
 *   how severe (Active Incidents), then supporting telemetry and controls.
 */
export function DashboardPage() {
  const d = useDashboardData();

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
      <div className="xl:col-span-7">
        <HealthCard devices={d.devices} collector={d.collector} />
      </div>
      <div className="xl:col-span-5">
        <RootCauseCard focus={d.focus} activeCount={d.activeIncidents.length} topology={d.topology} />
      </div>

      {d.priority && d.priority.faulty_count > 0 && (
        <div className="xl:col-span-12">
          <FixPriority data={d.priority} />
        </div>
      )}

      <div className="xl:col-span-7">
        <IncidentsCard incidents={d.incidents} />
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:col-span-5 xl:grid-cols-1">
        <CollectorCard health={d.collector} />
        <FaultInjectionCard sim={d.sim} />
      </div>

      <div className="xl:col-span-8">
        <PerformanceCard perf={d.perf} />
      </div>
      <div className="xl:col-span-4">
        <AnomalyCard ml={d.ml} telemetry={d.telemetry} />
      </div>

      <div className="xl:col-span-5">
        <TopologyPreview topology={d.topology} />
      </div>
      <div className="xl:col-span-7">
        <EventTimeline focus={d.focus} />
      </div>
    </div>
  );
}
