"""Справочник статей расходов (2026-07-04).

GET  /api/expense-categories/          — список активных статей, доступных для
                                          роли текущего пользователя (admin видит все).
POST /api/expense-categories/          — создать статью (admin only).
PUT  /api/expense-categories/{id}      — обновить (admin only).
DELETE /api/expense-categories/{id}    — деактивировать (soft-delete, admin only).
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import models
from ..auth import get_current_user, require_role
from ..database import get_session

router = APIRouter(prefix="/api/expense-categories", tags=["expense-categories"])


class CategoryIn(BaseModel):
    name: str
    allowed_roles: list[str] = ["driver", "foreman", "accountant"]
    active: bool = True
    sort_order: int = 0


def _parse_roles(raw: str) -> list[str]:
    try:
        return json.loads(raw)
    except Exception:
        return []


@router.get("/")
def list_categories(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Возвращает статьи, доступные роли текущего пользователя.
    Admin видит все активные + неактивные. Остальные — только активные,
    где их роль есть в allowed_roles (admin в allowed_roles отсутствует —
    он всегда имеет доступ).
    """
    all_cats = session.exec(
        select(models.ExpenseCategory).order_by(
            models.ExpenseCategory.sort_order,
            models.ExpenseCategory.name,
        )
    ).all()

    if user.role == "admin":
        return all_cats  # admin видит все (включая неактивные)

    result = []
    for c in all_cats:
        if not c.active:
            continue
        roles = _parse_roles(c.allowed_roles)
        if user.role in roles:
            result.append(c)
    return result


@router.post("/", status_code=201)
def create_category(
    payload: CategoryIn,
    session: Session = Depends(get_session),
    user: models.User = Depends(require_role("admin")),
):
    cat = models.ExpenseCategory(
        name=payload.name,
        allowed_roles=json.dumps(payload.allowed_roles, ensure_ascii=False),
        active=payload.active,
        sort_order=payload.sort_order,
    )
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.put("/{cat_id}")
def update_category(
    cat_id: int,
    payload: CategoryIn,
    session: Session = Depends(get_session),
    user: models.User = Depends(require_role("admin")),
):
    cat = session.get(models.ExpenseCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Статья не найдена")
    cat.name = payload.name
    cat.allowed_roles = json.dumps(payload.allowed_roles, ensure_ascii=False)
    cat.active = payload.active
    cat.sort_order = payload.sort_order
    session.add(cat)
    session.commit()
    session.refresh(cat)
    return cat


@router.delete("/{cat_id}", status_code=204)
def deactivate_category(
    cat_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(require_role("admin")),
):
    cat = session.get(models.ExpenseCategory, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Статья не найдена")
    cat.active = False
    session.add(cat)
    session.commit()


def seed_expense_categories(session: Session) -> None:
    """Засевает справочник статей из CASHFLOW_CATEGORIES если таблица пустая.
    Идемпотентно — не трогает уже существующие записи.
    """
    existing = session.exec(select(models.ExpenseCategory)).first()
    if existing:
        return  # уже засеяно

    all_roles_json = json.dumps(["driver", "foreman", "accountant"], ensure_ascii=False)
    for i, name in enumerate(models.CASHFLOW_CATEGORIES):
        session.add(models.ExpenseCategory(
            name=name,
            allowed_roles=all_roles_json,
            active=True,
            sort_order=i,
        ))
    session.commit()
