"""GET/PUT матрицы доступа по ролям - страница "Настройки -> Роли"
(2026-06-28). Admin-only, как и /api/users и /api/settings: сама эта
страница НЕ входит в настраиваемую матрицу (см. permissions.py module
docstring - иначе роль могла бы сама себе выдать доступ к управлению
ролями)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, require_role
from ..database import get_session
from ..permissions import CONFIGURABLE_ROLES, DEFAULT_MATRIX, READ_ONLY_ZONES, ZONES

router = APIRouter(
    prefix="/api/role-permissions",
    tags=["role-permissions"],
    dependencies=[Depends(require_role("admin"))],
)


@router.get("/")
def get_matrix(session: Session = Depends(get_session)):
    """Возвращает полную матрицу зона×роль, включая зоны/роли, для которых
    ещё нет строки в таблице (отдаёт дефолт из DEFAULT_MATRIX вместо пустоты,
    чтобы UI всегда показывал все зоны и роли, даже сразу после миграции)."""
    rows = {(p.zone, p.role): p for p in session.exec(select(models.RolePermission)).all()}
    result = []
    for zone, zone_label in ZONES:
        for role, role_label in CONFIGURABLE_ROLES:
            row = rows.get((zone, role))
            default_read, default_write = DEFAULT_MATRIX.get((zone, role), (False, False))
            result.append(
                {
                    "zone": zone,
                    "zone_label": zone_label,
                    "role": role,
                    "role_label": role_label,
                    "can_read": row.can_read if row else default_read,
                    "can_write": row.can_write if row else default_write,
                    "write_applicable": zone not in READ_ONLY_ZONES,
                }
            )
    return result


@router.put("/")
def update_matrix(
    payload: models.RolePermissionBulkUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Bulk upsert - перезаписывает только присланные (zone, role) пары.
    Используется как «сохранить всю матрицу целиком» с фронтенда, не как
    точечный патч одной ячейки.

    Журнал (2026-06-28): отдельная строка на каждую пару (zone, role), у
    которой can_read/can_write реально изменились относительно текущего
    значения (из существующей строки или, если строки ещё не было,
    DEFAULT_MATRIX - то самое значение, которое GET / показал бы в UI до
    сохранения) - пары без изменений не логируются, чтобы "Сохранить" без
    реальных правок не плодило пустые записи в журнале."""
    valid_zones = {zone for zone, _ in ZONES}
    valid_roles = {role for role, _ in CONFIGURABLE_ROLES}
    zone_labels = dict(ZONES)
    role_labels = dict(CONFIGURABLE_ROLES)
    existing = {(p.zone, p.role): p for p in session.exec(select(models.RolePermission)).all()}

    changed = 0
    for item in payload.items:
        if item.zone not in valid_zones or item.role not in valid_roles:
            raise HTTPException(400, f"Неизвестная зона/роль: {item.zone}/{item.role}")
        row = existing.get((item.zone, item.role))
        if row:
            before = {"can_read": row.can_read, "can_write": row.can_write}
            row.can_read = item.can_read
            row.can_write = item.can_write
            session.add(row)
        else:
            default_read, default_write = DEFAULT_MATRIX.get((item.zone, item.role), (False, False))
            before = {"can_read": default_read, "can_write": default_write}
            row = models.RolePermission(role=item.role, zone=item.zone, can_read=item.can_read, can_write=item.can_write)
            session.add(row)
            existing[(item.zone, item.role)] = row
        after = {"can_read": item.can_read, "can_write": item.can_write}
        if before != after:
            changed += 1
            label = f"{zone_labels.get(item.zone, item.zone)} / {role_labels.get(item.role, item.role)}"
            audit.log_action(session, user=user, action="update", zone="role_permissions", entity_label=label, before=before, after=after)

    session.commit()
    return {"updated": len(payload.items)}
