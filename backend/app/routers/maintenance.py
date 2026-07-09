"""Техническое обслуживание системы (admin-only, 2026-07-05).

Эндпойнты для ручного или планового обслуживания:
  POST /api/maintenance/cleanup-photos  — удалить осиротевшие фото из PHOTOS_DIR

Принципы:
- Только admin (require_role("admin")), эндпойнт не в конфигурируемой матрице ролей.
- Никогда не удаляет файлы, на которые есть ссылки в БД — только «осиротевшие».
- Сообщает о файлах старше 12 месяцев (даже если они привязаны к актам) —
  решение об удалении остаётся за администратором.
"""
import json
import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from .. import models
from ..auth import require_role
from ..database import get_session

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])
_admin = [Depends(require_role("admin"))]

# Порог «старых» файлов — только информируем, не удаляем
_PHOTO_MAX_AGE_DAYS = 365


@router.post("/cleanup-photos", dependencies=_admin)
def cleanup_photos(session: Session = Depends(get_session)):
    """Очищает папку фото (PHOTOS_DIR) от осиротевших файлов.

    «Осиротевший» — файл, которого нет ни в одной из трёх таблиц:
      • InspectionDamage.photo_path     (приёмка авто)
      • RepairRequest.photo_paths       (JSON-список, заявки на ремонт)
      • CompensationRequest.photo_paths (JSON-список, заявки на компенсацию)

    Файлы, привязанные к записям БД, не удаляются независимо от возраста —
    только попадают в список old_referenced_files для информирования.

    Возвращает:
      orphaned_deleted       — удалено осиротевших файлов
      orphaned_errors        — ошибки при удалении (нет прав и т.п.)
      old_referenced_count   — файлов, привязанных к БД, но старше 12 мес.
      old_referenced_files   — [{filename, mtime}] для ревью
      total_files_before     — сколько файлов было в папке до очистки
    """
    photos_dir = os.environ.get("PHOTOS_DIR", "./photos")

    if not os.path.isdir(photos_dir):
        return {
            "status": "photos_dir_not_found",
            "dir": photos_dir,
            "orphaned_deleted": 0,
            "orphaned_errors": 0,
            "old_referenced_count": 0,
            "old_referenced_files": [],
            "total_files_before": 0,
        }

    # 1. Собираем все имена файлов, на которые есть ссылки в БД
    referenced: set[str] = set()

    for dmg in session.exec(select(models.InspectionDamage)).all():
        if dmg.photo_path:
            referenced.add(dmg.photo_path)

    for req in session.exec(select(models.RepairRequest)).all():
        if req.photo_paths:
            try:
                for fn in json.loads(req.photo_paths):
                    if fn:
                        referenced.add(fn)
            except (json.JSONDecodeError, TypeError):
                pass

    for comp in session.exec(select(models.CompensationRequest)).all():
        if comp.photo_paths:
            try:
                for fn in json.loads(comp.photo_paths):
                    if fn:
                        referenced.add(fn)
            except (json.JSONDecodeError, TypeError):
                pass

    # 2. Сканируем папку и разбираем по категориям
    cutoff = datetime.now() - timedelta(days=_PHOTO_MAX_AGE_DAYS)
    orphaned_deleted = 0
    orphaned_errors = 0
    old_referenced: list[dict] = []
    total_files_before = 0

    for filename in os.listdir(photos_dir):
        filepath = os.path.join(photos_dir, filename)
        if not os.path.isfile(filepath):
            continue
        total_files_before += 1

        try:
            mtime = datetime.fromtimestamp(os.path.getmtime(filepath))
        except OSError:
            mtime = datetime.now()

        is_referenced = filename in referenced

        if not is_referenced:
            # Осиротевший файл — удаляем
            try:
                os.remove(filepath)
                orphaned_deleted += 1
            except OSError:
                orphaned_errors += 1
        elif mtime < cutoff:
            # Привязан к БД, но старше порога — информируем
            old_referenced.append({
                "filename": filename,
                "mtime": mtime.strftime("%Y-%m-%d"),
                "age_days": (datetime.now() - mtime).days,
            })

    note_parts = [f"Удалено {orphaned_deleted} осиротевших файлов."]
    if orphaned_errors:
        note_parts.append(f"Ошибок удаления: {orphaned_errors}.")
    if old_referenced:
        note_parts.append(
            f"Найдено {len(old_referenced)} файлов старше {_PHOTO_MAX_AGE_DAYS} дн., "
            "привязанных к актам/заявкам — не удалены. Просмотрите список и решите вручную."
        )
    else:
        note_parts.append(f"Файлов старше {_PHOTO_MAX_AGE_DAYS} дн. не обнаружено.")

    return {
        "status": "ok",
        "orphaned_deleted": orphaned_deleted,
        "orphaned_errors": orphaned_errors,
        "old_referenced_count": len(old_referenced),
        "old_referenced_files": old_referenced,
        "total_files_before": total_files_before,
        "note": " ".join(note_parts),
    }
