# NetSentinel backend -- FastAPI + the whole monitoring/detection/ML
# pipeline, served by uvicorn. See docs/DEPLOYMENT.md for how this is
# wired up with docker-compose.yml at the repo root.
FROM python:3.12-slim

# libpq5 is the runtime client lib psycopg[binary] needs (build-essential
# is NOT required since we use the binary wheel, keeping the image small);
# iputils-ping is what app/monitoring/real_collector.py shells out to for
# devices with monitoring_method="icmp" -- without it, POLLING_MODE=hybrid
# or "live" would silently report every real device as unreachable.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl iputils-ping \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Readiness, not just "process is up": the database answers and the
# monitoring loop is ticking. Docker restarts the container if this keeps failing
# (restart: unless-stopped) and the frontend waits for it before starting.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD curl -fsS http://localhost:8000/api/health/ready || exit 1

# Single worker: the scheduler's background tick loop and the
# process-wide singletons (simulator/collector/rule engine/baseline
# store) are intentionally in-process state for this prototype (see
# docs/ARCHITECTURE.md) -- running >1 worker would give each its own
# copy of that state instead of one shared view of the network.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
