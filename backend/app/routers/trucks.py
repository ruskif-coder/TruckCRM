"""Trucks CRUD - a dedicated router rather than the generic make_router
(crud.py), because `label` (the legacy display field shown across Trips/Fuel
via truckLabel(), originally just the bare plate from
importers/common.py::find_or_create_truck) now has to stay in sync with
`brand` ("Название" in the Автомобили admin form, added 2026-06-23) the same
way drivers.py keeps Driver.name in sync with last_name/first_name. Whenever
brand changes, label is recomputed from it (falling back to plate if brand
is blank), so Fuel.tsx/Trips.tsx's existing truckLabel() lookups show the
real brand/model without needing any changes there.
"""

import os
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, require_zone
from ..database import get_session
from ..importers.common import normalize_plate

router = APIRouter(prefix="/api/trucks", tags=["trucks"])

TRUCK_SCANS_DIR = os.environ.get("TRUCK_SCANS_DIR", "./truck_scans")

_SCAN_FIELD: dict[str, str] = {
    "sts":              "sts_scan",
    "osago":            "osago_scan",
    "kasko":            "kasko_scan",
    "tech_inspection":  "tech_inspection_scan",
}


def _compress_scan(path: str) -> None:
    """Сжать изображение скана: не более 2000px, JPEG 85%. PDF пропускается."""
    try:
        from PIL import Image  # type: ignore
        img = Image.open(path)
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > 2000:
            ratio = 2000 / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        img.save(path, "JPEG", quality=85, optimize=True)
    except Exception:
        pass
# Роли по API (2026-06-28, "Разделение по зонам"; настраивается через
# "Настройки -> Роли" с того же дня, см. permissions.py): зона "trucks" -
# дефолт - бригадир. require_zone() читает текущие права из БД, а не из
# зашитого списка ролей.
_read = [Depends(require_zone("trucks", "read"))]
_write = [Depends(require_zone("trucks", "write"))]


def _sync_label(data: dict, existing_brand: str = "", existing_plate: str = "") -> None:
    """Mutates `data["label"]` in place from brand, falling back to plate,
    falling back to whatever the row already has for any key the caller
    didn't touch. No-ops if both brand and plate end up blank."""
    brand = data["brand"] if "brand" in data else existing_brand
    plate = data["plate"] if "plate" in data else existing_plate
    if brand:
        data["label"] = brand
    elif plate:
        data["label"] = plate


@router.get("/", dependencies=_read)
def list_trucks(session: Session = Depends(get_session)):
    items = session.exec(select(models.Truck)).all()
    return [i.model_dump() for i in items]


@router.get("/fleet-stats", dependencies=_read)
def fleet_stats(session: Session = Depends(get_session)):
    """Агрегированная статистика по каждой машине для карточного/списочного вида.
    Возвращает dict truck_id → {last_odometer, last_service_odometer, fuel_week_liters}.
    Пробег считается по максимальному одометру в MileageLog; ТО — по
    максимальному одометру среди записей с is_service=True; топливо —
    SUM(volume) за последнюю завершённую отчётную неделю (пн–вс).
    """
    today = date.today()
    this_monday = today - timedelta(days=today.weekday())  # weekday 0=пн
    last_monday = this_monday - timedelta(days=7)

    # Последний одометр по каждой машине
    odo_rows = session.exec(
        select(models.MileageLog.truck_id,
               func.max(models.MileageLog.odometer).label("v"))
        .where(models.MileageLog.odometer.is_not(None))
        .group_by(models.MileageLog.truck_id)
    ).all()
    last_odo: dict[int, float] = {r.truck_id: r.v for r in odo_rows}

    # Последний одометр при ТО (is_service=True)
    svc_rows = session.exec(
        select(models.MileageLog.truck_id,
               func.max(models.MileageLog.odometer).label("v"))
        .where(models.MileageLog.odometer.is_not(None),
               models.MileageLog.is_service == True)  # noqa: E712
        .group_by(models.MileageLog.truck_id)
    ).all()
    last_svc: dict[int, float] = {r.truck_id: r.v for r in svc_rows}

    # Топливо за последнюю завершённую неделю (volume > 0, исключаем коррекции)
    fuel_rows = session.exec(
        select(models.FuelRecord.truck_id,
               func.sum(models.FuelRecord.volume).label("liters"))
        .where(
            models.FuelRecord.truck_id.is_not(None),
            models.FuelRecord.volume > 0,
            func.date(models.FuelRecord.date) >= last_monday.isoformat(),
            func.date(models.FuelRecord.date) < this_monday.isoformat(),
        )
        .group_by(models.FuelRecord.truck_id)
    ).all()
    week_fuel: dict[int, float] = {
        r.truck_id: round(r.liters or 0, 1) for r in fuel_rows
    }

    trucks = session.exec(select(models.Truck)).all()
    return {
        t.id: {
            "last_odometer": last_odo.get(t.id),
            "last_service_odometer": last_svc.get(t.id),
            "fuel_week_liters": week_fuel.get(t.id, 0.0),
        }
        for t in trucks
    }


@router.get("/{truck_id}", dependencies=_read)
def get_truck(truck_id: int, session: Session = Depends(get_session)):
    item = session.get(models.Truck, truck_id)
    if not item:
        raise HTTPException(404, "truck not found")
    return item.model_dump()


@router.post("/", status_code=201, dependencies=_write)
def create_truck(
    payload: models.TruckCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    data = payload.model_dump()
    # Run manually-entered plates through the same normalize_plate() the
    # importers use (importers/common.py) - added 2026-06-24 so a plate
    # typed into the Автомобили form (spaces/dashes/lowercase/Latin
    # look-alike letters) always ends up in the exact canonical form a
    # trip/fuel import would produce. Without this, find_or_create_truck()
    # would still *match* an import row to this truck correctly (it
    # normalizes both sides before comparing), but the registry's own
    # plate column could show a different-looking string than the one the
    # importer would have generated - this keeps the registry the single
    # consistent source of truth for "as written" plates too.
    if data.get("plate"):
        data["plate"] = normalize_plate(data["plate"])
    _sync_label(data)
    if not data.get("label"):
        data["label"] = "Новый автомобиль"
    item = models.Truck(**data)
    session.add(item)
    session.commit()
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(session, user=user, action="create", zone="trucks", entity_id=item.id, entity_label=after.get("label", ""), after=after)
    return after


@router.put("/{truck_id}", dependencies=_write)
def update_truck(
    truck_id: int,
    payload: models.TruckUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.Truck, truck_id)
    if not item:
        raise HTTPException(404, "truck not found")
    before = item.model_dump()
    data = payload.model_dump(exclude_unset=True)
    if data.get("plate"):
        data["plate"] = normalize_plate(data["plate"])
    _sync_label(data, item.brand, item.plate)
    for k, v in data.items():
        setattr(item, k, v)
    session.add(item)
    session.commit()
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(session, user=user, action="update", zone="trucks", entity_id=item.id, entity_label=after.get("label", ""), before=before, after=after)
    return after


@router.delete("/{truck_id}", status_code=204, dependencies=_write)
def delete_truck(
    truck_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.Truck, truck_id)
    if not item:
        raise HTTPException(404, "truck not found")
    before = item.model_dump()
    session.delete(item)
    session.commit()
    audit.log_action(session, user=user, action="delete", zone="trucks", entity_id=truck_id, entity_label=before.get("label", ""), before=before)
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Сканы документов машины (2026-07-03)
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/{truck_id}/scan/{doc_type}", dependencies=_write)
async def upload_truck_scan(
    truck_id: int,
    doc_type: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Загрузить скан документа. doc_type: sts | osago | kasko | tech_inspection.
    Файл сохраняется в TRUCK_SCANS_DIR, имя файла пишется в соответствующее
    поле Truck. Изображения сжимаются фоново (Pillow); PDF — без сжатия."""
    if doc_type not in _SCAN_FIELD:
        raise HTTPException(400, f"Неизвестный тип документа: {doc_type!r}. Допустимые: {list(_SCAN_FIELD)}")

    truck = session.get(models.Truck, truck_id)
    if not truck:
        raise HTTPException(404, "Машина не найдена")

    os.makedirs(TRUCK_SCANS_DIR, exist_ok=True)
    raw_name = file.filename or "scan"
    ext = os.path.splitext(raw_name)[-1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".pdf", ".webp"):
        ext = ".jpg"
    filename = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(TRUCK_SCANS_DIR, filename)
    content = await file.read()
    with open(path, "wb") as fh:
        fh.write(content)
    if ext != ".pdf":
        background_tasks.add_task(_compress_scan, path)

    setattr(truck, _SCAN_FIELD[doc_type], filename)
    session.add(truck)
    session.commit()
    return {"filename": filename}


# ──────────────────────────────────────────────────────────────────────────────
# Комплектация машины (Блок 3 приёмки-передачи, 2026-07-02)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/{truck_id}/equipment", dependencies=_read)
def get_truck_equipment(
    truck_id: int,
    session: Session = Depends(get_session),
):
    """Список оснащения для машины. Если не настроено — возвращает дефолты."""
    items = session.exec(
        select(models.TruckEquipmentItem)
        .where(models.TruckEquipmentItem.truck_id == truck_id)
        .order_by(models.TruckEquipmentItem.sort_order, models.TruckEquipmentItem.id)
    ).all()
    if not items:
        return [
            {"id": None, "truck_id": truck_id, "label": label, "sort_order": i}
            for i, label in enumerate(models.DEFAULT_EQUIPMENT_ITEMS)
        ]
    return [i.model_dump() for i in items]


@router.post("/{truck_id}/equipment", status_code=201, dependencies=_write)
def add_truck_equipment(
    truck_id: int,
    payload: models.TruckEquipmentItemCreate,
    session: Session = Depends(get_session),
):
    """Добавить пункт комплектации. При первом добавлении инициализирует
    список из дефолтов, чтобы уже имеющиеся пункты не потерялись."""
    existing = session.exec(
        select(models.TruckEquipmentItem).where(
            models.TruckEquipmentItem.truck_id == truck_id
        )
    ).all()
    # Если дефолтов ещё нет в БД — первый раз создаём дефолты + новый пункт
    if not existing:
        for i, label in enumerate(models.DEFAULT_EQUIPMENT_ITEMS):
            session.add(models.TruckEquipmentItem(truck_id=truck_id, label=label, sort_order=i))
    item = models.TruckEquipmentItem(
        truck_id=truck_id,
        label=payload.label,
        sort_order=payload.sort_order,
    )
    session.add(item)
    session.commit()
    session.refresh(item)
    return item.model_dump()


@router.put("/{truck_id}/equipment/{item_id}", dependencies=_write)
def update_truck_equipment(
    truck_id: int,
    item_id: int,
    payload: models.TruckEquipmentItemUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(models.TruckEquipmentItem, item_id)
    if not item or item.truck_id != truck_id:
        raise HTTPException(404)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item.model_dump()


@router.delete("/{truck_id}/equipment/{item_id}", status_code=204, dependencies=_write)
def delete_truck_equipment(
    truck_id: int,
    item_id: int,
    session: Session = Depends(get_session),
):
    item = session.get(models.TruckEquipmentItem, item_id)
    if not item or item.truck_id != truck_id:
        raise HTTPException(404)
    session.delete(item)
    session.commit()
    return None
