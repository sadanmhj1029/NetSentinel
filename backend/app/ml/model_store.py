"""
Persistence for the trained Isolation Forest model + scaler + metadata.

Kept deliberately simple (joblib + a JSON sidecar on local disk) --
that's the "model persistence" requirement from spec section 11, and it's
all a single-process hackathon prototype needs. docs/ARCHITECTURE.md
notes the path to a real model registry.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import threading
from dataclasses import asdict, dataclass, field

import joblib

from app.config import get_settings
from app.utils import utcnow

settings = get_settings()

_MODEL_FILENAME = "isolation_forest.joblib"
_SCALER_FILENAME = "scaler.joblib"
_META_FILENAME = "metadata.json"


@dataclass
class ModelMetadata:
    version: int = 0
    trained_at: str | None = None
    n_samples: int = 0
    n_devices: int = 0
    features: list[str] = field(default_factory=list)
    contamination: float = 0.05
    anomaly_score_threshold: float = 0.0
    enabled: bool = False
    status: str = "untrained"  # untrained | training | ready | failed
    last_error: str | None = None
    evaluation: dict = field(default_factory=dict)


class ModelStore:
    def __init__(self, model_dir: str | None = None) -> None:
        self.model_dir = model_dir or settings.ml_model_dir
        os.makedirs(self.model_dir, exist_ok=True)
        self._lock = threading.Lock()
        self._model = None
        self._scaler = None
        self._metadata = self._load_metadata()

    # -- paths -------------------------------------------------------- #
    def _path(self, filename: str) -> str:
        return os.path.join(self.model_dir, filename)

    # -- metadata ------------------------------------------------------ #
    def _load_metadata(self) -> ModelMetadata:
        path = self._path(_META_FILENAME)
        if os.path.exists(path):
            with open(path) as f:
                data = json.load(f)
            return ModelMetadata(**data)
        return ModelMetadata()

    def _save_metadata(self) -> None:
        with open(self._path(_META_FILENAME), "w") as f:
            json.dump(asdict(self._metadata), f, indent=2)

    @property
    def metadata(self) -> ModelMetadata:
        return self._metadata

    def set_enabled(self, enabled: bool) -> None:
        with self._lock:
            self._metadata.enabled = enabled
            self._save_metadata()

    def mark_training(self) -> None:
        with self._lock:
            self._metadata.status = "training"
            self._save_metadata()

    def mark_failed(self, error: str) -> None:
        with self._lock:
            self._metadata.status = "failed"
            self._metadata.last_error = error
            self._save_metadata()

    # -- model ---------------------------------------------------------#
    def save(self, model, scaler, metadata: ModelMetadata) -> None:
        with self._lock:
            joblib.dump(model, self._path(_MODEL_FILENAME))
            joblib.dump(scaler, self._path(_SCALER_FILENAME))
            metadata.trained_at = utcnow().isoformat()
            metadata.version = self._metadata.version + 1
            metadata.status = "ready"
            metadata.last_error = None
            # preserve the enabled flag across retrains unless this is the
            # very first successful training, in which case auto-enable.
            metadata.enabled = True if self._metadata.version == 0 else self._metadata.enabled
            self._metadata = metadata
            self._model = model
            self._scaler = scaler
            self._save_metadata()

    def load(self):
        with self._lock:
            if self._model is not None and self._scaler is not None:
                return self._model, self._scaler
            model_path, scaler_path = self._path(_MODEL_FILENAME), self._path(_SCALER_FILENAME)
            if not (os.path.exists(model_path) and os.path.exists(scaler_path)):
                return None, None
            self._model = joblib.load(model_path)
            self._scaler = joblib.load(scaler_path)
            return self._model, self._scaler

    def is_ready(self) -> bool:
        return self._metadata.status == "ready" and self._metadata.enabled


model_store = ModelStore()
