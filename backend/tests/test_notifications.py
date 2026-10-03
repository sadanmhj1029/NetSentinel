"""Notification channels: console is always on, webhook and email are
independent of each other -- one misconfigured channel must never
silently swallow the others."""
from unittest.mock import MagicMock, patch

from app.services import notifications


def _incident(**overrides):
    base = dict(
        incident_id="inc-1",
        severity="critical",
        title="Switch-02 unreachable",
        probable_root_cause_device_id="Switch-02",
        root_cause_confidence_label="high",
        affected_devices=["Switch-02", "PC-03"],
        detected_at="2026-01-01T00:00:00Z",
    )
    base.update(overrides)
    return base


def test_email_not_attempted_when_disabled(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", False)
    monkeypatch.setattr(notifications.settings, "smtp_host", "smtp.example.com")

    with patch("smtplib.SMTP") as mock_smtp:
        result = notifications.send_incident_notification(_incident())

    mock_smtp.assert_not_called()
    assert "email" not in result["delivered_via"]
    assert "console" in result["delivered_via"]


def test_email_not_attempted_when_host_missing(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", True)
    monkeypatch.setattr(notifications.settings, "smtp_host", "")

    with patch("smtplib.SMTP") as mock_smtp:
        result = notifications.send_incident_notification(_incident())

    mock_smtp.assert_not_called()
    assert "email" not in result["delivered_via"]


def test_email_sent_via_starttls_when_enabled(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", True)
    monkeypatch.setattr(notifications.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(notifications.settings, "smtp_port", 587)
    monkeypatch.setattr(notifications.settings, "smtp_user", "")
    monkeypatch.setattr(notifications.settings, "smtp_password", "")
    monkeypatch.setattr(notifications.settings, "smtp_from", "netsentinel@companya.com")
    monkeypatch.setattr(notifications.settings, "smtp_to", "admin@companya.com, ops@companya.com")
    monkeypatch.setattr(notifications.settings, "smtp_use_tls", True)

    mock_client = MagicMock()
    with patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = mock_client
        result = notifications.send_incident_notification(_incident())

    mock_smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
    mock_client.starttls.assert_called_once()
    mock_client.login.assert_not_called()  # no smtp_user configured
    sent_email = mock_client.send_message.call_args[0][0]
    assert sent_email["To"] == "admin@companya.com, ops@companya.com"
    assert "CRITICAL" in sent_email["Subject"]
    assert "email" in result["delivered_via"]


def test_email_logs_in_when_credentials_configured(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", True)
    monkeypatch.setattr(notifications.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(notifications.settings, "smtp_port", 587)
    monkeypatch.setattr(notifications.settings, "smtp_user", "netsentinel")
    monkeypatch.setattr(notifications.settings, "smtp_password", "secret")
    monkeypatch.setattr(notifications.settings, "smtp_from", "netsentinel@companya.com")
    monkeypatch.setattr(notifications.settings, "smtp_to", "admin@companya.com")
    monkeypatch.setattr(notifications.settings, "smtp_use_tls", True)

    mock_client = MagicMock()
    with patch("smtplib.SMTP") as mock_smtp:
        mock_smtp.return_value.__enter__.return_value = mock_client
        notifications.send_incident_notification(_incident())

    mock_client.login.assert_called_once_with("netsentinel", "secret")


def test_email_failure_does_not_block_other_channels(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", True)
    monkeypatch.setattr(notifications.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(notifications.settings, "smtp_to", "admin@companya.com")
    monkeypatch.setattr(notifications.settings, "smtp_use_tls", True)
    monkeypatch.setattr(notifications.settings, "notify_webhook_url", "")

    with patch("smtplib.SMTP", side_effect=OSError("connection refused")):
        result = notifications.send_incident_notification(_incident())

    assert "email" not in result["delivered_via"]
    assert result["delivered_via"] == ["console"]


def test_email_with_no_recipients_fails_gracefully(monkeypatch):
    monkeypatch.setattr(notifications.settings, "notify_email_enabled", True)
    monkeypatch.setattr(notifications.settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(notifications.settings, "smtp_to", "")  # misconfigured on purpose

    with patch("smtplib.SMTP") as mock_smtp:
        result = notifications.send_incident_notification(_incident())

    mock_smtp.assert_not_called()
    assert "email" not in result["delivered_via"]
