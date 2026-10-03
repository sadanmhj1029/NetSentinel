# Demo script

A ~5 minute walkthrough of the full pipeline, start to finish: inject a
real fault, watch it get detected, correlated, diagnosed, and resolved
-- live, in the UI. This is the exact sequence used to verify the app
end-to-end during development (including a real headless-browser run of
all of these steps).

Assumes the app is running (see `docs/DEPLOYMENT.md`) at
`http://localhost:5173`, with the default seeded topology:

```
Router-01
  +-- Switch-01
  |     +-- PC-01
  |     +-- PC-02
  +-- Switch-02
        +-- PC-03
        +-- PC-04
        +-- Server-01
```

## 1. Log in and look around

Log in as `admin` / `admin123`. The **Dashboard** shows live device
counts, MTTD/MTTA/MTTR (populated once there's incident history), any
active incidents, and a live feed of monitoring ticks. The green "Live"
indicator in the sidebar means the WebSocket connection to the backend
is up -- everything on this page updates without a manual refresh.

Click **Topology** to see the dependency graph itself. Every node is
green ("online") in the normal state.

## 2. Inject a fault

Go to **Fault Injection** (operator/admin only). Pick **Switch / device
failure**, leave the target on its default (`Switch-02`), and click
**Start**. The "Current state" card at the top confirms it's active and
lists which devices are affected.

What's actually happening: the simulator starts returning "unreachable"
telemetry for Switch-02 immediately, and for its downstream devices
(PC-03, PC-04, Server-01) a second or two later -- staggered, like a
real outage propagating, not four simultaneous failures that would be
suspiciously easy to correlate.

## 3. Watch detection happen

Switch to **Topology**. Within a few seconds (3 consecutive bad polls at
the default 2s poll interval = ~6s), Switch-02 and its descendants turn
red/amber as the rule engine's hysteresis opens events for each of them.

## 4. Watch an incident get created and diagnosed

Switch to **Incidents**. A new incident appears, grouping all four
affected devices into **one** incident rather than four separate ones --
that's the topology-based clustering at work. Open it.

The incident detail page shows exactly what the spec asks for:

- **Probable root cause: Switch-02**, confidence **high**, with the
  overall score (should be in the high-70s/low-80s out of 100 for this
  scenario).
- A **diagnosis** paragraph citing concrete evidence: when Switch-02
  became unreachable, that the healthy upstream device (Router-01) stays
  healthy throughout, and why that makes Switch-02 the cause rather than
  a symptom.
- **Ranked candidates** table with the full score breakdown (coverage,
  temporal correlation, health contrast, dependency importance) for
  every plausible candidate, not just the winner -- Router-01 shows up
  too, ranked lower, with no direct evidence of its own trouble.
- **Recommended checks** (check device power, check uplink interface,
  check recent configuration changes) and a **timeline**.

As an operator/admin, try **Acknowledge** and add an operator note.

## 5. Watch it recover

Back on **Fault Injection**, click **Stop** on the switch failure. Watch
the incident: once the engine sees enough consecutive healthy polls, the
incident moves through `recovering` to `resolved` automatically, with a
recorded recovery time -- no manual action required (though **Resolve**
is there for an operator to close something early, e.g. a known false
positive).

## 6. The rest of the pipeline

A few more things worth showing, each demonstrating a specific
requirement from the spec:

- **Collector failure must never look like a mass outage.** Start the
  **Collector failure** scenario instead. Every device's data goes
  stale, but note that *no incident is created* and devices don't flip
  to "offline" -- the dashboard and collector health both clearly show
  "collector unhealthy" instead. This is the single most
  easy-to-get-wrong requirement in the spec, and it's covered by an
  automated test
  (`test_collector_failure_never_creates_a_false_mass_outage_incident`),
  not just eyeballed.
- **Adaptive baselines, not just fixed thresholds.** Open a device
  detail page (e.g. PC-01) and look at "Adaptive baseline" -- a
  per-device, robust-statistics (median/MAD) latency baseline learned
  from its own recent history, not a one-size-fits-all number.
- **ML anomaly detection.** On **ML Admin** (admin only), click
  **Retrain model** to fit an Isolation Forest on the accumulated
  telemetry, then revisit a device detail page to see its live anomaly
  score.
- **Analytics.** The **Analytics** page computes MTTD/MTTA/MTTR and
  root-cause accuracy from the session's actual incident + fault-
  injection history -- real evaluation metrics, not placeholders.
- **Everything is audited.** Every write made during this whole demo
  (scenario starts/stops, acknowledgements, device changes) is on the
  **Audit Log** page (admin only), with who did it and when.
