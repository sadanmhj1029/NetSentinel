from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import scheduler, seed
from app.api import (
    routes_audit,
    routes_auth,
    routes_collector,
    routes_devices,
    routes_incidents,
    routes_ml,
    routes_priority,
    routes_reports,
    routes_scenarios,
    routes_topology,
    routes_users,
    routes_ws,
)
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed.run_all()
    scheduler.start()
    yield
    scheduler.stop()


app = FastAPI(
    title="NetSentinel API",
    description="Intelligent Network Monitoring, Fault Detection and Root-Cause Analysis Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_auth.router)
app.include_router(routes_devices.router)
app.include_router(routes_topology.router)
app.include_router(routes_incidents.router)
app.include_router(routes_scenarios.router)
app.include_router(routes_collector.router)
app.include_router(routes_reports.router)
app.include_router(routes_priority.router)
app.include_router(routes_ml.router)
app.include_router(routes_audit.router)
app.include_router(routes_users.router)
app.include_router(routes_ws.router)


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "netsentinel-backend"}
