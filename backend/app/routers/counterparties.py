"""Реестр контрагентов (2026-07-12).

Справочник контрагентов: Название, ИНН, НДС%.
Доступен в Настройках → «Контрагенты» (только admin).

Пути:
  GET    /api/counterparties/      — список (требует авторизации)
  POST   /api/counterparties/      — создать (только admin)
  PUT    /api/counterparties/{id}  — обновить (только admin)
  DELETE /api/counterparties/{id}  — удалить (только admin)
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user, require_role
from ..database import get_session

router = APIRouter(prefix="/api/counterparties", tags=["counterparties"])

_admin = [Depends(require_role("admin"))]


@router.get("/")
def list_counterparties(
    session: Session = Depends(get_session),
    _user: models.User = Depends(get_current_user),
):
    """Список контрагентов отсортированный по имени. Доступен всем залогиненным."""
    return session.exec(
        select(models.Counterparty).order_by(models.Counterparty.name)
    ).all()


@router.post("/", status_code=201, dependencies=_admin)
def create_counterparty(
    payload: models.CounterpartyCreate,
    session: Session = Depends(get_session),
):
    item = models.Counterparty(**payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.put("/{item_id}", dependencies=_admin)
def update_counterparty(
    item_id: int,
    payload: models.CounterpartyUpdate,
    session: Session = Depends(get_session),
):
    item = session.get(models.Counterparty, item_id)
    if not item:
        raise HTTPException(404, "Контрагент не найден")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204, dependencies=_admin)
def delete_counterparty(
    item_id: int,
    session: Session = Depends(get_session),
):
    item = session.get(models.Counterparty, item_id)
    if not item:
        raise HTTPException(404, "Контрагент не найден")
    session.delete(item)
    session.commit()
    return None
