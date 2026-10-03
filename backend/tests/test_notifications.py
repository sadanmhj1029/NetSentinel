"""
Unit and integration tests for multi-channel notifications (console, webhook, email, telegram).
"""
from unittest.mock import MagicMock, patch

from app.services.notifications import (
    _format_html_message,
    _format_message,
    get_channel_statuses,
    send_incident_notification,
)


def test_format_message_plain_and_html():
    incident = {
        "incident_id": "INC-0001",
        "title": "Switch-02 Network Failure",
        "severity": "critical",
        "probable_root_cause_device_id": "Switch-02",
        "root_cause_confidence_label": "high",
        "affected_devices": ["Switch-02", "PC-03", "Server-01"],
        "detected_at": "2026-10-03T10:00:00Z",
    }
    plain = _format_message(incident)
    assert "CRITICAL incident INC-0001" in plain
    assert "Switch-02" in plain
    assert "/incidents/INC-0001" in plain

    html = _format_html_message(incident)
    assert "<!DOCTYPE html>" in html
    assert "NetSentinel Alert System" in html
    assert "Switch-02" in html
    assert "#ef4444" in html  # critical color


def test_send_incident_notification_console_only():
    incident = {
        "incident_id": "INC-0002",
        "title": "High Latency Warning",
        "severity": "medium",
        "probable_root_cause_device_id": "Server-01",
        "root_cause_confidence_label": "medium",
        "affected_devices": ["Server-01"],
        "detected_at": "2026-10-03T10:05:00Z",
    }
    with patch("app.services.notifications.settings") as mock_settings:
        mock_settings.notify_webhook_url = ""
        mock_settings.notify_email_enabled = False
        mock_settings.notify_telegram_bot_token = ""
        res = send_incident_notification(incident)
        assert res["delivered_via"] == ["console"]


def test_send_incident_notification_email_dispatch():
    incident = {
        "incident_id": "INC-0003",
        "title": "Switch-01 Outage",
        "severity": "critical",
        "probable_root_cause_device_id": "Switch-01",
        "root_cause_confidence_label": "high",
        "affected_devices": ["Switch-01", "PC-01"],
        "detected_at": "2026-10-03T10:10:00Z",
    }
    with (
        patch("app.services.notifications.settings") as mock_settings,
        patch("smtplib.SMTP") as mock_smtp,
    ):
        mock_settings.notify_webhook_url = ""
        mock_settings.notify_email_enabled = True
        mock_settings.smtp_host = "smtp.company.com"
        mock_settings.smtp_port = 587
        mock_settings.smtp_user = "alerts@company.com"
        mock_settings.smtp_password = "password"
        mock_settings.smtp_from = "alerts@company.com"
        mock_settings.smtp_to = "admin@company.com"
        mock_settings.smtp_use_tls = True
        mock_settings.notify_telegram_bot_token = ""

        smtp_instance = MagicMock()
        mock_smtp.return_value.__enter__.return_value = smtp_instance

        res = send_incident_notification(incident)
        assert "console" in res["delivered_via"]
        assert "email" in res["delivered_via"]
        assert smtp_instance.send_message.called


def test_channel_statuses():
    statuses = get_channel_statuses()
    assert "console" in statuses
    assert "webhook" in statuses
    assert "email" in statuses
    assert "telegram" in statuses
    assert statuses["console"]["enabled"] is True
