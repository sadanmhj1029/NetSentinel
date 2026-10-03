from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def record(
    db: Session,
    username: str,
    action: str,
    resource: str | None = None,
    previous_state: dict | None = None,
    new_state: dict | None = None,
    ip_address: str | None = None,
) -> None:
    db.add(
        AuditLog(
            username=username,
            action=action,
            resource=resource,
            previous_state=previous_state,
            new_state=new_state,
            ip_address=ip_address,
        )
    )
    db.commit()
