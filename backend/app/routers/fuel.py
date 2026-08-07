from datetime import date as date_type

from fastapi import Depends, File, UploadFile
from sqlmodel import Session, select

from .. import audit, models
from ..auth import get_current_user, require_zone
from ..calculations import iso_week_monday
from ..crud import make_router
from ..database import get_session
from ..importers.fuel_registry import import_fuel_records

# Роли по API (2026-06-28, "Разделение по зонам"; настраивается через
# "Настройки -> Роли" с того же дня, см. permissions.py): зона "fuel" -
# дефолт - запись бухгалтеру. own_filter_field="driver_id" сужает чтение для
# роли "driver" до собственных заправок (как трогали выше в trips.py),
# независимо от этой настройки.
router = make_router(
    table_model=models.FuelRecord,
    create_model=models.FuelRecordCreate,
    update_model=models.FuelRecordUpdate,
    prefix="/api/fuel",
    tag="fuel",
    zone="fuel",
    own_filter_field="driver_id",
)


@router.post("/import", dependencies=[Depends(require_zone("fuel", "write"))])
async def import_fuel_endpoint(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    content = await file.read()
    result = import_fuel_records(content, session)
    # Как и для импорта рейсов (см. trips.py) - одна сводная запись со
    # счётчиками из ответа импортёра, не построчный дифф на сотни заправок.
    audit.log_action(session, user=user, action="import", zone="fuel", entity_label=f"файл «{file.filename or ''}»", extra=result)
    return result


# Перенос топлива в «Реестр расходов» по неделям (2026-06-28, задача #137) -
# см. models.CashFlowEntryBase.fuel_source_key. По кнопке "Провести в
# расходы" на Fuel.tsx, а не автоматически - пользователь явно выбрал этот
# вариант (AskUserQuestion 2026-06-28): бухгалтер сам решает, когда
# зафиксировать неделю, а не находит сюрпризы в реестре расходов.
#
# Идемпотентно: при каждом нажатии пересчитывает ВСЕ недели заново (upsert
# по fuel_source_key), а не только новые, поэтому правка/удаление топливных
# записей задним числом корректно подтягивается при повторном нажатии. На
# уже существующих строках трогает только expense/date/period/vat_amount -
# status/vat_pct/counterparty/purpose, если бухгалтер их донастроил вручную
# после первого переноса, повторный перенос не затирает.
#
# Источник суммы определяет банк: E100-импорт (external_id заполнен файлом
# импорта) -> банк "АльфаКарта" (корпоративная топливная карта); ручная
# запись (external_id пуст - см. models.FuelRecordBase) -> банк "Наличные"
# ("кеш" по формулировке пользователя). Если у машины в одну неделю есть
# и карточные, и ручные заправки - это две раздельные строки расхода (разный
# банк), не одна. Записи без truck_id (не сматчилась машина при импорте)
# пропускаются - нет машины, к которой привязать расход; их количество
# возвращается в ответе как skipped_no_truck, чтобы это не потерялось
# незаметно.
@router.post("/post-to-expenses", dependencies=[Depends(require_zone("fuel", "write"))])
def post_fuel_to_expenses(
    session: Session = Depends(get_session),
    user: models.User = Depends(get_current_user),
):
    fuel_records = session.exec(select(models.FuelRecord)).all()
    truck_map: dict[int, str] = {
        t.id: (t.plate or t.label or f"#{t.id}")
        for t in session.exec(select(models.Truck)).all()
    }

    groups: dict[tuple[int, date_type, str], float] = {}
    skipped_no_truck = 0
    for r in fuel_records:
        if r.truck_id is None:
            skipped_no_truck += 1
            continue
        week_monday = iso_week_monday(r.date.date())
        bank = "АльфаКарта" if r.external_id else "Наличные"
        key = (r.truck_id, week_monday, bank)
        groups[key] = groups.get(key, 0.0) + r.amount

    existing = {
        e.fuel_source_key: e
        for e in session.exec(
            select(models.CashFlowEntry).where(models.CashFlowEntry.fuel_source_key != "")
        ).all()
    }

    from datetime import timedelta

    created = 0
    updated = 0
    for (truck_id, week_monday, bank), total_amount in groups.items():
        source_key = f"fuel:{truck_id}:{week_monday.isoformat()}:{bank}"
        period = f"{week_monday.month:02d}-{week_monday.year}"
        week_sunday = week_monday + timedelta(days=6)
        plate = truck_map.get(truck_id, f"#{truck_id}")
        purpose = (
            f"Топливо {plate} "
            f"{week_monday.strftime('%d.%m.%y')}–{week_sunday.strftime('%d.%m.%y')}"
        )
        entry = existing.get(source_key)
        if entry:
            entry.expense = total_amount
            entry.date = week_monday
            entry.period = period
            entry.vat_amount = entry.expense * (entry.vat_pct or 0) / 100
            # purpose обновляем только если он ещё содержит старый шаблонный текст
            if "см. страницу" in (entry.purpose or ""):
                entry.purpose = purpose
            session.add(entry)
            updated += 1
        else:
            entry = models.CashFlowEntry(
                date=week_monday,
                status="ОПЛАЧЕНО",
                income=0,
                expense=total_amount,
                bank=bank,
                period=period,
                vat_pct=0,
                vat_amount=0,
                truck_id=truck_id,
                category="Топливо",
                purpose=purpose,
                fuel_source_key=source_key,
            )
            session.add(entry)
            created += 1

    session.commit()
    result = {
        "created": created,
        "updated": updated,
        "weeks": len(groups),
        "skipped_no_truck": skipped_no_truck,
    }
    # Один summary-эпизод на нажатие кнопки "Провести в расходы", не по
    # записи на каждую созданную/обновлённую строку CashFlowEntry - сама
    # операция идемпотентна и пересчитывает все недели заново при каждом
    # нажатии (см. комментарий выше), так что построчный дифф был бы шумным.
    audit.log_action(session, user=user, action="post_to_expenses", zone="expenses", extra=result)
    return result
