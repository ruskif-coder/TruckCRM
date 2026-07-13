"""Защищённая раздача статических файлов (фото приёмки, сканы документов).

Заменяет StaticFiles-монты в main.py — они раздавали файлы публично, без
авторизации (аудит безопасности 2026-07-13, 152-ФЗ).

Токен передаётся как query-параметр ?token= потому что браузерные
<img src> и <a href> не умеют посылать заголовок Authorization.
"""
import os
from pathlib import Path

import jwt
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import FileResponse

from ..auth import SECRET_KEY, ALGORITHM

router = APIRouter(tags=["files"])


def _verify_token(token: str) -> None:
    """Проверяет JWT query-param токен. 401 если невалидный/просроченный."""
    try:
        jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Недействительный или просроченный токен",
        )


@router.get("/api/files/photos/{filename}")
def serve_photo(filename: str, token: str = Query(...)) -> FileResponse:
    _verify_token(token)
    # Защита от path-traversal: берём только имя файла без директории
    safe_name = Path(filename).name
    photos_dir = Path(os.environ.get("PHOTOS_DIR", "./photos"))
    path = photos_dir / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path)


@router.get("/api/files/truck-scans/{filename}")
def serve_truck_scan(filename: str, token: str = Query(...)) -> FileResponse:
    _verify_token(token)
    safe_name = Path(filename).name
    truck_scans_dir = Path(os.environ.get("TRUCK_SCANS_DIR", "./truck_scans"))
    path = truck_scans_dir / safe_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path)
