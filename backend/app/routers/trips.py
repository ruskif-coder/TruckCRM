from fastapi import Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlmodel import Session

from .. import audit, models
from ..auth import get_current_user, require_zone
from ..crud import make_router
from ..database import get_session
from ..importers.trip_registry import build_import_template, build_trips_export, import_trips

# Роли по API (2026-06-28, "Разделение по зонам"; настраивается через
# "Настройки -> Роли" с того же дня, см. permissions.py): зона "trips" -
# дефолт - запись бригадиру. Чтение по умолчанию открыто всем трём ролям
# (как и было до этой фичи - никакого read_roles не было вовсе) -
# own_filter_field="driver_id" сужает список/карточку для роли "driver" до
# собственных рейсов независимо от этой настройки, как и попросил
# пользователь ("только свои рейсы").
router = make_router(
    table_model=models.Trip,
    create_model=models.TripCreate,
    update_model=models.TripUpdate,
    prefix="/api/trips",
    tag="trips",
    zone="trips",
    own_filter_field="driver_id",
)


@router.post("/import", dependencies=[Depends(require_zone("trips", "write"))])
async def import_trips_endpoint(
    file: UploadFile = File(...),
    source: str = Form(""),
    carrier_name: str = Form(""),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    content = await file.read()
    result = import_trips(content, session, source=source, carrier_name=carrier_name)
    # Массовый импорт - одна сводная запись в журнале (счётчики из ответа
    # импортёра), а не построчный дифф на каждый рейс: при импорте реестра
    # это сотни строк за раз, и для журнала действий важнее факт и масштаб
    # операции, чем поле-в-поле изменения каждой записи.
    audit.log_action(session, user=user, action="import", zone="trips", entity_label=f"файл «{file.filename or ''}»", extra=result)
    return result


# Two path segments after the prefix ("/import/template"), so this never
# collides with crud.make_router's GET "/{item_id}" (single segment, int-typed) -
# no route-ordering concern here, unlike if this were a single-segment path.
@router.get("/import/template")
def download_import_template():
    content = build_import_template()
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="shablon_reestr_poezdok.xlsx"'},
    )


# Кнопка "Экспорт" в реестре поездок (2026-06-29) - "выгрузка файла в эксель
# с учетом сортировки, добавить колонку 'билинг'". POST, а не GET: тело
# запроса несёт уже отфильтрованный/отсортированный список строк, который
# фронтенд показывает на экране (Trips.tsx - тот же порядок, что в "sorted",
# не урезанный пагинацией "paged") - бэкенд не повторяет фильтры/сортировку,
# только сериализует присланное в .xlsx. Зона "read" - экспорт ничего не
# меняет в БД, в отличие от /import выше (зона "write").
@router.post("/export", dependencies=[Depends(require_zone("trips", "read"))])
def export_trips_endpoint(payload: models.TripExportRequest):
    content = build_trips_export(payload.rows)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="reestr_poezdok.xlsx"'},
    )
