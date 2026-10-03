"""
Notification abstraction (spec section 24).

At minimum the spec asks for "a working demo notification mechanism".
This always logs to the console/log stream (so the demo always has
*something* visible without any configuration), additionally posts to a
generic Slack-compatible webhook when NOTIFY_WEBHOOK_URL is set, and
additionally sends a real SMTP email when NOTIFY_EMAIL_ENABLED and
SMTP_HOST are both set. Telegram is still just modeled as a settings
placeholder (see app/config.py) -- not implemented, setting those env
vars does nothing yet.
"""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

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


def _send_email(incident: dict, message: str) -> None:
    """Raises on any failure -- the caller decides what that means for
    the other channels (nothing, they're independent)."""
    recipients = [addr.strip() for addr in settings.smtp_to.split(",") if addr.strip()]
    if not recipients:
        raise ValueError("NOTIFY_EMAIL_ENABLED is on but SMTP_TO has no recipients configured")

    email = EmailMessage()
    email["Subject"] = f"[NetSentinel] {incident['severity'].upper()} incident: {incident['title']}"
    email["From"] = settings.smtp_from
    email["To"] = ", ".join(recipients)
    email.set_content(message)

    if settings.smtp_use_tls:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
            client.starttls()
            if settings.smtp_user:
                client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(email)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
            if settings.smtp_user:
                client.login(settings.smtp_user, settings.smtp_password)
            client.send_message(email)


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

    if settings.notify_email_enabled and settings.smtp_host:
        try:
            _send_email(incident, message)
            delivered_via.append("email")
        except Exception as exc:  # smtplib raises several distinct exception
            # types (SMTPAuthenticationError, SMTPConnectError, OSError, ...);
            # one broad catch keeps a bad SMTP config from ever blocking the
            # console/webhook channels, which is the whole point of having
            # more than one channel.
            logger.error("Email notification failed: %s", exc)

    return {"message": message, "delivered_via": delivered_via}
