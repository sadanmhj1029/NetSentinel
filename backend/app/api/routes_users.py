from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas import UserCreate
from app.security import hash_password, require_role
from app.services import audit

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = {"viewer", "operator", "admin"}


@router.get("")
def list_users(db: Session = Depends(get_db), _user=Depends(require_role("admin"))):
    return [u.to_dict() for u in db.query(User).order_by(User.username).all()]


@router.post("")
def create_user(body: UserCreate, db: Session = Depends(get_db), user=Depends(require_role("admin"))):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of {VALID_ROLES}")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    new_user = User(username=body.username, hashed_password=hash_password(body.password), role=body.role)
    db.add(new_user)
    db.commit()
    audit.record(db, user.username, "user_created", resource=body.username, new_state={"role": body.role})
    return new_user.to_dict()
