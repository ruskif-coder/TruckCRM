"""Generic CRUD router factory for the simple entities (drivers, routes,
expenses, mileage logs) that don't need extra computed fields.
Entities with computed fields (trucks, trip-batches, documents, settings,
dashboard, salary) get their own custom router in app/routers/.

Role gating (added 2026-06-28, "Разделение по зонам"): every router is
already behind login via `dependencies=protected` at the app.include_router()
call in main.py - that's unconditional and unchanged. On top of that, this
factory accepts three optional knobs so each call site can layer on its own
zone's rules without duplicating the CRUD boilerplate:
  - `write_roles`: if set, POST/PUT/DELETE additionally require the current
    user's role to be one of these (admin is always implicitly allowed - see
    auth.require_role). Read-only roles fall through with a plain 403.
  - `read_roles`: if set, GET (list + single) additionally require one of
    these roles - used to hide whole entities (e.g. машины/перевозчики) from
    the "driver" role, which should see nothing fleet-wide.
  - `zone`: (added 2026-06-28, "Настройки -> Роли") if set, overrides both
    `write_roles`/`read_roles` above - read/write are instead gated by
    auth.require_zone(zone, "read"|"write"), which checks the configurable
    RolePermission table instead of a hardcoded role list. See
    permissions.py for the zone registry/defaults. `write_roles`/`read_roles`
    are kept around (rather than deleted) for the handful of routers that
    intentionally stay admin-only/hardcoded (users, settings, driver_rates,
    trip_batches - see permissions.py module docstring for why).
  - `own_filter_field`: if set (e.g. "driver_id") and the current user's role
    is "driver", list/get results are filtered to rows whose `own_filter_field`
    equals `user.driver_id` - used on trips/fuel so a driver-role login sees
    only their own records instead of either the whole fleet or nothing.
    Independent of `zone`/`read_roles`/`write_roles` - this row-level rule
    isn't configurable via the Роли matrix, only the zone-level read/write
    gate above it is.
`read_roles`, `zone` and `own_filter_field` can all be omitted entirely (the
default) for entities where every logged-in role should see everything,
unchanged from before this feature existed.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from . import audit, models
from .auth import get_current_user, require_role, require_zone
from .database import get_session


def make_router(
    *,
    table_model,
    create_model,
    update_model,
    prefix: str,
    tag: str,
    write_roles: Optional[list[str]] = None,
    read_roles: Optional[list[str]] = None,
    zone: Optional[str] = None,
    own_filter_field: Optional[str] = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    if zone:
        read_deps = [Depends(require_zone(zone, "read"))]
        write_deps = [Depends(require_zone(zone, "write"))]
    else:
        read_deps = [Depends(require_role(*read_roles))] if read_roles else []
        write_deps = [Depends(require_role(*write_roles))] if write_roles else []

    # Журнал действий (2026-06-28): зона для audit.log_action - совпадает с
    # require_zone'овской `zone`, когда она есть (routes/carriers/trips/fuel/
    # mileage_logs/documents); для роутеров без неё (trip-batches - admin-only
    # через write_roles/read_roles) выводится из `tag`, чтобы записи всё
    # равно попадали в журнал под осмысленным ключом, см. audit.ZONE_LABELS.
    log_zone = zone or tag.replace("-", "_")

    def _belongs_to_other_driver(item, user: models.User) -> bool:
        """True if this row should be hidden from `user` under the
        own_filter_field row-level rule (role "driver" only) - i.e. the row's
        own_filter_field value isn't this user's driver_id. Named for what it
        returns (call sites read `if _belongs_to_other_driver(...)` to
        exclude/404, `if not ...` to keep)."""
        return (
            own_filter_field is not None
            and user.role == "driver"
            and getattr(item, own_filter_field, None) != user.driver_id
        )

    @router.get("/", dependencies=read_deps)
    def list_items(session: Session = Depends(get_session), user: models.User = Depends(get_current_user)):
        items = session.exec(select(table_model)).all()
        if own_filter_field and user.role == "driver":
            items = [i for i in items if not _belongs_to_other_driver(i, user)]
        return [i.model_dump() for i in items]

    @router.get("/{item_id}", dependencies=read_deps)
    def get_item(item_id: int, session: Session = Depends(get_session), user: models.User = Depends(get_current_user)):
        item = session.get(table_model, item_id)
        if not item or _belongs_to_other_driver(item, user):
            raise HTTPException(404, f"{tag} not found")
        return item.model_dump()

    @router.post("/", status_code=201, dependencies=write_deps)
    def create_item(
        payload: create_model,
        session: Session = Depends(get_session),
        user: models.User = Depends(get_current_user),
    ):
        item = table_model(**payload.model_dump())
        session.add(item)
        session.commit()
        session.refresh(item)
        after = item.model_dump()
        audit.log_action(
            session, user=user, action="create", zone=log_zone,
            entity_id=item.id, entity_label=audit.default_label(after), after=after,
        )
        return after

    @router.put("/{item_id}", dependencies=write_deps)
    def update_item(
        item_id: int,
        payload: update_model,
        session: Session = Depends(get_session),
        user: models.User = Depends(get_current_user),
    ):
        item = session.get(table_model, item_id)
        if not item:
            raise HTTPException(404, f"{tag} not found")
        before = item.model_dump()
        data = payload.model_dump(exclude_unset=True)
        for k, v in data.items():
            setattr(item, k, v)
        session.add(item)
        session.commit()
        session.refresh(item)
        after = item.model_dump()
        audit.log_action(
            session, user=user, action="update", zone=log_zone,
            entity_id=item.id, entity_label=audit.default_label(after) or audit.default_label(before),
            before=before, after=after,
        )
        return after

    @router.delete("/{item_id}", status_code=204, dependencies=write_deps)
    def delete_item(
        item_id: int,
        session: Session = Depends(get_session),
        user: models.User = Depends(get_current_user),
    ):
        item = session.get(table_model, item_id)
        if not item:
            raise HTTPException(404, f"{tag} not found")
        before = item.model_dump()
        session.delete(item)
        session.commit()
        audit.log_action(
            session, user=user, action="delete", zone=log_zone,
            entity_id=item_id, entity_label=audit.default_label(before), before=before,
        )
        return None

    return router
