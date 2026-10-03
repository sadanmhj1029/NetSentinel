"""
Notification abstraction (spec section 24).

At minimum the spec asks for "a working demo notification mechanism".
This always logs to the console/log stream (so the demo always has
*something* visible without any configuration) and additionally posts to
a generic Slack-compatible webhook when NOTIFY_WEBHOOK_URL is set.
Email/Telegram are modeled as the same interface so adding a real sender
later is a one-function change, not a redesign.
"""
from __future__ import annotations

import logging

import httpx

from app.config import get_settings

logger = logging.getLogger("netsentinel.notifications")
settings = get_settings()


def _format_message(incident: dict) -> str:
    return (
        f"[NetSentinel] {incident['severity'].upper()} incident {incident['incident_id']}: "
        f"{incident['title']}\n"
        f"Probable root cause: {incident.get('probable_root_cause_device_id') or 'unknown'} "
        f"(confidence: {incident.get('root_cause_confidence_label', 'low')})\n"
        f"Affected: {', '.join(incident.get('affected_devices', [])) or 'n/a'}\n"
        f"Detected at: {incident.get('detected_at')}\n"
        f"Dashboard: /incidents/{incident['incident_id']}"
    )


def send_incident_notification(incident: dict) -> dict:
    """Fire exactly one notification for a (new or newly re-escalated)
    incident. Callers are responsible for the dedup rule -- this function
    does not check `incident['notified']` itself, see
    app/incidents/engine.py."""
    message = _format_message(incident)
    logger.warning(message)
    print(f"\n{'='*70}\nNOTIFICATION\n{'='*70}\n{message}\n{'='*70}\n")

    delivered_via = ["console"]

    if settings.notify_webhook_url:
        try:
            httpx.post(settings.notify_webhook_url, json={"text": message}, timeout=5.0)
            delivered_via.append("webhook")
        except httpx.HTTPError as exc:
            logger.error("Webhook notification failed: %s", exc)

    return {"message": message, "delivered_via": delivered_via}
