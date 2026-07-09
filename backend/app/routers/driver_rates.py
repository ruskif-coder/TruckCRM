"""DriverRate CRUD ("Условия оплаты водителя") - added 2026-06-28 to replace
calculations.py's flat DRIVER_PCT_PLACEHOLDER with real per-driver pay
conditions. One row per (driver_id, carrier_id) - see models.DriverRateBase
for what each field means. A dedicated router rather than crud.make_router
for two reasons: the unique (driver_id, carrier_id) pair needs a friendly
400 instead of a raw IntegrityError 500, and `GET /` supports an optional
`?driver_id=` filter for the per-driver sub-form in Drivers.tsx.

Admin-only end to end (read and write) - this is compensation data, and the
user's "Разделение по зонам" answer (2026-06-28) didn't name driver pay
conditions as бухгалтер/бригадир territory, so it defaults to the most
restrictive zone rather than guessing.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, require_role
from ..database import get_session

router = APIRouter(
    prefix="/api/driver-rates",
    tags=["driver-rates"],
    dependencies=[Depends(require_role("admin"))],
)

_DUPLICATE_MSG = "Для этого водителя и перевозчика условие уже добавлено — отредактируйте существующее"


def _rate_label(session: Session, driver_id: Optional[int], carrier_id: Optional[int]) -> str:
    """Человекочитаемая подпись для журнала - "ФИО водителя / название
    перевозчика" вместо голых id, раз уж сессия и так под рукой."""
    driver = session.get(models.Driver, driver_id) if driver_id else None
    carrier = session.get(models.Carrier, carrier_id) if carrier_id else None
    return f"{driver.name if driver else '—'} / {carrier.name if carrier else '—'}"


@router.get("/")
def list_rates(driver_id: Optional[int] = Query(None), session: Session = Depends(get_session)):
    stmt = select(models.DriverRate)
    if driver_id is not None:
        stmt = stmt.where(models.DriverRate.driver_id == driver_id)
    items = session.exec(stmt).all()
    return [i.model_dump() for i in items]


@router.get("/{item_id}")
def get_rate(item_id: int, session: Session = Depends(get_session)):
    item = session.get(models.DriverRate, item_id)
    if not item:
        raise HTTPException(404, "driver rate not found")
    return item.model_dump()


@router.post("/", status_code=201)
def create_rate(
    payload: models.DriverRateCreate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = models.DriverRate(**payload.model_dump())
    session.add(item)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(400, _DUPLICATE_MSG)
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(
        session, user=user, action="create", zone="driver_rates", entity_id=item.id,
        entity_label=_rate_label(session, item.driver_id, item.carrier_id), after=after,
    )
    return after


@router.put("/{item_id}")
def update_rate(
    item_id: int,
    payload: models.DriverRateUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.DriverRate, item_id)
    if not item:
        raise HTTPException(404, "driver rate not found")
    before = item.model_dump()
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(item, k, v)
    session.add(item)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(400, _DUPLICATE_MSG)
    session.refresh(item)
    after = item.model_dump()
    audit.log_action(
        session, user=user, action="update", zone="driver_rates", entity_id=item.id,
        entity_label=_rate_label(session, item.driver_id, item.carrier_id), before=before, after=after,
    )
    return after


@router.delete("/{item_id}", status_code=204)
def delete_rate(
    item_id: int,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    item = session.get(models.DriverRate, item_id)
    if not item:
        raise HTTPException(404, "driver rate not found")
    before = item.model_dump()
    label = _rate_label(session, item.driver_id, item.carrier_id)
    session.delete(item)
    session.commit()
    audit.log_action(session, user=user, action="delete", zone="driver_rates", entity_id=item_id, entity_label=label, before=before)
    return None
