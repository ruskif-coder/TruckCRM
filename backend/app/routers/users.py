from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, hash_password, require_role
from ..database import get_session

# Роли по API (2026-06-28): управление пользователями - всегда только admin
# (не упомянуто в схеме "Разделение по зонам" пользователем -> самый строгий
# вариант по умолчанию, а не предположение).
router = APIRouter(prefix="/api/users", tags=["users"], dependencies=[Depends(require_role("admin"))])


def _public(user: models.User) -> dict:
    data = user.model_dump()
    data.pop("password_hash", None)
    return data


@router.get("/online/")
def list_online_users(session: Session = Depends(get_session)):
    """Пользователи, активные в последние 30 минут (2026-07-07).
    Используется в блоке аватаров AppShell ("Сейчас в системе") — admin-only.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=30)
    users = session.exec(
        select(models.User).where(
            models.User.is_active == True,  # noqa: E712
            models.User.last_seen_at >= cutoff,
        )
    ).all()
    return [_public(u) for u in users]


@router.get("/")
def list_users(session: Session = Depends(get_session)):
    users = session.exec(select(models.User)).all()
    return [_public(u) for u in users]


@router.post("/", status_code=201)
def create_user(
    payload: models.UserCreate,
    session: Session = Depends(get_session),
    actor: models.User = Depends(get_current_user),
):
    existing = session.exec(select(models.User).where(models.User.username == payload.username)).first()
    if existing:
        raise HTTPException(400, "Пользователь с таким именем уже существует")
    data = payload.model_dump(exclude={"password"})
    user = models.User(**data, password_hash=hash_password(payload.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    # Пароль (даже хэш) никогда не попадает в журнал - audit.mask().
    audit.log_action(
        session, user=actor, action="create", zone="users",
        entity_id=user.id, entity_label=user.username,
        after=audit.mask(user.model_dump(), "password_hash"),
    )
    return _public(user)


@router.put("/{user_id}")
def update_user(
    user_id: int,
    payload: models.UserUpdate,
    session: Session = Depends(get_session),
    actor: models.User = Depends(get_current_user),
):
    user = session.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    before = user.model_dump()
    data = payload.model_dump(exclude_unset=True)
    password = data.pop("password", None)
    for k, v in data.items():
        setattr(user, k, v)
    if password:
        user.password_hash = hash_password(password)
    session.add(user)
    session.commit()
    session.refresh(user)
    audit.log_action(
        session, user=actor, action="update", zone="users",
        entity_id=user.id, entity_label=user.username,
        before=audit.mask(before, "password_hash"), after=audit.mask(user.model_dump(), "password_hash"),
    )
    return _public(user)


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    actor: models.User = Depends(get_current_user),
):
    user = session.get(models.User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    before = user.model_dump()
    session.delete(user)
    session.commit()
    audit.log_action(
        session, user=actor, action="delete", zone="users",
        entity_id=user_id, entity_label=before.get("username", ""), before=audit.mask(before, "password_hash"),
    )
    return None
