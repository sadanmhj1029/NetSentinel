# Architecture

NetSentinel is a full pipeline, not a mockup: a simulated network produces
real metrics, a collector polls and validates them, a detection layer
(rules + adaptive baselines + ML) raises events, a correlation engine
groups and explains them, and an incident engine tracks the whole thing
through to recovery -- live, over a WebSocket, to a React dashboard.

```
Simulator --> Collector --> Detection (rules/baseline/ML) --> Correlation
  (fault         (poll,          |                              (topology +
  injection)     validate,       v                               root cause)
                 stale-check) Events --------------------------------> Incident Engine
                                                                          |
                                                                          v
                                                        Notifications, audit log,
                                                        WebSocket broadcast --> React UI
```

## Why one process

Everything (scheduler, simulator, collector, detection, ML, correlation,
incident engine) runs in a single `uvicorn` worker, with the pipeline
state -- the simulator's active fault, the rule engine's hysteresis
state, the adaptive baseline windows, the WebSocket connection list --
held as process-wide singletons rather than in Redis or the database.
That's a deliberate scope decision for a prototype of this size: it's
one shared, consistent view of the network with zero coordination code,
and it's easy to reason about and demo. `docker-compose.yml` runs the
backend with exactly one worker for the same reason -- a second worker
would get its own, divergent copy of all that state instead of sharing
it.

The production evolution path, if this ever needed to scale past a demo:

- **Move singleton state out of the process.** The simulator's fault
  state and the rule engine's/baseline store's hysteresis windows would
  move to Redis (already a reserved, unused dependency --
  `REDIS_URL` in `.env.example`) so multiple API workers could share one
  view of the network and the scheduler tick could run as its own
  worker process instead of inside the API process.
- **`MetricSample` as a TimescaleDB hypertable.** It's currently one wide
  table (see `app/models/metric.py`) which is simpler to reason about
  and query at demo volume; at real scale/retention it's the natural
  candidate for a hypertable with continuous aggregates for the
  dashboard's rolling stats.
- **A real model registry for the ML pipeline.** `app/ml/model_store.py`
  persists the trained Isolation Forest as a joblib file plus a JSON
  metadata sidecar on local disk -- enough for model persistence
  (versioned, timestamped, with recorded training stats), but a real
  deployment would want a proper registry with rollback and multi-model
  support.
- **A real identity provider.** Auth is JWT + bcrypt + an in-house
  `role` column (`app/security.py`), which is deliberately simple rather
  than wiring up OIDC/SAML -- fine for three demo accounts, not for a
  real org's user base.
- **A queue for the collector.** `app/monitoring/collector.py` polls
  synchronously in-process (`"queue_status": "idle"` is a placeholder);
  a fleet of thousands of real devices would want an actual polling
  queue/worker pool instead of one loop ticking every
  `poll_interval_seconds` (2s by default).

## Data flow, one tick at a time

Every `poll_interval_seconds` (default 2s), `app/scheduler.py`'s
background loop does, in order:

1. **Collect** (`app/monitoring/collector.py`): poll every active device
   through the simulator (`app/monitoring/simulator.py`), which returns
   either normal, jittered-but-healthy telemetry or whatever an active
   fault scenario is injecting. The collector validates each sample
   (sanity-checks ranges, flags staleness) and persists it as a
   `MetricSample`. If the simulator's `collector_failure` scenario is
   active, the collector marks itself unhealthy and marks every
   device's data stale -- it does **not** touch device status, which is
   the load-bearing design decision that keeps a collector outage from
   ever being misread as every device going down at once (see
   `tests/test_incidents.py::test_collector_failure_never_creates_a_false_mass_outage_incident`).
2. **Detect** (`app/detection/`): each fresh sample is run through
   - **rules** (`rules.py`): fixed thresholds (packet loss %, CPU %,
     memory %, bandwidth saturation, unreachable) with a 3-consecutive
     hysteresis state machine per `(device, rule_type)`, so one noisy
     poll never opens an event and one good poll never prematurely
     closes one;
   - **adaptive baseline** (`baseline.py`): a rolling per-device,
     per-metric window (default 60 samples, needs 15 to activate) using
     robust statistics -- median and MAD (median absolute deviation)
     instead of mean/stddev, so a handful of outliers can't drag the
     "normal" range with them -- producing a Low/Medium/High deviation
     label and feeding the rule engine's latency threshold dynamically;
   - **ML** (`app/ml/`): once trained (see below), an Isolation Forest
     scores each sample's engineered features (rolling mean/std latency,
     rate of change, etc.) for anomalousness, with a simple
     highest-deviation-feature explanation attached.
3. **Correlate** (`app/correlation/`): all currently-affected devices are
   clustered by topology connectivity (`root_cause.py` walks the
   `app/correlation/topology_graph.py` dependency graph, including each
   affected device's ancestors, and groups by weakly-connected
   component) so two unrelated simultaneous faults never get merged into
   one incident, and each cluster's candidates are scored:

   ```
   overall_score = 0.35*coverage + 0.25*temporal_correlation
                  + 0.20*health_contrast + 0.20*dependency_importance
                  - missing_evidence_penalty (20 if the candidate has no
                                               direct evidence of its own)
   ```

   Every component is 0-100 and returned alongside the total so the
   incident detail page can show the full breakdown, not just a single
   number. `root_cause_high_confidence` (75) and
   `root_cause_medium_confidence` (45) turn the score into a
   low/medium/high label.
4. **Manage incidents** (`app/incidents/engine.py`): a new cluster opens
   an incident (`detected`); an existing one gets its evidence, ranked
   candidates and diagnosis text updated; two consecutive "all clear"
   ticks move it through `recovering` to an automatic `resolved` with a
   recorded recovery time. Operators can also acknowledge, add notes, or
   manually resolve early through the API/UI.
5. **Notify + broadcast**: a new or escalated incident goes through
   `app/services/notifications.py` (console log + optional webhook) and
   every tick's summary is broadcast to all connected WebSocket clients
   (`app/websocket_manager.py`) so the dashboard updates live without
   polling.

Every write through the API (device/topology changes, scenario
start/stop, incident actions, ML training, user management) is also
recorded to the `audit_logs` table (`app/services/audit.py`).

## Frontend

A React + TypeScript SPA (`frontend/`) that treats a WebSocket "tick"
message purely as a "something changed, go refetch" signal rather than
trying to apply a partial diff client-side -- simpler to reason about and
plenty fast enough at this poll interval. Role-based UI (viewer <
operator < admin) mirrors the backend's `require_role` dependency so
operator/admin-only actions (fault injection, ML admin, user management,
audit log) aren't just hidden but also still rejected server-side if
someone bypasses the UI.
