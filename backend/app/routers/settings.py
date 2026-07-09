from fastapi import APIRouter, Depends
from sqlmodel import Session

from .. import audit, models
from ..auth import get_current_user, require_role
from ..database import get_session

# Роли по API (2026-06-28): глобальные настройки (% комиссии по умолчанию,
# интервал ТО) - admin-only, не упомянуты в схеме "Разделение по зонам".
# Settings.tsx сейчас вызывает только /api/carriers (своя зона ролей), не
# этот роутер - ограничение ничего не ломает на фронтенде.
router = APIRouter(prefix="/api/settings", tags=["settings"], dependencies=[Depends(require_role("admin"))])


def _get_or_create(session: Session) -> models.Settings:
    settings = session.get(models.Settings, 1)
    if not settings:
        settings = models.Settings(id=1)
        session.add(settings)
        session.commit()
        session.refresh(settings)
    return settings


@router.get("/")
def get_settings(session: Session = Depends(get_session)):
    return _get_or_create(session).model_dump()


@router.put("/")
def update_settings(
    payload: models.SettingsUpdate,
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    settings = _get_or_create(session)
    before = settings.model_dump()
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(settings, k, v)
    session.add(settings)
    session.commit()
    session.refresh(settings)
    after = settings.model_dump()
    audit.log_action(session, user=user, action="update", zone="settings", entity_id=settings.id, entity_label="Глобальные настройки", before=before, after=after)
    return after
