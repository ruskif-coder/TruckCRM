"""Персональные настройки интерфейса за пользователем (per-user key→JSON).

Заменяет localStorage для того, что должно переживать чистку кеша/смену
устройства — например раскладку рабочего стола /newdash (расположение,
размеры и видимость виджетов). Каждый пользователь читает/пишет только свои
записи (фильтр по current_user), поэтому отдельных ролей-зон не требуется —
любой залогиненный хранит собственные предпочтения.

Ключи короткие и без слэшей (валидируются), значение — произвольный JSON,
в БД лежит строкой (models.UserPref.value). Пустой GET отдаёт value=null.
"""
import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user
from ..database import get_session

router = APIRouter(prefix="/api/user-prefs", tags=["user-prefs"])

_KEY_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_MAX_VALUE = 64 * 1024  # 64 КБ на запись — с запасом для раскладки стола


class _PrefBody(BaseModel):
    value: object = None  # произвольный JSON


def _check_key(key: str) -> None:
    if not _KEY_RE.match(key):
        raise HTTPException(400, "Недопустимый ключ настройки")


@router.get("/{key}")
def get_pref(
    key: str,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    _check_key(key)
    row = session.exec(
        select(models.UserPref).where(
            models.UserPref.user_id == user.id, models.UserPref.key == key
        )
    ).first()
    if not row:
        return {"key": key, "value": None}
    try:
        value = json.loads(row.value) if row.value else None
    except ValueError:
        value = None
    return {"key": key, "value": value}


@router.put("/{key}")
def put_pref(
    key: str,
    body: _PrefBody,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    _check_key(key)
    raw = json.dumps(body.value, ensure_ascii=False, separators=(",", ":"))
    if len(raw) > _MAX_VALUE:
        raise HTTPException(413, "Слишком большой объём настройки")
    row = session.exec(
        select(models.UserPref).where(
            models.UserPref.user_id == user.id, models.UserPref.key == key
        )
    ).first()
    if row:
        row.value = raw
        row.updated_at = models.datetime.utcnow()
    else:
        row = models.UserPref(user_id=user.id, key=key, value=raw)
    session.add(row)
    session.commit()
    return {"key": key, "value": body.value}
