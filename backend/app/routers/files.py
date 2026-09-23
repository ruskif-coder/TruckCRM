"""Защищённая раздача статических файлов (фото приёмки, сканы документов).

Заменяет StaticFiles-монты в main.py — они раздавали файлы публично, без
авторизации (аудит безопасности 2026-07-13, 152-ФЗ; монты окончательно
удалены в аудите 2026-09-23).

Токен принимается двумя способами:
  * query-параметр ?token=  — для браузерных <img src>/<a href>, которые не
    умеют слать заголовок Authorization (инлайновый просмотр фото/сканов);
  * заголовок Authorization: Bearer <jwt> — для fetch-скачиваний (api.download).
Скачивание документов (api.download) использует заголовок, поэтому токен в
URL там больше не нужен — не течёт в логи прокси/историю (аудит 2026-09-23).
"""
import os
from pathlib import Path
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlmodel import Session

from .. import models
from ..auth import SECRET_KEY, ALGORITHM
from ..database import get_session

router = APIRouter(tags=["files"])


def _verify_access(
    token: Optional[str],
    authorization: Optional[str],
    session: Session,
) -> None:
    """Проверяет JWT (из ?token= или из Authorization: Bearer) и что
    пользователь всё ещё существует и активен. 401 при любой проблеме."""
    raw = token
    if not raw and authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
    err = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Недействительный или просроченный токен",
    )
    if not raw:
        raise err
    try:
        payload = jwt.decode(raw, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (jwt.PyJWTError, TypeError, ValueError):
        raise err
    user = session.get(models.User, user_id)
    if not user or not user.is_active:
        raise err


def _serve(base_env: str, default_dir: str, filename: str) -> FileResponse:
    # Защита от path-traversal: берём только имя файла без директории.
    safe_name = Path(filename).name
    path = Path(os.environ.get(base_env, default_dir)) / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path)


@router.get("/api/files/photos/{filename}")
def serve_photo(
    filename: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    session: Session = Depends(get_session),
) -> FileResponse:
    _verify_access(token, authorization, session)
    return _serve("PHOTOS_DIR", "./photos", filename)


@router.get("/api/files/truck-scans/{filename}")
def serve_truck_scan(
    filename: str,
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    session: Session = Depends(get_session),
) -> FileResponse:
    _verify_access(token, authorization, session)
    return _serve("TRUCK_SCANS_DIR", "./truck_scans", filename)
