# Deployment / local setup

Two ways to run NetSentinel: Docker Compose (recommended, one command) or
native local processes (useful if Docker Hub isn't reachable from your
network, or you just prefer it). Both end up with the same three things
running: Postgres, the FastAPI backend, the React frontend.

## Option A: Docker Compose

Requirements: Docker + Docker Compose.

```bash
cp .env.example .env     # edit if you want non-default passwords/ports
docker compose up --build
```

This starts:

- **db** -- Postgres 16, published on `5432`, with a named volume so data
  survives restarts.
- **backend** -- FastAPI on `8000`. On first start it creates the schema,
  seeds the 8-device demo topology, seeds the three demo users, and
  backfills ~45 minutes of synthetic "normal" history so baselines and
  the dashboard aren't empty on first load.
- **frontend** -- the production React build served by nginx, published
  on `5173`.

Once it's up:

| | |
|---|---|
| App | http://localhost:5173 |
| API docs (Swagger) | http://localhost:8000/docs |
| Demo accounts | `admin` / `admin123`, `operator` / `operator123`, `viewer` / `viewer123` |

To stop: `docker compose down` (add `-v` to also drop the Postgres
volume and start completely fresh next time).

A note on `VITE_API_BASE_URL` / `VITE_WS_BASE_URL`: Vite bakes these into
the built JS bundle at **build** time, not at container start, because
the browser (not the backend container) is what actually calls these
URLs. The compose file's defaults (`http://localhost:8000` /
`ws://localhost:8000`) assume you're opening the app from the same
machine the containers are running on, which is the normal case. If
you're deploying this somewhere the browser and the backend aren't both
"localhost" to each other, set `VITE_API_BASE_URL`/`VITE_WS_BASE_URL` in
your `.env` to the backend's real externally-reachable URL before
building.

## Option B: native (no Docker)

Requirements: Python 3.12+, Node 20+, a local Postgres server.

```bash
./scripts/dev-setup.sh
```

This creates a Python venv and installs backend requirements, runs
`npm install` for the frontend, and creates the `netsentinel` and
`netsentinel_test` Postgres databases/role if they don't already exist
(this is the path used in this repo's own sandbox, where Docker Hub
pulls are blocked by a network proxy allowlist -- Postgres was installed
directly via `apt-get install postgresql` instead of via container).

Then, in two terminals:

```bash
# Terminal 1
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload

# Terminal 2
cd frontend
npm run dev
```

The frontend dev server runs on `http://localhost:5173` and the backend
on `http://localhost:8000` -- `frontend/.env`'s defaults (copied from
`.env.example`) already point at that, and the backend's default
`cors_origins` already allows `http://localhost:5173`, so no extra
configuration is needed.

## Running the test suite

```bash
./scripts/run-tests.sh
```

This resets `netsentinel_test` to a clean schema and runs the full
pytest suite (`backend/tests/`) against it -- unit tests for the rule
engine and adaptive baseline, the correlation/root-cause scoring against
the spec's own worked Switch-02 example, full-pipeline integration tests
that run real collector ticks against a real (test) database, and
API-level auth/RBAC smoke tests. `backend/tests/conftest.py` resets both
the schema and the process-wide detection singletons (rule engine,
baseline store) before every test, so tests don't leak state into each
other and the suite is safe to run repeatedly without resetting anything
by hand.

If you'd rather run pytest directly: it defaults to
`postgresql+psycopg://netsentinel:netsentinel@localhost:5432/netsentinel_test`,
overridable with the `DATABASE_URL` env var.

## Configuration reference

All settings are environment variables with sensible defaults baked in
(`backend/app/config.py`); `.env.example` at the repo root documents
every one, including detection thresholds, the ML training sample
minimum, poll interval, and notification settings. Copy it to `.env` and
edit before any real (non-demo) deployment -- at minimum, change
`SECRET_KEY` and the three `DEMO_*_PASSWORD` values.

## A note on how this was verified

The `docker-compose.yml` and both Dockerfiles were validated (`docker
compose config`, and a real `docker build` far enough to confirm the
only failure is the base-image pull) in the sandbox this project was
built in, but a full `docker compose up --build` could **not** be run
there end-to-end -- that sandbox's network proxy blocks Docker Hub
pulls entirely (confirmed via `curl $HTTPS_PROXY/__agentproxy/status`),
which is why local dev there used natively-installed Postgres instead
(Option B above). On a normal machine with regular Docker Hub access,
Option A just works. The backend and frontend themselves were verified
thoroughly: the full pytest suite against a real Postgres database, and
a real headless-browser walkthrough of the running frontend against the
running backend (login, every page, triggering a fault, watching an
incident get created/diagnosed/resolved) -- see `docs/DEMO.md` for that
exact sequence.

## Troubleshooting

- **Backend can't reach Postgres on startup** -- with Docker Compose,
  the backend `depends_on` the db's healthcheck, so this should only
  happen if Postgres is still initializing on a very slow first start;
  it'll retry. Natively, make sure `pg_isready` succeeds and
  `DATABASE_URL` matches a role/database that actually exists (rerun
  `scripts/dev-setup.sh`, which is idempotent).
- **Dashboard looks empty / baseline says "not enough history"** -- the
  seed step backfills history once, only when the `metrics` table is
  empty (`app/seed.py::backfill_history`). If you've been poking at the
  API with a mostly-empty database, give it a minute of live polling or
  re-seed with `./scripts/reset-db.sh` (dev) and restart the backend.
- **A device added via the Devices page doesn't show up on the Topology
  page** -- that's expected: the topology view is the seeded graph plus
  explicit links (`POST /api/topology/links`). A newly created device is
  still fully polled and monitored (using a generic baseline profile)
  even before it has a topology link; add a link to place it on the map.
