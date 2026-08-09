"""Дашборд бригадира (мобильный, 2026-07-04).

Бригадир — организационная роль без привязки к машине. Видит весь парк,
всех водителей, все заявки. Может менять статус заявок на ремонт.

Эндпойнты:
  GET /api/foreman-dashboard/summary    — счётчики для бейджа-алерта
  GET /api/foreman-dashboard/attention  — детализация "требует внимания"
  GET /api/foreman-dashboard/drivers    — водители + роль (из User)

Доступ: admin и foreman (require_role("foreman")).
"""
import os
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user, require_role
from ..database import get_session

router = APIRouter(prefix="/api/foreman-dashboard", tags=["foreman-dashboard"])

PHOTOS_DIR = os.environ.get("PHOTOS_DIR", "./photos")


def _compress_photo(path: str) -> None:
    """Сжать фото на месте: не более 1200px по длинной стороне, JPEG 80%.
    Копия хелпера из vehicle_inspections.py — тот же формат хранения фото."""
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
        pass

_OPEN_STATUSES = {"создана", "новая", "в работе"}
_PENDING_COMP = "на рассмотрении"
_DOC_WARN_DAYS = 30   # документы истекают через ≤ 30 дней → в алерт
_DOC_CRIT_DAYS = 7    # ≤ 7 дней → критично


def _require_foreman(user: models.User = Depends(get_current_user)) -> models.User:
    """admin или foreman."""
    if user.role not in {"admin", "foreman"}:
        raise HTTPException(403, detail="Доступ только для бригадира или администратора")
    return user


# ─── Вспомогательные ──────────────────────────────────────────────────────────

def _expiring_docs(trucks: list[models.Truck], today: date) -> list[dict]:
    """Возвращает список документов машин с истечением ≤ DOC_WARN_DAYS дней."""
    items = []
    for t in trucks:
        for doc_type, expiry in [
            ("ОСАГО", t.osago_date),
            ("Техосмотр", t.tech_inspection_date),
            ("КАСКО", t.kasko_date),
            ("Пропуск Москва", t.moscow_pass_date),
        ]:
            if not expiry:
                continue
            days_left = (expiry - today).days
            if days_left <= _DOC_WARN_DAYS:
                items.append({
                    "truck_id":   t.id,
                    "plate":      t.plate,
                    "label":      t.label or t.plate,
                    "doc_type":   doc_type,
                    "expiry_date": expiry.isoformat(),
                    "days_left":  days_left,
                    "critical":   days_left <= _DOC_CRIT_DAYS,
                })
    # сортируем: критичные и просроченные — вверх
    items.sort(key=lambda x: x["days_left"])
    return items


# ─── Эндпойнты ────────────────────────────────────────────────────────────────

@router.get("/summary")
def foreman_summary(
    session: Session = Depends(get_session),
    user: models.User = Depends(_require_foreman),
):
    """Счётчики для бейджа-алерта в DriverDashboard.
    Возвращает суммарное число позиций «требует внимания»:
      - открытые заявки на ремонт (все, не только срочные)
      - заявки на компенсацию «на рассмотрении»
      - документы машин с истечением ≤ 30 дней
    """
    today = date.today()

    repairs = session.exec(select(models.RepairRequest)).all()
    open_repairs = sum(1 for r in repairs if r.status in _OPEN_STATUSES)

    comps = session.exec(select(models.CompensationRequest)).all()
    pending_comps = sum(1 for c in comps if c.status == _PENDING_COMP)

    trucks = session.exec(select(models.Truck)).all()
    expiring = len(_expiring_docs(trucks, today))

    alert_count = open_repairs + pending_comps + expiring
    return {
        "alert_count":    alert_count,
        "open_repairs":   open_repairs,
        "pending_comps":  pending_comps,
        "expiring_docs":  expiring,
    }


@router.get("/attention")
def foreman_attention(
    session: Session = Depends(get_session),
    user: models.User = Depends(_require_foreman),
):
    """Детализация виджета «Требует внимания».
    Возвращает:
      - expiring_docs: список документов истекающих/просроченных
      - urgent_repairs: срочные открытые заявки на ремонт (до 5 шт.)
      - open_repairs_count: общее число открытых заявок
      - pending_comps_count: число заявок на компенсацию «на рассмотрении»
    """
    today = date.today()

    trucks = session.exec(select(models.Truck)).all()
    expiring_docs = _expiring_docs(trucks, today)

    repairs = session.exec(
        select(models.RepairRequest).order_by(
            models.RepairRequest.created_at.desc()
        )
    ).all()
    open_repairs = [r for r in repairs if r.status in _OPEN_STATUSES]
    urgent_repairs = [r for r in open_repairs if r.priority == "срочная"]

    # Обогащаем срочные: имя водителя + номер авто
    truck_map = {t.id: t.plate for t in trucks}
    driver_map = {
        d.id: d.name
        for d in session.exec(select(models.Driver)).all()
    }
    urgent_list = [
        {
            "id":         r.id,
            "driver_name": driver_map.get(r.driver_id, "—") if r.driver_id else "—",
            "truck_label": truck_map.get(r.truck_id, "—") if r.truck_id else "—",
            "text":        r.text,
            "priority":    r.priority,
            "created_at":  r.created_at.isoformat(),
        }
        for r in urgent_repairs[:5]
    ]

    comps = session.exec(select(models.CompensationRequest)).all()
    pending_comps = sum(1 for c in comps if c.status == _PENDING_COMP)

    return {
        "expiring_docs":      expiring_docs,
        "urgent_repairs":     urgent_list,
        "open_repairs_count": len(open_repairs),
        "pending_comps_count": pending_comps,
    }


@router.get("/drivers")
def foreman_drivers(
    session: Session = Depends(get_session),
    user: models.User = Depends(_require_foreman),
):
    """Список водителей, обогащённый ролью из таблицы User.
    Поля: id, name, phone, email, active, truck_id, truck_plate, role.
    «role» — из User.role где User.driver_id = Driver.id; "driver" если
    аккаунт не создан или роль не задана.
    """
    drivers = session.exec(select(models.Driver)).all()
    users = session.exec(select(models.User)).all()
    trucks = session.exec(select(models.Truck)).all()

    # driver_id → User.role
    role_map: dict[int, str] = {}
    for u in users:
        if u.driver_id:
            role_map[u.driver_id] = u.role

    truck_map: dict[int, str] = {t.id: t.plate for t in trucks}

    result = []
    for d in drivers:
        result.append({
            "id":          d.id,
            "name":        d.name,
            "phone":       d.phone,
            "email":       d.email,
            "active":      d.active,
            "truck_id":    d.truck_id,
            "truck_plate": truck_map.get(d.truck_id, "—") if d.truck_id else None,
            "role":        role_map.get(d.id, "driver"),
        })

    return result


# ─── Личные расходы бригадира (own-scoped) ─────────────────────────────────────
# Виджет «Мои расходы» на дашборде бригадира работает по токену (created_by_user_id),
# а НЕ через конфигурируемую зону "expenses". Так виджет не зависит от того, дал ли
# админ бригадиру доступ к общему реестру расходов (как /api/driver-dashboard/expense
# у водителя). Возврат/создание — только собственные записи CashFlowEntry.

@router.get("/my-expenses")
def foreman_my_expenses(
    session: Session = Depends(get_session),
    user: models.User = Depends(_require_foreman),
):
    """Собственные расходы бригадира за последние 60 дней (expense > 0)."""
    since = (date.today() - timedelta(days=60)).isoformat()
    rows = session.exec(
        select(models.CashFlowEntry).where(
            models.CashFlowEntry.created_by_user_id == user.id,
            models.CashFlowEntry.expense > 0,
            models.CashFlowEntry.date >= since,
        )
    ).all()
    rows.sort(key=lambda e: str(e.date), reverse=True)
    return [
        {
            "id":                  e.id,
            "date":                str(e.date),
            "status":              e.status,
            "expense":             e.expense,
            "income":              e.income,
            "bank":                e.bank,
            "category":            e.category,
            "purpose":             e.purpose,
            "truck_id":            e.truck_id,
            "created_by_user_id":  e.created_by_user_id,
            "photo_paths":         e.photo_paths,
        }
        for e in rows
    ]


@router.post("/expense-photo")
async def foreman_upload_expense_photo(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: models.User = Depends(_require_foreman),
):
    """Загрузить фото к расходу бригадира. Возвращает { filename }.
    Формат хранения — как у приёмки авто (PHOTOS_DIR, /photos/<uuid>)."""
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


@router.post("/expense", status_code=201)
def foreman_add_expense(
    payload: models.CashFlowEntryCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(_require_foreman),
):
    """Быстрый ввод собственного расхода бригадиром. created_by_user_id берётся
    из токена — запись попадает в общий реестр расходов (страница «Расходы») и
    в личный виджет «Мои расходы». Доступ по require_role(foreman), без зоны
    "expenses" (та управляет доступом к общему реестру, здесь — только своя запись).
    """
    data = payload.model_dump()
    data["created_by_user_id"] = user.id
    data["income"] = 0
    entry = models.CashFlowEntry(**data)
    session.add(entry)
    session.commit()
    session.refresh(entry)
    return {"id": entry.id, "ok": True}
