# Deployment / local setup

Two ways to run NetSentinel: Docker Compose (recommended, one command) or
native local processes (useful if Docker Hub isn't reachable from your
network, or you just prefer it). Both end up with the same three things
running: Postgres, the FastAPI backend, the React frontend.

## One-click helper

`NetSentinel.bat` (Windows, double-click for a menu) and
`scripts/netsentinel.sh` (macOS/Linux) wrap the Docker commands you'd
otherwise type by hand:

| Command | What it does |
|---|---|
| `start` | Creates `.env` if missing, builds and starts all containers, waits for `/api/health/ready`, opens the browser |
| `stop` | `docker compose down`. Data is kept (it never passes `-v`) |
| `update` | Takes a backup, refuses to continue if you have local code changes, `git pull --ff-only`, rebuilds, restarts, waits until healthy |
| `status` | Container list plus the readiness check |
| `logs` | Follows the backend log |
| `backup` | `pg_dump` inside the db container, copied to `backups/netsentinel-<date>.dump`; keeps the newest 10 |
| `restore [file]` | Restores the newest backup (or the file given) after you type `YES`; stops the backend while it runs |
| `open` | Opens http://localhost:5173 |

On Windows: `NetSentinel.bat start`, `NetSentinel.bat update`, and so on,
from PowerShell or Command Prompt in the project folder. It runs the
PowerShell script with `-ExecutionPolicy Bypass`, so no policy changes
are needed.

The frontend's nginx sends `index.html` with `Cache-Control: no-cache`
(the hashed JS/CSS files are cached forever), so after an update the
browser picks up the new version on a normal reload.

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
volume and start completely fresh next time; that deletes all data).

Health and resilience built into the compose setup:

- The backend's Docker healthcheck calls `GET /api/health/ready`, which
  passes only when the database answers **and** the monitoring loop has
  ticked recently. With `restart: unless-stopped`, Docker restarts a
  backend that stays unhealthy.
- The frontend waits for the backend to be healthy before starting.
- Every container's log is capped at 3 x 10 MB.

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

## Health, status and backups

| Endpoint | Auth | Use |
|---|---|---|
| `GET /health`, `GET /api/health` | none | Liveness: the process is up |
| `GET /api/health/ready` | none | Readiness: database reachable and monitoring loop ticking; `503` otherwise |
| `GET /api/system/status` | any user | Everything above plus pipeline stats, row counts, retention and lockout settings (shown in Settings → System status) |

Backups are plain `pg_dump -Fc` files, so they also restore with any
Postgres tools: `pg_restore --clean --if-exists --no-owner -d netsentinel <file>`.

New reliability settings (all optional, see `.env.example`):
`METRIC_RETENTION_HOURS` (default 72, `0` keeps everything),
`LOGIN_MAX_ATTEMPTS` (5), `LOGIN_LOCKOUT_SECONDS` (300).

## Troubleshooting

- **"Lost connection to the NetSentinel server" banner** -- the browser
  can't reach the backend. Run `NetSentinel.bat status`; if the backend
  isn't ready, `NetSentinel.bat logs` shows why. The page reconnects on
  its own once the backend is back.
- **"Too many failed attempts" on login** -- five wrong passwords lock
  that account for 5 minutes from that computer. Wait it out, or restart
  the backend to clear all lockouts.

- **Backend can't reach Postgres on startup** -- the backend now waits
  for the database (up to ~60s, `DB_CONNECT_RETRIES` x
  `DB_CONNECT_RETRY_SECONDS`) before giving up, logging each attempt. Natively, make sure `pg_isready` succeeds and
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
