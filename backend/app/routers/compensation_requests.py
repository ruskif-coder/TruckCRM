"""Заявки водителей на компенсацию расходов (2026-07-04).

Водитель подаёт заявку (POST /) → admin принимает (POST /{id}/approve)
или отклоняет (POST /{id}/reject).

При принятии:
  - статус → "принято"
  - создаётся CashFlowEntry как документальная запись (expense = amount,
    category = request.category, purpose = "Компенсация: <description>").
  Баланс водителя пересчитывается на следующем шаге разработки.

Пути:
  GET  /api/compensation-requests/journal/       — обогащённый список
  GET  /api/compensation-requests/pending-count/ — кол-во "на рассмотрении"
  POST /api/compensation-requests/               — создать заявку (driver)
  POST /api/compensation-requests/{id}/approve   — принять (admin/foreman)
  POST /api/compensation-requests/{id}/reject    — отказать (admin/foreman)

Журнал и счётчик включаются в main.py ДО make_router (если он будет добавлен),
чтобы /journal/ и /pending-count/ не захватывались {item_id}.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user
from ..database import get_session

router = APIRouter(prefix="/api/compensation-requests", tags=["compensation-requests"])

_PENDING = "на рассмотрении"
_APPROVED = "принято"
_REJECTED = "отказано"

_STAFF_ROLES = {"admin", "foreman", "accountant"}


def _require_staff(user: models.User) -> None:
    if user.role not in _STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Доступ только для admin/foreman/accountant")


@router.get("/journal/")
def compensation_journal(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Список заявок — обогащённый (driver_name, truck_label).
    Водитель видит только свои, staff — все.
    """
    rows = session.exec(
        select(models.CompensationRequest).order_by(
            models.CompensationRequest.created_at.desc()
        )
    ).all()

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


@router.get("/pending-count/")
def pending_count(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Количество заявок в статусе 'на рассмотрении'.
    Для staff — все; для водителя — только его.
    """
    rows = session.exec(select(models.CompensationRequest)).all()
    if user.role == "driver":
        count = sum(1 for r in rows if r.driver_id == user.driver_id and r.status == _PENDING)
    else:
        count = sum(1 for r in rows if r.status == _PENDING)
    return {"count": count}


@router.post("/", status_code=201)
def create_request(
    payload: models.CompensationRequestCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Водитель создаёт заявку на компенсацию."""
    if not user.driver_id:
        raise HTTPException(status_code=403, detail="Только водители могут подавать заявки")

    req = models.CompensationRequest(
        driver_id=user.driver_id,   # берём из токена, не из тела
        truck_id=payload.truck_id,
        expense_date=payload.expense_date,
        amount=payload.amount,
        category=payload.category,
        description=payload.description,
        photo_paths=payload.photo_paths,
        status=_PENDING,
    )
    session.add(req)
    session.commit()
    session.refresh(req)
    return req


@router.post("/{req_id}/approve", status_code=200)
def approve_request(
    req_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Принять заявку на компенсацию.
    Создаёт CashFlowEntry для документальной фиксации.
    Доступно admin / foreman / accountant.
    """
    _require_staff(user)

    req = session.get(models.CompensationRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != _PENDING:
        raise HTTPException(status_code=409, detail=f"Заявка уже обработана: {req.status}")

    req.status = _APPROVED
    session.add(req)

    # Документальная запись в реестре расходов
    purpose = f"Компенсация: {req.description}" if req.description else "Компенсация водителю"
    entry = models.CashFlowEntry(
        date=req.expense_date,
        expense=req.amount,
        income=0.0,
        category=req.category,
        purpose=purpose,
        driver_id=req.driver_id,
        truck_id=req.truck_id,
        status="ОПЛАЧЕНО",
        bank="",
        counterparty="",
        period=req.expense_date.strftime("%m-%Y"),
    )
    session.add(entry)

    # Корректировка баланса водителя: компенсация начисляется как credit (+)
    if req.driver_id:
        tx = models.DriverTransaction(
            driver_id=req.driver_id,
            date=req.expense_date,
            tx_type="compensation",
            amount=req.amount,  # positive = credit to driver
            description=purpose,
            ref_type="compensation_request",
            ref_id=req.id,
            created_by_user_id=user.id,
        )
        session.add(tx)

    session.commit()
    session.refresh(req)
    return req


@router.post("/{req_id}/reject", status_code=200)
def reject_request(
    req_id: int,
    payload: models.CompensationRejectPayload,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Отклонить заявку. Доступно admin / foreman / accountant."""
    _require_staff(user)

    req = session.get(models.CompensationRequest, req_id)
    if not req:
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    if req.status != _PENDING:
        raise HTTPException(status_code=409, detail=f"Заявка уже обработана: {req.status}")

    req.status = _REJECTED
    req.reject_reason = payload.reason
    session.add(req)
    session.commit()
    session.refresh(req)
    return req
