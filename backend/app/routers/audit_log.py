"""GET /api/audit-log — журнал действий пользователей ("Настройки -> Журнал",
2026-06-28). Admin-only, как и /api/users и /api/role-permissions: эта
страница тоже намеренно не входит в настраиваемую матрицу зон/ролей (см.
permissions.py module docstring) - иначе роль могла бы сама себе выдать
доступ к собственному журналу и скрыть следы. Чтение по записям пишет
app/audit.py::log_action из каждого роутера; этот файл - только GET, без
мутаций (сам журнал не редактируется и не удаляется через API).

POST /api/audit-log/download — исключение из admin-only правила: любой
авторизованный пользователь может записать факт скачивания файла. Выделен
в отдельный router без Depends(require_role("admin")), чтобы не блокировать
водителей и других пользователей при скачивании документов."""

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select
from pydantic import BaseModel

from .. import audit, models
from ..auth import get_current_user, require_role
from ..database import get_session
from ..audit import ACTION_LABELS, ZONE_LABELS

router = APIRouter(
    prefix="/api/audit-log",
    tags=["audit-log"],
    dependencies=[Depends(require_role("admin"))],
)

# Отдельный роутер без admin-only, для fire-and-forget логирования скачиваний
download_router = APIRouter(prefix="/api/audit-log", tags=["audit-log"])


class _DownloadPayload(BaseModel):
    filename: str
    zone: str = "documents"


@download_router.post("/download", status_code=204)
def log_download(
    payload: _DownloadPayload,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    """Фиксирует скачивание файла в журнале. Доступен любой авторизованной
    роли — водители тоже скачивают документы на своём ТС."""
    audit.log_action(
        session,
        user=user,
        action="download_file",
        zone=payload.zone,
        entity_label=payload.filename,
    )
    return None


@router.get("/")
def list_log(
    limit: int = Query(300, le=2000),
    zone: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    stmt = select(models.ActionLog).order_by(models.ActionLog.id.desc())
    if zone:
        stmt = stmt.where(models.ActionLog.zone == zone)
    if action:
        stmt = stmt.where(models.ActionLog.action == action)
    stmt = stmt.limit(limit)
    items = session.exec(stmt).all()
    return [i.model_dump() for i in items]


@router.get("/meta")
def list_meta():
    """Справочник зон/действий для фильтров на фронтенде - чтобы подписи
    («Машины», «создал» и т.п.) не дублировались отдельной картой в TS."""
    return {
        "zones": [{"value": k, "label": v} for k, v in ZONE_LABELS.items()],
        "actions": [{"value": k, "label": v} for k, v in ACTION_LABELS.items()],
    }
