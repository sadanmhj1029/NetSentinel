from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.security import create_access_token, get_current_user, verify_password
from app.services import audit
from app.services.login_guard import login_guard

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    address = request.client.host if request.client else "unknown"
    wait = login_guard.seconds_locked(form.username, address)
    if wait:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed attempts. Try again in {_human_wait(wait)}.",
            headers={"Retry-After": str(wait)},
        )

    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password) or not user.is_active:
        left = login_guard.record_failure(form.username, address)
        audit.record(db, username=form.username, action="login_failed" if left else "login_locked")
        if left == 0:
            wait = login_guard.seconds_locked(form.username, address)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed attempts. Try again in {_human_wait(wait)}.",
                headers={"Retry-After": str(wait)},
            )
        detail = "Incorrect username or password"
        if left <= 2:
            detail += f" ({left} attempt{'s' if left != 1 else ''} left before a short lockout)"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    login_guard.record_success(form.username, address)
    token = create_access_token(subject=user.username, role=user.role)
    audit.record(db, username=user.username, action="login_success")
    return {"access_token": token, "token_type": "bearer", "role": user.role, "username": user.username}


def _human_wait(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds} seconds"
    minutes = -(-seconds // 60)
    return f"{minutes} minute{'s' if minutes != 1 else ''}"


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return current_user.to_dict()
