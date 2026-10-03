"""
Feature engineering shared by training and inference.

Isolation Forest sees the same feature set in both places:
    latency_ms, packet_loss_pct, cpu_pct, memory_pct,
    bandwidth_in_mbps, bandwidth_out_mbps,
    rolling_mean_latency, rolling_std_latency, rate_of_change_latency

Rolling stats are computed per-device (a window spanning multiple devices
would be meaningless) over a short trailing window, which is why the
raw query is always ordered by timestamp per device before the rolling
ops run.
"""
from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS = [
    "latency_ms",
    "packet_loss_pct",
    "cpu_pct",
    "memory_pct",
    "bandwidth_in_mbps",
    "bandwidth_out_mbps",
    "rolling_mean_latency",
    "rolling_std_latency",
    "rate_of_change_latency",
]

ROLLING_WINDOW = 5


def samples_to_frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["device_id", "timestamp"])
    return df


def add_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    df = df.copy()
    grouped = df.groupby("device_id")["latency_ms"]
    df["rolling_mean_latency"] = grouped.transform(
        lambda s: s.rolling(ROLLING_WINDOW, min_periods=1).mean()
    )
    df["rolling_std_latency"] = grouped.transform(
        lambda s: s.rolling(ROLLING_WINDOW, min_periods=1).std()
    ).fillna(0.0)
    df["rate_of_change_latency"] = grouped.transform(lambda s: s.diff().fillna(0.0))
    return df


def build_feature_matrix(rows: list[dict]) -> pd.DataFrame:
    """rows: metric sample dicts (see MetricSample.to_dict), only
    `reachable=True` rows with non-null core metrics."""
    df = samples_to_frame(rows)
    if df.empty:
        return df
    df = df[df["reachable"] == True]  # noqa: E712
    df = df.dropna(subset=["latency_ms", "cpu_pct", "memory_pct"])
    if df.empty:
        return df
    df = add_rolling_features(df)
    df[FEATURE_COLUMNS] = df[FEATURE_COLUMNS].fillna(0.0)
    return df
