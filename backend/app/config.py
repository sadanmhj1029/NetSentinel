"""
Central application configuration.

Everything here is overridable via environment variables (see .env.example
at the repo root). Nothing here is a secret by itself -- the real secrets
live in the deployer's .env file, which is git-ignored.
"""
from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Application
    app_mode: str = "demo"  # "demo" | "production"
    secret_key: str = "change-this-to-a-long-random-string"
    access_token_expire_minutes: int = 480
    algorithm: str = "HS256"

    # Database
    database_url: str = "postgresql+psycopg://netsentinel:netsentinel@localhost:5432/netsentinel"

    # Redis (reserved; the demo pipeline runs in-process without it)
    redis_url: str = "redis://localhost:6379/0"

    # Monitoring / collector
    poll_interval_seconds: float = 2.0
    collector_stale_after_seconds: float = 10.0
    polling_mode: str = "hybrid"  # "simulated" | "hybrid" | "live"

    # Rule-detection thresholds (defaults; also configurable per-device via the API)
    rule_consecutive_fails: int = 3
    rule_consecutive_recoveries: int = 3
    rule_packet_loss_pct: float = 10.0
    rule_high_cpu_pct: float = 90.0
    rule_high_memory_pct: float = 90.0
    rule_high_latency_ms: float = 150.0

    # Adaptive baseline
    baseline_window_size: int = 60
    baseline_min_samples: int = 15
    baseline_deviation_high: float = 3.5  # robust z-score considered "High" deviation
    baseline_deviation_medium: float = 2.0

    # ML
    ml_min_training_samples: int = 200
    ml_anomaly_contamination: float = 0.05
    ml_model_dir: str = "ml_models"

    # Correlation / root cause
    correlation_time_window_seconds: float = 20.0
    root_cause_high_confidence: float = 75.0
    root_cause_medium_confidence: float = 45.0

    # Notifications
    notify_webhook_url: str = ""
    notify_email_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "netsentinel@companya.com"
    smtp_to: str = ""
    smtp_use_tls: bool = True
    notify_telegram_bot_token: str = ""
    notify_telegram_chat_id: str = ""

    # Demo users (seeded once; change before any real deployment)
    demo_admin_password: str = "admin123"
    demo_operator_password: str = "operator123"
    demo_viewer_password: str = "viewer123"

    # CORS
    cors_origins: str = "http://localhost:5173,http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    return Settings()
