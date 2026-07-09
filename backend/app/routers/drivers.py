"""Drivers CRUD - a dedicated router rather than the generic make_router
(crud.py), because `name` (the legacy "Фамилия Имя" display field used by
importers/common.py's surname-matching) has to stay in sync with the
structured last_name/first_name fields added for the registration-card
form (see models.DriverBase, 2026-06-19). Whenever last_name/first_name
change, name is recomputed the same way fio_to_display_name() builds it
("Фамилия Имя", no patronymic) - so existing Trip/FuelRecord driver_id FKs
and the import matching logic keep working unchanged.
"""

import re
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, hash_password, require_role, require_zone
from ..database import get_session

router = APIRouter(prefix="/api/drivers", tags=["drivers"])
# Роли по API (2026-06-28, "Разделение по зонам"; настраивается через
# "Настройки -> Роли" с того же дня, см. permissions.py): зона "drivers" -
# дефолт - бригадир. require_zone() читает текущие права из БД, а не из
# зашитого списка ролей.
_read = [Depends(require_zone("drivers", "read"))]
_write = [Depends(require_zone("drivers", "write"))]

# "Создать аккаунт" (2026-06-28, план "кабинет водителя", п.2) - строже, чем
# остальная запись в этом роутере: управление учётками/паролями - всегда
# только admin, по тому же принципу, что и весь routers/users.py ("самый
# строгий вариант по умолчанию, а не предположение" - см. комментарий там).
_account_write = [Depends(require_role("admin"))]
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _digits_only(s: str) -> str:
    return "".join(ch for ch in s if ch.isdigit())


def _generate_password(length: int = 16) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


def _mask_driver(d: dict) -> dict:
    """Не возвращаем хэш mobile_password в ответах API — фронт не должен
    видеть даже bcrypt-строку. При редактировании поле приходит пустым;
    если admin вводит новый пароль — он хешируется и сохраняется."""
    d.pop("mobile_password", None)
    return d


def _hash_mobile_password_if_needed(data: dict) -> None:
    """Если в data есть непустой mobile_password — хешируем bcrypt на месте."""
    pw = data.get("mobile_password")
    if pw:
        data["mobile_password"] = hash_password(pw)
    elif "mobile_password" in data:
        # Пустая строка в update — не трогаем существующий хэш (pop из data,
        # чтобы _PATCH-семантика exclude_unset работала правильно).
        data.pop("mobile_password")


def _sync_display_name(data: dict, existing_last_name: str = "", existing_first_name: str = "") -> None:
    """Mutates `data["name"]` in place from last_name/first_name, falling
    back to whatever the row already has for any key the caller didn't
    touch. No-ops if both are still blank (e.g. a row split() couldn't
    parse), leaving `name` whatever it already was."""
    last_name = data["last_name"] if "last_name" in data else existing_last_name
    first_name = data["first_name"] if "first_name" in data else existing_first_name
    if last_name or first_name:
        data["name"] = f"{last_name} {first_name}".strip()


@router.get("/", dependencies=_read)
def list_drivers(session: Session = Depends(get_session)):
    items = session.exec(select(models.Driver)).all()
    return [_mask_driver(i.model_dump()) for i in items]


@router.get("/{driver_id}", dependencies=_read)
def get_driver(driver_id: int, session: Session = Depends(get_session)):
    item = session.get(models.Driver, driver_id)
    if not item:
        raise HTTPException(404, "driver not found")
    return _mask_driver(item.model_dump())


@router.post("/", status_code=201, dependencies=_write)
def create_driver(
    payload: models.DriverCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    data = payload.model_dump()
    _hash_mobile_password_if_needed(data)
    _sync_display_name(data)
    if not data.get("name"):
        data["name"] = "Новый водитель"
    item = models.Driver(**data)
    session.add(item)
    session.commit()
    session.refresh(item)
    after = _mask_driver(item.model_dump())
    audit.log_action(session, user=user, action="create", zone="drivers", entity_id=item.id, entity_label=after.get("name", ""), after=after)
    return after


@router.put("/{driver_id}", dependencies=_write)
def update_driver(
    driver_id: int,
    payload: models.DriverUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.Driver, driver_id)
    if not item:
        raise HTTPException(404, "driver not found")
    before = item.model_dump()
    data = payload.model_dump(exclude_unset=True)
    _hash_mobile_password_if_needed(data)
    _sync_display_name(data, item.last_name, item.first_name)
    for k, v in data.items():
        setattr(item, k, v)
    session.add(item)
    session.commit()
    session.refresh(item)
    after = _mask_driver(item.model_dump())
    audit.log_action(session, user=user, action="update", zone="drivers", entity_id=item.id, entity_label=after.get("name", ""), before=before, after=after)
    return after


@router.delete("/{driver_id}", status_code=204, dependencies=_write)
def delete_driver(
    driver_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.Driver, driver_id)
    if not item:
        raise HTTPException(404, "driver not found")
    before = item.model_dump()
    session.delete(item)
    session.commit()
    audit.log_action(session, user=user, action="delete", zone="drivers", entity_id=driver_id, entity_label=before.get("name", ""), before=before)
    return None


@router.post("/{driver_id}/create-account", dependencies=_account_write)
def create_driver_account(
    driver_id: int,
    session: Session = Depends(get_session),
    actor: models.User = Depends(get_current_user),
):
    """Создаёт учётку «Пользователи» (role=driver, привязка через
    driver_id - тот же механизм own-data фильтра, что и ручное создание на
    странице Пользователи) прямо из карточки водителя. Логин - телефон
    (только цифры), пароль - случайные 16 символов, отдаются один раз в
    ответе и больше никогда (хранится только bcrypt-хэш, как и везде в
    auth.py). Повторный вызов на водителе с уже существующей учёткой не
    создаёт вторую - сбрасывает пароль у существующей (см. `reset` в ответе),
    это самый частый повод нажать кнопку ещё раз ("забыли пароль")."""
    driver = session.get(models.Driver, driver_id)
    if not driver:
        raise HTTPException(404, "driver not found")

    phone_digits = _digits_only(driver.phone or "")
    if len(phone_digits) < 10:
        raise HTTPException(
            400, "У водителя не указан корректный телефон — заполните карточку перед созданием аккаунта"
        )
    if not driver.email or not _EMAIL_RE.match(driver.email):
        raise HTTPException(
            400, "У водителя не указан корректный email — заполните карточку перед созданием аккаунта"
        )

    existing = session.exec(select(models.User).where(models.User.driver_id == driver_id)).first()
    password = _generate_password()

    if existing:
        existing.password_hash = hash_password(password)
        existing.is_active = True
        session.add(existing)
        session.commit()
        session.refresh(existing)
        # reset_password: пароль никогда не попадает в журнал, даже в виде
        # bcrypt-хэша - audit.mask() вырезает password_hash из снимка.
        audit.log_action(
            session, user=actor, action="reset_password", zone="users",
            entity_id=existing.id, entity_label=existing.username,
            after=audit.mask(existing.model_dump(), "password_hash"),
        )
        return {"username": existing.username, "password": password, "reset": True}

    # Логин по умолчанию - цифры телефона; на случай редкого совпадения с
    # чужим логином (учётка создана вручную на странице Пользователи под
    # тем же телефоном, но без привязки driver_id) - добираем суффикс,
    # не 400, чтобы кнопка не блокировалась без явной причины для админа.
    username = phone_digits
    suffix = 1
    while session.exec(select(models.User).where(models.User.username == username)).first():
        suffix += 1
        username = f"{phone_digits}_{suffix}"

    user = models.User(
        username=username,
        role="driver",
        full_name=driver.name or "",
        driver_id=driver_id,
        password_hash=hash_password(password),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    audit.log_action(
        session, user=actor, action="create", zone="users",
        entity_id=user.id, entity_label=user.username,
        after=audit.mask(user.model_dump(), "password_hash"),
    )
    return {"username": user.username, "password": password, "reset": False}
