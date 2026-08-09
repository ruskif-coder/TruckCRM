import logging
import uuid
from datetime import datetime, timedelta

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, delete, select

from .. import audit, models  # audit уже здесь, local import ниже убран
from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_session
from ..limiter import limiter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
@limiter.limit("10/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    user = session.exec(select(models.User).where(models.User.username == form_data.username)).first()
    if not user or not user.is_active or not verify_password(form_data.password, user.password_hash):
        # Сообщение намеренно не уточняет, что именно неверно (логин,
        # пароль, отключённая учётка) - см. комментарий ниже. В журнал же
        # неудачная попытка пишется с тем логином, что ввели в форму -
        # внутренний admin-only журнал не показывается тому, кто логинится.
        audit.log_action(session, user=None, action="login_failed", zone="auth", username_override=form_data.username)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    user.last_seen_at = datetime.utcnow()
    session.add(user)
    session.commit()
    token = create_access_token(user.id, user.username)
    audit.log_action(session, user=user, action="login_success", zone="auth", entity_id=user.id)
    return {
        "access_token": token,
        "token_type": "bearer",
        # driver_id добавлен 2026-06-29 ("журнал пробегов") - фронту нужно
        # знать, с каким Driver-ом связан вошедший пользователь, чтобы
        # автозаполнить и заблокировать поле "Водитель" в форме на вкладке
        # "Пробеги" (см. auth/AuthContext.tsx, pages/Mileage.tsx).
        # consent_given добавлен 2026-07-04: фронт показывает модальное
        # окно согласия с обработкой ПД при первом входе (152-ФЗ).
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "full_name": user.full_name,
            "driver_id": user.driver_id,
            "consent_given": user.consent_given_at is not None,
        },
    }


@router.post("/logout", status_code=204)
def logout(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Фиксирует выход из системы в журнале. JWT-токен статeless — сервер
    его не инвалидирует, только пишет запись в лог и обновляет last_seen_at."""
    user.last_seen_at = datetime.utcnow()
    session.add(user)
    session.commit()
    audit.log_action(session, user=user, action="logout", zone="auth", entity_id=user.id)
    return None


@router.post("/change-password", status_code=204)
def change_password(
    payload: models.ChangePasswordRequest,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Смена пароля текущего пользователя. Доступна любой роли (водитель
    тоже может сменить пароль из мобильного кабинета). Старый пароль
    проверяется, чтобы нельзя было сменить пароль через чужой открытый сеанс.
    Новый пароль минимум 6 символов.
    """
    if not verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Неверный текущий пароль")
    if len(payload.new_password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Новый пароль должен содержать не менее 6 символов")
    user.password_hash = hash_password(payload.new_password)
    session.add(user)
    session.commit()
    audit.log_action(session, user=user, action="change_password", zone="auth", entity_id=user.id, entity_label=user.username)
    return None


class _VerifyPwd(BaseModel):
    password: str


@router.post("/verify-password", status_code=204)
def verify_password_endpoint(
    payload: _VerifyPwd,
    user: models.User = Depends(get_current_user),
):
    """Подтверждение чувствительного действия паролем ТЕКУЩЕГО пользователя
    (напр. удаление машины). Только проверяет пароль — ничего не меняет и не
    выдаёт токен. Неверный пароль → 400 (НЕ 401, иначе фронт разлогинит по
    глобальному 401-перехватчику; 401 остаётся признаком истёкшей сессии)."""
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Неверный пароль")
    return None


@router.get("/me")
def me(user: models.User = Depends(get_current_user), session: Session = Depends(get_session)):
    # Обновляем отметку активности при каждом обращении к /me (2026-07-07)
    user.last_seen_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "full_name": user.full_name,
        "driver_id": user.driver_id,
        "consent_given": user.consent_given_at is not None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Сброс пароля (2026-07-04)
# FUTURE_TASK: подключить SMTP — сейчас ссылка пишется только в лог;
# когда SMTP будет настроен, заменить logger.info на отправку письма.
# ──────────────────────────────────────────────────────────────────────────────

class _ResetRequestPayload(models.SQLModel):
    email: str


class _ResetPasswordPayload(models.SQLModel):
    token: str
    new_password: str


@router.post("/request-reset", status_code=200)
@limiter.limit("5/minute")
def request_reset(
    request: Request,
    payload: _ResetRequestPayload,
    session: Session = Depends(get_session),
):
    """Запрашивает ссылку для сброса пароля по email.
    Всегда возвращает 200 (нейтральный ответ — не раскрывает наличие email в системе).
    Токен действует 1 час. Без SMTP: ссылка пишется в лог.
    """
    user = session.exec(
        select(models.User).where(models.User.email == payload.email.strip().lower())
    ).first()
    if user and user.is_active:
        # Удаляем старые токены сброса пароля для этого пользователя (#148)
        session.exec(
            delete(models.PasswordResetToken).where(
                models.PasswordResetToken.user_id == user.id
            )
        )
        token_str = str(uuid.uuid4())
        prt = models.PasswordResetToken(
            token=token_str,
            user_id=user.id,
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
        session.add(prt)
        session.commit()
        # FUTURE_TASK: заменить logger.info на отправку письма через SMTP
        logger.info(
            "PASSWORD RESET LINK for %s: /reset-password?token=%s",
            payload.email,
            token_str,
        )
    # Нейтральный ответ в любом случае
    return {"detail": "Если email найден в системе, ссылка для сброса пароля выслана"}


@router.post("/reset-password", status_code=204)
def reset_password(
    payload: _ResetPasswordPayload,
    session: Session = Depends(get_session),
):
    """Устанавливает новый пароль по одноразовому токену.
    Токен должен быть действующим (не просрочен, не использован).
    Новый пароль — минимум 6 символов.
    """
    if len(payload.new_password) < 6:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пароль должен содержать не менее 6 символов")
    prt = session.exec(
        select(models.PasswordResetToken).where(models.PasswordResetToken.token == payload.token)
    ).first()
    if not prt or prt.used or prt.expires_at < datetime.utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ссылка для сброса пароля недействительна или устарела")
    user = session.get(models.User, prt.user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пользователь не найден")
    user.password_hash = hash_password(payload.new_password)
    prt.used = True
    session.add(user)
    session.add(prt)
    session.commit()
    audit.log_action(session, user=user, action="reset_password", zone="auth", entity_id=user.id, entity_label=user.username)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Согласие с обработкой персональных данных (152-ФЗ, 2026-07-04)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/my-zones")
def my_readable_zones(
    user: models.User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Зоны, доступные для чтения текущему пользователю.
    Используется фронтендом для динамической фильтрации навигационного меню
    (AppShell.tsx). admin и роли вне матрицы (manager, staff) получают все
    зоны; foreman/accountant/driver — только те, где can_read=True в таблице
    RolePermission. Endpoint открыт для любой авторизованной роли (не
    admin-only), поскольку каждый пользователь запрашивает только свои права.
    2026-07-07."""
    from ..permissions import CONFIGURABLE_ROLE_KEYS, ZONES
    if user.role == "admin" or user.role not in CONFIGURABLE_ROLE_KEYS:
        return {"zones": [z for z, _ in ZONES]}
    perms = session.exec(
        select(models.RolePermission).where(
            models.RolePermission.role == user.role,
            models.RolePermission.can_read == True,  # noqa: E712
        )
    ).all()
    return {"zones": [p.zone for p in perms]}


@router.post("/consent", status_code=204)
def give_consent(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Фиксирует факт принятия пользователем политики обработки ПД (152-ФЗ).
    Вызывается после того, как пользователь нажал «Принимаю» в модальном окне
    согласия при первом входе. Повторные вызовы безопасны (обновляют метку).
    """
    user.consent_given_at = datetime.utcnow()
    session.add(user)
    session.commit()
    return None
