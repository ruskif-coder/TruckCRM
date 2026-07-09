"""Password hashing + JWT auth helpers.

Scope decided 2026-06-20: login is required for every API call (except
/api/auth/login and /api/health). Per-role restriction landed 2026-06-28
(require_role()/require_staff below) using the "Разделение по зонам" scheme
the user picked: бухгалтер -> расходы/топливо/перевозчики; бригадир ->
машины/водители/рейсы; водитель -> read-only, own рейсы/заправки only
(row-level filter, see crud.py own_filter_field); admin -> unrestricted
everywhere. Routers wire these in per-route (see routers/*.py and crud.py).
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlmodel import Session, select

from . import models
from .database import get_session

_JWT_DEV_FALLBACK = "transport-crm-dev-secret-INSECURE-DO-NOT-USE-IN-PRODUCTION"
_jwt_env = os.environ.get("JWT_SECRET", "")

if not _jwt_env:
    import warnings
    warnings.warn(
        "\n\n"
        "  ╔══════════════════════════════════════════════════════════════╗\n"
        "  ║  ВНИМАНИЕ: JWT_SECRET не задан в окружении!                 ║\n"
        "  ║  Используется небезопасный dev-ключ.                        ║\n"
        "  ║  В production ОБЯЗАТЕЛЬНО задайте:                          ║\n"
        "  ║    JWT_SECRET=<случайная строка 32+ символов>               ║\n"
        "  ║  Генерация: python -c \"import secrets;                       ║\n"
        "  ║              print(secrets.token_hex(32))\"                   ║\n"
        "  ╚══════════════════════════════════════════════════════════════╝\n",
        stacklevel=1,
    )

SECRET_KEY = _jwt_env or _JWT_DEV_FALLBACK
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24 * 7  # internal tool - a week-long session is fine

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: int, username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)
) -> models.User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось подтвердить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise credentials_error
    user = session.get(models.User, user_id)
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_role(*roles: str):
    """Dependency factory: 403s unless the current user's role is "admin" or
    one of `roles`. admin is always implicitly allowed - callers never need
    to list it themselves. Used directly on write routes (POST/PUT/DELETE)
    that should be restricted to a zone, e.g.
    `Depends(require_role("admin", "foreman"))` on trucks/drivers/trips
    writes, `Depends(require_role("admin", "accountant"))` on fuel/expenses/
    carriers writes."""

    def _check(user: models.User = Depends(get_current_user)) -> models.User:
        if user.role != "admin" and user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для этого действия")
        return user

    return _check


# Convenience dependency for whole routers the "driver" role should never see
# at all (машины/водители/расходы/перевозчики/пользователи/настройки/условия
# оплаты) - driver only gets scoped read access to own рейсы/заправки, wired
# separately via own_filter_field in crud.py, not through this dependency.
require_staff = require_role("admin", "foreman", "accountant")


def require_zone(zone: str, action: str):
    """Dependency factory backed by the configurable RolePermission table
    (см. permissions.py, страница "Настройки -> Роли", добавлено 2026-06-28) -
    used for the "operational" zones (permissions.ZONES) instead of the
    static require_role(...) above, so admin can change foreman/accountant/
    driver access from the UI without a code change/redeploy.

    admin всегда проходит безусловно, как и в require_role. Для остальных
    ролей смотрит (role, zone) в таблице; если строки нет вообще - доступа
    нет (fail closed), а не "как получится" - так новая зона по умолчанию
    закрыта, пока админ явно не откроет её на странице Роли (на практике
    permissions.seed_default_role_permissions заполняет все известные пары
    при старте, так что это короткое замыкание срабатывает только для
    зон/ролей, добавленных после очередного деплоя и ещё не дозаполненных).
    `action` - "read" или "write".

    routers/users.py, routers/settings.py, routers/driver_rates.py,
    routers/trip_batches.py намеренно НЕ переведены на эту зависимость -
    они остаются на require_role("admin") напрямую (см. permissions.py
    module docstring - защитный пол от самоэскалации прав)."""

    def _check(
        user: models.User = Depends(get_current_user),
        session: Session = Depends(get_session),
    ) -> models.User:
        if user.role == "admin":
            return user
        perm = session.exec(
            select(models.RolePermission).where(
                models.RolePermission.role == user.role,
                models.RolePermission.zone == zone,
            )
        ).first()
        allowed = bool(perm and (perm.can_write if action == "write" else perm.can_read))
        if not allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Недостаточно прав для этого действия")
        return user

    return _check


def seed_default_admin(session: Session) -> None:
    """Create or update the admin account on startup.

    Поведение:
    - Если таблица пустая — создаёт admin с учётными данными из env
      (ADMIN_USERNAME / ADMIN_PASSWORD), либо fallback dev-дефолты.
    - Если ADMIN_PASSWORD задан в env — ВСЕГДА обновляет пароль admin-а,
      даже если аккаунт уже существует. Это позволяет безопасно менять
      пароль через docker-compose env без скриптов или потери доступа.
    - Если ADMIN_PASSWORD НЕ задан — существующий аккаунт не трогается
      (dev-режим, пароль менять не нужно).

    Для production обязательно задай ADMIN_PASSWORD в окружении.
    """
    env_username = os.environ.get("ADMIN_USERNAME", "admin")
    env_password = os.environ.get("ADMIN_PASSWORD")  # None в dev-режиме

    existing = session.exec(select(models.User)).first()

    if not existing:
        # Первый старт — создаём admin
        pw = env_password or "admin123"  # dev fallback
        admin = models.User(
            username=env_username,
            password_hash=hash_password(pw),
            role="admin",
            full_name="Администратор",
            is_active=True,
        )
        session.add(admin)
        session.commit()
        return

    # Таблица уже имеет данные. Обновляем пароль только если ADMIN_PASSWORD задан.
    if env_password:
        admin = session.exec(
            select(models.User).where(models.User.role == "admin")
        ).first()
        if admin:
            admin.password_hash = hash_password(env_password)
            if env_username and admin.username != env_username:
                admin.username = env_username
            session.add(admin)
            session.commit()
