"""
Multi-channel notification service for network incidents and alerts.

Supports:
- Console standard output
- Generic Slack/Discord/Teams compatible webhooks (HTTP POST)
- Direct SMTP email alerts (plain text + HTML template)
- Telegram bot alerts
"""
from __future__ import annotations

import email.message
import logging
import smtplib
import ssl

import httpx

from app.config import get_settings

logger = logging.getLogger("netsentinel.notifications")
settings = get_settings()


def _format_message(incident: dict) -> str:
    return (
        f"[NetSentinel] {incident.get('severity', 'UNKNOWN').upper()} incident {incident.get('incident_id', 'INC-TEST')}: "
        f"{incident.get('title', 'Network Alert')}\n"
        f"Probable root cause: {incident.get('probable_root_cause_device_id') or 'unknown'} "
        f"(confidence: {incident.get('root_cause_confidence_label', 'low')})\n"
        f"Affected: {', '.join(incident.get('affected_devices', [])) or 'n/a'}\n"
        f"Detected at: {incident.get('detected_at')}\n"
        f"Dashboard: /incidents/{incident.get('incident_id', '')}"
    )


def _format_html_message(incident: dict) -> str:
    severity = incident.get("severity", "medium").upper()
    color = "#ef4444" if severity == "CRITICAL" else "#f59e0b" if severity == "HIGH" else "#3b82f6"
    affected = ", ".join(incident.get("affected_devices", [])) or "None"
    root_cause = incident.get("probable_root_cause_device_id") or "Analyzing..."
    confidence = incident.get("root_cause_confidence_label", "medium").capitalize()

    return f"""<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background-color: #fafaf9; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; border: 1px solid #e7e5e4; padding: 24px;">
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f5f5f4; padding-bottom: 12px;">
      <h2 style="margin: 0; color: #1c1917; font-size: 18px;">NetSentinel Alert System</h2>
      <span style="background-color: {color}; color: #ffffff; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold;">
        {severity}
      </span>
    </div>
    <div style="margin-top: 16px;">
      <h3 style="margin: 0 0 8px 0; color: #0c0a09; font-size: 16px;">{incident.get('title', 'Network Incident Detected')}</h3>
      <p style="margin: 0 0 16px 0; color: #78716c; font-size: 13px;">Incident ID: <strong>{incident.get('incident_id', 'INC-TEST')}</strong> | Detected: {incident.get('detected_at', 'Now')}</p>
      
      <div style="background-color: #f5f5f4; border-left: 4px solid {color}; padding: 12px; border-radius: 4px; margin-bottom: 16px;">
        <p style="margin: 0 0 6px 0; font-size: 14px;"><strong>Probable Root Cause:</strong> {root_cause} (Confidence: {confidence})</p>
        <p style="margin: 0; font-size: 14px;"><strong>Affected Devices:</strong> {affected}</p>
      </div>

      <p style="font-size: 13px; color: #44403c; line-height: 1.5;">
        Automated topology correlation has isolated this fault. Please log in to the NetSentinel central dashboard to review the blast radius and execute recommended diagnostic checks.
      </p>
    </div>
  </div>
</body>
</html>"""


def _send_email(incident: dict, message: str) -> bool:
    if not settings.notify_email_enabled or not settings.smtp_host or not settings.smtp_to:
        return False

    recipients = [r.strip() for r in settings.smtp_to.split(",") if r.strip()]
    if not recipients:
        return False

    msg = email.message.EmailMessage()
    severity = incident.get("severity", "MEDIUM").upper()
    inc_id = incident.get("incident_id", "INC-ALERT")
    msg["Subject"] = f"[NetSentinel Alert] {severity} - {incident.get('title', inc_id)}"
    msg["From"] = settings.smtp_from or "netsentinel@companya.com"
    msg["To"] = ", ".join(recipients)
    msg.set_content(message)
    msg.add_alternative(_format_html_message(incident), subtype="html")

    try:
        context = ssl.create_default_context()
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=8.0) as server:
                if settings.smtp_user and settings.smtp_password:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=8.0) as server:
                if settings.smtp_use_tls:
                    server.starttls(context=context)
                if settings.smtp_user and settings.smtp_password:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
        logger.info("Email notification delivered to %s", recipients)
        return True
    except Exception as exc:
        logger.error("Failed to send email notification: %s", exc)
        return False


def _send_telegram(message: str) -> bool:
    if not settings.notify_telegram_bot_token or not settings.notify_telegram_chat_id:
        return False
    url = f"https://api.telegram.org/bot{settings.notify_telegram_bot_token}/sendMessage"
    payload = {"chat_id": settings.notify_telegram_chat_id, "text": message}
    try:
        resp = httpx.post(url, json=payload, timeout=5.0)
        return resp.status_code == 200
    except Exception as exc:
        logger.error("Telegram notification failed: %s", exc)
        return False


def send_incident_notification(incident: dict) -> dict:
    """Fire notifications across all active channels."""
    message = _format_message(incident)
    logger.warning(message)
    print(f"\n{'='*70}\nNOTIFICATION\n{'='*70}\n{message}\n{'='*70}\n")

    delivered_via = ["console"]

    # Webhook
    if settings.notify_webhook_url:
        try:
            httpx.post(settings.notify_webhook_url, json={"text": message}, timeout=5.0)
            delivered_via.append("webhook")
        except httpx.HTTPError as exc:
            logger.error("Webhook notification failed: %s", exc)

    # Email
    if _send_email(incident, message):
        delivered_via.append("email")

    # Telegram
    if _send_telegram(message):
        delivered_via.append("telegram")

    return {"message": message, "delivered_via": delivered_via}


def get_channel_statuses() -> dict:
    """Check configuration status of each alert channel."""
    return {
        "console": {"enabled": True, "target": "stdout/logging"},
        "webhook": {
            "enabled": bool(settings.notify_webhook_url),
            "target": settings.notify_webhook_url if settings.notify_webhook_url else "Not configured",
        },
        "email": {
            "enabled": settings.notify_email_enabled and bool(settings.smtp_host),
            "host": settings.smtp_host or "Not configured",
            "recipients": settings.smtp_to or "None",
            "port": settings.smtp_port,
        },
        "telegram": {
            "enabled": bool(settings.notify_telegram_bot_token and settings.notify_telegram_chat_id),
            "chat_id": settings.notify_telegram_chat_id or "Not configured",
        },
    }
