"""Обогащённый журнал заявок на ремонт — имя водителя + номер авто.

GET /api/repair-requests/journal/
  — возвращает все заявки (admin/foreman/accountant) или только свои (driver),
    обогащённые полями driver_name и truck_label.

GET /api/repair-requests/open-count/
  — количество открытых заявок (создана / новая / в работе).

Оба роутера включаются в main.py ДО make_router-роутера repair_requests,
чтобы пути /journal/ и /open-count/ не захватывались параметром {item_id}.
"""
from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user
from ..database import get_session

router = APIRouter(prefix="/api/repair-requests", tags=["repair-requests"])

_OPEN_STATUSES = {"создана", "новая", "в работе"}


@router.get("/journal/")
def repair_journal(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    rows = session.exec(
        select(models.RepairRequest).order_by(models.RepairRequest.created_at.desc())
    ).all()

    # Водитель видит только свои заявки
    if user.role == "driver":
        rows = [r for r in rows if r.driver_id == user.driver_id]

    result = []
    for r in rows:
        driver = session.get(models.Driver, r.driver_id) if r.driver_id else None
        truck = session.get(models.Truck, r.truck_id) if r.truck_id else None
        result.append({
            **r.model_dump(),
            "driver_name": driver.name if driver else "—",
            "truck_label": truck.plate if truck else "—",
        })
    return result


@router.get("/open-count/")
def repair_open_count(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Число открытых заявок (создана / в работе). Для водителя — только его."""
    rows = session.exec(select(models.RepairRequest)).all()
    if user.role == "driver":
        count = sum(1 for r in rows if r.driver_id == user.driver_id and r.status in _OPEN_STATUSES)
    else:
        count = sum(1 for r in rows if r.status in _OPEN_STATUSES)
    return {"count": count}
