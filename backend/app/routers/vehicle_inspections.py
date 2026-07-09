"""Приёмка-передача авто (2026-07-02).

Эндпойнты:
  POST /api/vehicle-inspections/photo          — загрузить фото повреждения
  POST /api/vehicle-inspections/               — сдать/принять авто (создать акт)
  GET  /api/vehicle-inspections/active-session — активная сессия текущего водителя
  GET  /api/vehicle-inspections/active-sessions — статус всех машин (занята/свободна)
  GET  /api/vehicle-inspections/sessions/      — журнал сессий (для вкладки Рейсы)
  GET  /api/vehicle-inspections/{insp_id}      — акт с пунктами и повреждениями

Фото сохраняется в PHOTOS_DIR (env, /photos в Docker), затем фоново
сжимается Pillow до 1200px/JPEG-80.
"""

import os
import uuid
from datetime import date as _date
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlmodel import SQLModel, Session, select

from .. import audit, models
from ..auth import get_current_user
from ..database import get_session

router = APIRouter(prefix="/api/vehicle-inspections", tags=["vehicle-inspections"])

PHOTOS_DIR = os.environ.get("PHOTOS_DIR", "./photos")


# ──────────────────────────────────────────────────────────────────────────────
# Вспомогательные
# ──────────────────────────────────────────────────────────────────────────────

def _compress_photo(path: str) -> None:
    """Сжать фото на месте: не более 1200px по длинной стороне, JPEG 80%."""
    try:
        from PIL import Image  # type: ignore
        img = Image.open(path)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        w, h = img.size
        max_px = 1200
        if max(w, h) > max_px:
            ratio = max_px / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        img.save(path, "JPEG", quality=80, optimize=True)
    except Exception:
        pass  # если сжатие упало — оригинал остаётся


def _get_driver_id_or_403(user: models.User) -> int:
    if user.driver_id is None and user.role not in ("admin", "foreman"):
        raise HTTPException(403, "Только для водителей")
    return user.driver_id  # type: ignore[return-value]


def _inspection_detail(inspection: models.VehicleInspection, db: Session) -> dict:
    items = db.exec(
        select(models.InspectionItem).where(
            models.InspectionItem.inspection_id == inspection.id
        )
    ).all()
    damages = db.exec(
        select(models.InspectionDamage).where(
            models.InspectionDamage.inspection_id == inspection.id
        )
    ).all()
    return {
        **inspection.model_dump(),
        "items": [i.model_dump() for i in items],
        "damages": [d.model_dump() for d in damages],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Загрузка фото
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/photo")
async def upload_photo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Загрузить фото повреждения. Возвращает { filename }."""
    os.makedirs(PHOTOS_DIR, exist_ok=True)
    raw_name = file.filename or "photo"
    ext = os.path.splitext(raw_name)[-1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".heic", ".webp"):
        ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(PHOTOS_DIR, filename)
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    background_tasks.add_task(_compress_photo, path)
    return {"filename": filename}


# ──────────────────────────────────────────────────────────────────────────────
# Создать акт приёмки / сдачи
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/")
def submit_inspection(
    payload: models.InspectionSubmitRequest,
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Принять (kind=start) или сдать (kind=end) машину."""
    driver_id: int | None = user.driver_id

    # Для ролей admin/foreman driver_id может быть None — разрешаем,
    # но тогда инспекция привязана к водителю через truck_id.
    # На практике водитель всегда заходит под своим аккаунтом.

    if payload.kind == "start":
        # Проверяем, нет ли уже открытой сессии у этого водителя
        if driver_id is not None:
            existing = db.exec(
                select(models.VehicleSession).where(
                    models.VehicleSession.driver_id == driver_id,
                    models.VehicleSession.ended_at == None,  # noqa: E711
                )
            ).first()
            if existing:
                raise HTTPException(400, "У водителя уже открыта сессия — сначала сдайте текущую машину")

        # Создаём сессию
        session_obj = models.VehicleSession(
            driver_id=driver_id or 0,
            truck_id=payload.truck_id,
        )
        db.add(session_obj)
        db.flush()  # получаем id без commit

        # Создаём акт
        inspection = models.VehicleInspection(
            session_id=session_obj.id,
            driver_id=driver_id or 0,
            truck_id=payload.truck_id,
            kind="start",
            odometer=payload.odometer,
        )
        db.add(inspection)
        db.flush()

        # Обратная ссылка
        session_obj.start_inspection_id = inspection.id
        db.add(session_obj)

    elif payload.kind == "end":
        # Ищем открытую сессию
        if driver_id is not None:
            active = db.exec(
                select(models.VehicleSession).where(
                    models.VehicleSession.driver_id == driver_id,
                    models.VehicleSession.ended_at == None,  # noqa: E711
                )
            ).first()
        else:
            # Нет driver_id — ищем по truck_id
            active = db.exec(
                select(models.VehicleSession).where(
                    models.VehicleSession.truck_id == payload.truck_id,
                    models.VehicleSession.ended_at == None,  # noqa: E711
                )
            ).first()

        if not active:
            raise HTTPException(400, "Нет активной сессии для закрытия")

        # Закрываем сессию
        active.ended_at = datetime.utcnow()

        # Создаём акт сдачи
        inspection = models.VehicleInspection(
            session_id=active.id,
            driver_id=driver_id or active.driver_id,
            truck_id=active.truck_id,
            kind="end",
            odometer=payload.odometer,
        )
        db.add(inspection)
        db.flush()

        active.end_inspection_id = inspection.id
        db.add(active)

    else:
        raise HTTPException(400, f"Неизвестный kind: {payload.kind!r}")

    # Пункты чеклиста
    for item_data in payload.items:
        db.add(models.InspectionItem(
            inspection_id=inspection.id,
            block=item_data.block,
            label=item_data.label,
            status=item_data.status,
            note=item_data.note,
            item_count=item_data.item_count,
        ))

    # Повреждения
    for dmg_data in payload.damages:
        db.add(models.InspectionDamage(
            inspection_id=inspection.id,
            description=dmg_data.description,
            photo_path=dmg_data.photo_path,
        ))

    # Пробег → журнал пробегов (MileageLog), если указан одометр
    if payload.odometer is not None:
        note_kind = "принял" if payload.kind == "start" else "сдал"
        db.add(models.MileageLog(
            truck_id=payload.truck_id,
            driver_id=driver_id or 0,
            odometer=float(payload.odometer),
            date=_date.today(),
            is_service=False,
            note=f"П/П авто: {note_kind}",
        ))

    db.commit()
    db.refresh(inspection)

    # Журнал действий: фиксируем факт приёмки / сдачи авто
    try:
        _truck = db.get(models.Truck, payload.truck_id)
        _driver = db.get(models.Driver, driver_id) if driver_id else None
        _kind_label = "Приёмка авто" if payload.kind == "start" else "Сдача авто"
        _plate = _truck.plate if _truck else f"ТС #{payload.truck_id}"
        _driver_name = _driver.name if _driver else f"Водитель #{driver_id}"
        audit.log_action(
            db,
            user=user,
            action="create",
            zone="vehicle_inspections",
            entity_id=inspection.id,
            entity_label=f"{_kind_label}: {_plate} / {_driver_name}",
            extra={
                "kind": payload.kind,
                "truck_id": payload.truck_id,
                "driver_id": driver_id,
                "odometer": payload.odometer,
            },
        )
    except Exception:
        pass  # журнал не блокирует основную операцию

    return {"id": inspection.id, "session_id": inspection.session_id}


# ──────────────────────────────────────────────────────────────────────────────
# Активная сессия текущего водителя
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/active-session")
def get_active_session(
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Вернуть активную сессию текущего водителя или null."""
    if not user.driver_id:
        return None

    session_obj = db.exec(
        select(models.VehicleSession).where(
            models.VehicleSession.driver_id == user.driver_id,
            models.VehicleSession.ended_at == None,  # noqa: E711
        )
    ).first()

    if not session_obj:
        return None

    truck = db.get(models.Truck, session_obj.truck_id)
    return {
        "session_id": session_obj.id,
        "truck_id": session_obj.truck_id,
        "truck_label": truck.label if truck else "",
        "truck_plate": truck.plate if truck else "",
        "started_at": session_obj.started_at.isoformat(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Статусы всех машин (занята/свободна) — для UI выбора авто
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/active-sessions")
def get_active_sessions(
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Список открытых сессий: {truck_id, driver_name}."""
    open_sessions = db.exec(
        select(models.VehicleSession).where(
            models.VehicleSession.ended_at == None  # noqa: E711
        )
    ).all()

    result = []
    for s in open_sessions:
        driver = db.get(models.Driver, s.driver_id)
        result.append({
            "session_id": s.id,
            "truck_id": s.truck_id,
            "driver_id": s.driver_id,
            "driver_name": driver.name if driver else f"Водитель #{s.driver_id}",
            "started_at": s.started_at.isoformat(),
        })
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Принудительное закрытие сессии (admin / foreman, 2026-07-03)
# ──────────────────────────────────────────────────────────────────────────────

class ForceCloseRequest(SQLModel):
    odometer: int | None = None  # опционально


@router.post("/sessions/{session_id}/close")
def force_close_session(
    session_id: int,
    payload: ForceCloseRequest,
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Принудительно закрыть сессию (создать акт сдачи без чеклиста).
    Доступно только admin и foreman."""
    if user.role not in ("admin", "foreman"):
        raise HTTPException(403, "Только для администраторов и бригадиров")

    sess = db.get(models.VehicleSession, session_id)
    if not sess:
        raise HTTPException(404, "Сессия не найдена")
    if sess.ended_at is not None:
        raise HTTPException(400, "Сессия уже закрыта")

    # Закрываем сессию
    sess.ended_at = datetime.utcnow()

    # Акт сдачи — без чеклиста, с пометкой администратора
    inspection = models.VehicleInspection(
        session_id=sess.id,
        driver_id=sess.driver_id,
        truck_id=sess.truck_id,
        kind="end",
        odometer=payload.odometer,
    )
    db.add(inspection)
    db.flush()

    sess.end_inspection_id = inspection.id
    db.add(sess)

    if payload.odometer is not None:
        db.add(models.MileageLog(
            truck_id=sess.truck_id,
            driver_id=sess.driver_id,
            odometer=float(payload.odometer),
            date=_date.today(),
            is_service=False,
            note="П/П авто: принудительная сдача",
        ))

    db.commit()
    db.refresh(inspection)

    try:
        _truck = db.get(models.Truck, sess.truck_id)
        _driver = db.get(models.Driver, sess.driver_id)
        _plate = _truck.plate if _truck else f"ТС #{sess.truck_id}"
        _driver_name = _driver.name if _driver else f"Водитель #{sess.driver_id}"
        audit.log_action(
            db,
            user=user,
            action="update",
            zone="vehicle_inspections",
            entity_id=sess.id,
            entity_label=f"Принудительная сдача: {_plate} / {_driver_name}",
            extra={"session_id": sess.id, "truck_id": sess.truck_id,
                   "driver_id": sess.driver_id, "odometer": payload.odometer},
        )
    except Exception:
        pass

    return {"id": inspection.id, "session_id": sess.id}


# ──────────────────────────────────────────────────────────────────────────────
# Журнал сессий (вкладка «Приёмка-сдача» в Рейсы)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/sessions/")
def list_sessions(
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    query = select(models.VehicleSession).order_by(models.VehicleSession.started_at.desc())
    if user.role == "driver" and user.driver_id:
        query = query.where(models.VehicleSession.driver_id == user.driver_id)

    sessions = db.exec(query).all()

    result = []
    for s in sessions:
        truck = db.get(models.Truck, s.truck_id)
        driver = db.get(models.Driver, s.driver_id)
        start_insp = db.get(models.VehicleInspection, s.start_inspection_id) if s.start_inspection_id else None
        end_insp = db.get(models.VehicleInspection, s.end_inspection_id) if s.end_inspection_id else None
        result.append({
            "id": s.id,
            "driver_id": s.driver_id,
            "driver_name": driver.name if driver else "",
            "truck_id": s.truck_id,
            "truck_plate": truck.plate if truck else "",
            "truck_label": truck.label if truck else "",
            "started_at": s.started_at.isoformat(),
            "ended_at": s.ended_at.isoformat() if s.ended_at else None,
            "start_inspection_id": s.start_inspection_id,
            "end_inspection_id": s.end_inspection_id,
            "start_odometer": start_insp.odometer if start_insp else None,
            "end_odometer": end_insp.odometer if end_insp else None,
        })
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Детальный просмотр сессии (оба акта, пункты, повреждения, фото)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}")
def get_session_detail(
    session_id: int,
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Полная информация о сессии: акты приёмки и сдачи с пунктами и повреждениями."""
    sess = db.get(models.VehicleSession, session_id)
    if not sess:
        raise HTTPException(404)
    # Водитель видит только свои сессии
    if user.role == "driver" and user.driver_id and user.driver_id != sess.driver_id:
        raise HTTPException(403)

    truck = db.get(models.Truck, sess.truck_id)
    driver = db.get(models.Driver, sess.driver_id)

    def _detail(insp_id: int | None) -> dict | None:
        if insp_id is None:
            return None
        insp = db.get(models.VehicleInspection, insp_id)
        return _inspection_detail(insp, db) if insp else None

    return {
        "id": sess.id,
        "driver_id": sess.driver_id,
        "driver_name": driver.name if driver else "",
        "truck_id": sess.truck_id,
        "truck_plate": truck.plate if truck else "",
        "truck_label": truck.label if truck else "",
        "started_at": sess.started_at.isoformat(),
        "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
        "start_inspection": _detail(sess.start_inspection_id),
        "end_inspection": _detail(sess.end_inspection_id),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Детальный просмотр акта
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{insp_id}")
def get_inspection(
    insp_id: int,
    db: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    insp = db.get(models.VehicleInspection, insp_id)
    if not insp:
        raise HTTPException(404)
    return _inspection_detail(insp, db)
