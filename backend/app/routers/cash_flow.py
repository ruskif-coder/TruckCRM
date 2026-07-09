from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, require_zone
from ..database import get_session

# Custom router (not the generic make_router) because two things need extra
# logic the generic CRUD factory doesn't have: server-side НДС ФАКТ
# recomputation on every create/update, and a bulk-update endpoint for the
# multi-select mass-edit feature (see models.CashFlowBulkUpdate). Mounted at
# /api/expenses in main.py - the old generic Expense router that used to
# live at this prefix was dormant (0 rows, no frontend) and removed.
router = APIRouter(prefix="/api/expenses", tags=["expenses"])
# Роли по API (2026-06-28, "Разделение по зонам"; настраивается через
# "Настройки -> Роли" с того же дня, см. permissions.py): зона "expenses" -
# дефолт - запись бухгалтеру. require_zone() читает текущие права из БД, а
# не из зашитого списка ролей.
_read = [Depends(require_zone("expenses", "read"))]
_write = [Depends(require_zone("expenses", "write"))]


def _recompute_vat(data: dict) -> float:
    """НДС ФАКТ = (поступления + списания) * НДС% / 100, mirroring the
    source spreadsheet's `=SUM(поступления:списания)*НДС/100` formula.
    Only one of income/expense is normally non-zero per row, so the sum
    just picks out whichever one is filled. Округление до 2 знаков
    (2026-06-29, по просьбе пользователя - см. calculations.py::round2) -
    без него float-умножение/деление даёт длинный "хвост" после запятой."""
    income = data.get("income") or 0
    expense = data.get("expense") or 0
    vat_pct = data.get("vat_pct") or 0
    return round((income + expense) * vat_pct / 100, 2)


@router.get("/", dependencies=_read)
def list_entries(session: Session = Depends(get_session)):
    items = session.exec(select(models.CashFlowEntry)).all()
    return [i.model_dump() for i in items]


@router.get("/{item_id}", dependencies=_read)
def get_entry(item_id: int, session: Session = Depends(get_session)):
    item = session.get(models.CashFlowEntry, item_id)
    if not item:
        raise HTTPException(404, "expense entry not found")
    return item.model_dump()


@router.post("/", status_code=201, dependencies=_write)
def create_entry(
    payload: models.CashFlowEntryCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    data = payload.model_dump()
    data["vat_amount"] = _recompute_vat(data)
    data["created_by_user_id"] = user.id
    item = models.CashFlowEntry(**data)
    session.add(item)
    session.commit()
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(session, user=user, action="create", zone="expenses", entity_id=item.id, entity_label=after.get("category", ""), after=after)
    return after


@router.put("/{item_id}", dependencies=_write)
def update_entry(
    item_id: int,
    payload: models.CashFlowEntryUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.CashFlowEntry, item_id)
    if not item:
        raise HTTPException(404, "expense entry not found")
    before = item.model_dump()
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(item, k, v)
    item.vat_amount = _recompute_vat(item.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(session, user=user, action="update", zone="expenses", entity_id=item.id, entity_label=after.get("category", ""), before=before, after=after)
    return after


@router.delete("/{item_id}", status_code=204, dependencies=_write)
def delete_entry(
    item_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.CashFlowEntry, item_id)
    if not item:
        raise HTTPException(404, "expense entry not found")
    before = item.model_dump()
    session.delete(item)
    session.commit()
    audit.log_action(session, user=user, action="delete", zone="expenses", entity_id=item_id, entity_label=before.get("category", ""), before=before)
    return None


@router.patch("/bulk", dependencies=_write)
def bulk_update_entries(
    payload: models.CashFlowBulkUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Multi-select mass edit: applies only the fields present in the
    request body (exclude_unset) to every row in `ids` that still exists.
    Missing/unknown ids are silently skipped rather than erroring the whole
    batch, since the selection in the UI is a point-in-time snapshot.

    Журнал (2026-06-28): полная история изменений по выбору пользователя -
    логируется отдельной строкой на каждую реально изменённую запись (а не
    одной сводной строкой на весь bulk-вызов), чтобы по каждой записи в
    "Реестре расходов" можно было найти, что и когда в ней поменялось,
    так же как при обычном редактировании через update_entry."""
    fields = payload.model_dump(exclude={"ids"}, exclude_unset=True)
    if not fields:
        raise HTTPException(400, "no fields to update")
    updated = 0
    for item_id in payload.ids:
        item = session.get(models.CashFlowEntry, item_id)
        if not item:
            continue
        before = item.model_dump()
        for k, v in fields.items():
            setattr(item, k, v)
        session.add(item)
        updated += 1
        after = item.model_dump()
        audit.log_action(session, user=user, action="update", zone="expenses", entity_id=item.id, entity_label=after.get("category", ""), before=before, after=after)
    session.commit()
    return {"updated": updated}
